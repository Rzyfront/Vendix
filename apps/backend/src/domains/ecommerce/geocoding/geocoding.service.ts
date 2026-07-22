import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';

/**
 * Normalized reverse-geocoding result. This is the EXACT shape returned by
 * `GET /ecommerce/geocoding/reverse` (no `{ success, data }` wrapper — the
 * backend has no global response-transform interceptor, so this object is
 * the raw 200 body the frontend consumes).
 */
export interface NormalizedAddress {
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_province: string | null;
  country_code: string;
  postal_code: string | null;
  municipality_code: string | null;
}

/**
 * Result of forward-geocoding a free-text address to a coordinate. `lat`/`lng`
 * are null when the provider could not resolve the query (not an error — the
 * customer simply keeps typing / drags the marker).
 */
export interface ForwardGeocodeResult {
  lat: number | null;
  lng: number | null;
}

/** Subset of a Nominatim `/search` result element (jsonv2). */
interface NominatimSearchResult {
  lat?: string;
  lon?: string;
}

/** Subset of the Nominatim `address` object we read (jsonv2 + addressdetails=1). */
interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  residential?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
}

interface NominatimReverseResponse {
  error?: string;
  display_name?: string;
  address?: NominatimAddress;
}

/** Single point of an Overpass way geometry (`out geom`). */
interface OverpassPoint {
  lat: number;
  lon: number;
}

/** Subset of an Overpass `way` element we read for cross-street detection. */
interface OverpassElement {
  tags?: { name?: string; highway?: string };
  geometry?: OverpassPoint[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * GeocodingService
 *
 * Server-side reverse-geocoding proxy so the frontend NEVER calls Nominatim
 * directly. Results are cached in Redis for 30 days keyed by a ~1m-precision
 * cell (`lat/lng.toFixed(5)`); the long cache is what keeps us within
 * Nominatim's 1 req/sec usage policy for real traffic. A short per-cell lock
 * provides best-effort single-flight for concurrent misses on the same cell.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /** 30 days, per the reverse-geocoding cache contract. */
  private static readonly CACHE_TTL_SECONDS = 2592000;
  /** Best-effort single-flight lock TTL (ms). */
  private static readonly LOCK_TTL_MS = 1500;
  /**
   * Nominatim request timeout (ms). Deliberately short because this sits on the
   * checkout address critical path: a free public provider with no SLA must
   * never hold the customer for ~8s. On timeout the reverse geocode degrades to
   * a minimal address (see {@link fetchFromNominatim}) rather than hanging or
   * 503-ing. Shared by the forward search, which likewise benefits from failing
   * fast (a slow forward only delays a non-blocking map centering).
   */
  private static readonly FETCH_TIMEOUT_MS = 3500;
  private static readonly NOMINATIM_BASE =
    'https://nominatim.openstreetmap.org/reverse';
  /** Nominatim forward-geocoding (free-text address → coordinate). */
  private static readonly NOMINATIM_SEARCH_BASE =
    'https://nominatim.openstreetmap.org/search';
  /** Forward-geocode cache TTL (7 days) — addresses move far less than a cell. */
  private static readonly FORWARD_CACHE_TTL_SECONDS = 604800;
  /**
   * Overpass endpoints (mirrors) used to find the perpendicular cross street.
   * Tried IN ORDER until one answers — public instances are frequently blocked
   * by network egress or rate-limited (e.g. `overpass-api.de` is refused from
   * some networks while `openstreetmap.fr` answers), so rotating mirrors is what
   * makes "always both axes" actually hold. Any total failure is treated as
   * "no cross street" and the caller keeps a single axis rather than failing.
   */
  private static readonly OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
  ];
  /**
   * Overpass request timeout (ms) — deliberately short. It sits on the checkout
   * critical path, so a blocked/slow Overpass must not stall the reverse geocode;
   * we would rather return a single axis fast than hang waiting for the cross one.
   */
  private static readonly OVERPASS_TIMEOUT_MS = 4000;
  /**
   * Search radius (m) for the nearest street of each axis. Wide enough that a
   * Colombian grid almost always has both a Calle and a Carrera within range,
   * so the address can ALWAYS carry both axes even when the point is not exactly
   * on a named street.
   */
  private static readonly CROSS_STREET_RADIUS_M = 350;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Reverse-geocode a coordinate to a normalized address.
   *
   * Never throws on a provider problem: if Nominatim is unreachable, times out,
   * returns a non-2xx / invalid JSON, or cannot resolve the point, this degrades
   * to a minimal empty {@link NormalizedAddress} (see {@link buildDegradedAddress})
   * so the checkout address step keeps working instead of hitting a hard 503.
   * Degraded results are intentionally NOT written to the 30-day `geocode:rev`
   * cache, so the next lookup re-tries the provider and self-heals the moment it
   * recovers.
   */
  async reverse(lat: number, lng: number): Promise<NormalizedAddress> {
    const cell = `${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const cacheKey = `geocode:rev:${cell}`;

    const cached = await this.readCache(cacheKey);
    if (cached) {
      this.logger.debug(`reverse cache HIT ${cacheKey}`);
      return cached;
    }
    this.logger.debug(`reverse cache MISS ${cacheKey}`);

    // Best-effort single-flight: if another request already holds the lock
    // for this cell, wait briefly and re-check the cache before falling
    // through to our own Nominatim call (never block indefinitely).
    const gotLock = await this.acquireLock(cell);
    if (!gotLock) {
      await this.sleep(900);
      const retry = await this.readCache(cacheKey);
      if (retry) {
        this.logger.debug(`reverse cache HIT (after lock wait) ${cacheKey}`);
        return retry;
      }
    }

    const { address, degraded } = await this.fetchFromNominatim(lat, lng);
    // Cache ONLY genuinely-resolved addresses for 30 days. A degraded result
    // (provider down / timeout / non-2xx / unresolved coordinate) is never
    // cached: persisting an empty address here would blank this ~1m cell for up
    // to 30 days even after Nominatim recovers. Skipping the write lets the next
    // request retry the provider (fast-fail bounded by FETCH_TIMEOUT_MS + the
    // per-cell single-flight lock keeps that from stampeding). A short-TTL cache
    // of the degraded result was considered and rejected: map-drag traffic hits
    // mostly distinct cells, so it would rarely help and would only risk masking
    // a real address that briefly failed.
    if (!degraded) {
      await this.writeCache(cacheKey, address);
    }
    return address;
  }

  /**
   * Forward-geocode a free-text address to a coordinate, biased to Colombia.
   * Used when the customer TYPES the address manually so the map can center on
   * it. Cached in Redis by normalized query. Never throws for a "not found":
   * returns `{ lat: null, lng: null }` so the caller just leaves the map as-is.
   *
   * @throws ServiceUnavailableException only when the provider is unreachable /
   *         returns a non-2xx / invalid JSON.
   */
  async forward(query: string): Promise<ForwardGeocodeResult> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 3) return { lat: null, lng: null };

    const cacheKey = `geocode:fwd:${q.toLowerCase()}`;
    const cached = await this.readForwardCache(cacheKey);
    if (cached) {
      this.logger.debug(`forward cache HIT ${cacheKey}`);
      return cached;
    }
    this.logger.debug(`forward cache MISS ${cacheKey}`);

    const result = await this.fetchForwardFromNominatim(q);
    // Cache even a null result briefly-ish (7d) to avoid hammering the provider
    // with the same unresolved query while the customer keeps editing.
    await this.writeForwardCache(cacheKey, result);
    return result;
  }

  private async fetchForwardFromNominatim(
    q: string,
  ): Promise<ForwardGeocodeResult> {
    const url =
      `${GeocodingService.NOMINATIM_SEARCH_BASE}?format=jsonv2` +
      `&q=${encodeURIComponent(q)}&countrycodes=co&limit=1&accept-language=es`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GeocodingService.FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Vendix/1.0 (soporte@vendix.online)' },
      });
    } catch (err) {
      this.logger.error(`Nominatim search failed for "${q}": ${err}`);
      throw new ServiceUnavailableException('Geocoding provider unavailable');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      this.logger.error(`Nominatim search HTTP ${response.status} for "${q}"`);
      throw new ServiceUnavailableException('Geocoding provider error');
    }

    let json: NominatimSearchResult[];
    try {
      json = (await response.json()) as NominatimSearchResult[];
    } catch (err) {
      this.logger.error(`Nominatim search returned invalid JSON: ${err}`);
      throw new ServiceUnavailableException(
        'Geocoding provider returned invalid data',
      );
    }

    const first = json?.[0];
    const lat = first ? Number(first.lat) : NaN;
    const lng = first ? Number(first.lon) : NaN;
    if (!first || Number.isNaN(lat) || Number.isNaN(lng)) {
      return { lat: null, lng: null };
    }
    return { lat, lng };
  }

  // ----------------------------------------------------------- Nominatim
  /**
   * Calls Nominatim reverse and maps it to our contract. On ANY provider
   * problem (network error / timeout / non-2xx / invalid JSON / unresolved
   * coordinate) it degrades to a minimal address instead of throwing, returning
   * `{ address, degraded: true }` so {@link reverse} can skip the 30-day cache.
   * A genuinely-resolved point returns `{ address, degraded: false }`.
   */
  private async fetchFromNominatim(
    lat: number,
    lng: number,
  ): Promise<{ address: NormalizedAddress; degraded: boolean }> {
    // Fire the spatial cross-axis lookup (Overpass) IN PARALLEL with the
    // Nominatim reverse call. A manually-dragged point is almost never an
    // addressed house, so the cross axis nearly always needs this lookup;
    // running it concurrently removes ~1s of sequential latency on the checkout
    // critical path. If the point turns out addressed, the already-in-flight
    // result is simply ignored by composeBothAxes. Guarded so a rejection here
    // never surfaces as an unhandled rejection.
    const axesPromise = this.findAxes(lat, lng).catch(() => ({
      calle: null,
      carrera: null,
    }));

    const url =
      `${GeocodingService.NOMINATIM_BASE}?format=jsonv2` +
      `&lat=${lat}&lon=${lng}&accept-language=es&addressdetails=1`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GeocodingService.FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Vendix/1.0 (soporte@vendix.online)' },
      });
    } catch (err) {
      // Network error or FETCH_TIMEOUT_MS abort. Degrade instead of 503 so the
      // checkout address step is not blocked by a free provider with no SLA.
      this.logger.warn(
        `Nominatim request failed for ${lat},${lng}, degrading: ${err}`,
      );
      return { address: this.buildDegradedAddress(), degraded: true };
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      this.logger.warn(
        `Nominatim returned HTTP ${response.status} for ${lat},${lng}, degrading`,
      );
      return { address: this.buildDegradedAddress(), degraded: true };
    }

    let json: NominatimReverseResponse;
    try {
      json = (await response.json()) as NominatimReverseResponse;
    } catch (err) {
      this.logger.warn(`Nominatim returned invalid JSON, degrading: ${err}`);
      return { address: this.buildDegradedAddress(), degraded: true };
    }

    if (json.error) {
      this.logger.warn(
        `Nominatim could not resolve ${lat},${lng}, degrading: ${json.error}`,
      );
      return { address: this.buildDegradedAddress(), degraded: true };
    }

    const normalized = this.normalize(json);

    // ALWAYS surface both axes ("Calle 14H Bis con Carrera 26"). Nominatim gives
    // at most the road the point sits on; Overpass supplies the nearest street of
    // EACH axis so the line carries a Calle AND a Carrera even when the point is
    // not exactly on a named street. Best-effort: any failure keeps the base line.
    const a = json.address ?? {};
    const primaryRoad = this.pickRoad(a);
    const primaryAxis = primaryRoad ? this.axisOf(primaryRoad) : null;
    const composed = await this.composeBothAxes(
      lat,
      lng,
      primaryRoad,
      primaryAxis,
      a.house_number,
      axesPromise,
    );
    if (composed) normalized.address_line1 = composed;

    return { address: normalized, degraded: false };
  }

  /**
   * Type-complete {@link NormalizedAddress} used when Nominatim is unreachable,
   * times out, or cannot resolve the point. Every textual field is empty so the
   * frontend's guarded prefill (`if (address.city) …`) simply skips it and the
   * customer types the address manually. The exact coordinate is NOT carried
   * here — the contract has no lat/lng field — but it is never lost: the map
   * callers set `latitude`/`longitude` on their form BEFORE `reverse()` resolves
   * (address-form-fields + checkout), independent of this payload. Returning
   * this instead of a 503 keeps the checkout address step alive.
   */
  private buildDegradedAddress(): NormalizedAddress {
    return {
      address_line1: '',
      address_line2: null,
      city: '',
      state_province: null,
      country_code: '',
      postal_code: null,
      municipality_code: null,
    };
  }

  /** Selects the primary road name from a Nominatim address object. */
  private pickRoad(a: NominatimAddress): string | null {
    return a.road ?? a.pedestrian ?? a.footway ?? a.residential ?? null;
  }

  /** Map a Nominatim jsonv2 response to our normalized contract shape. */
  private normalize(json: NominatimReverseResponse): NormalizedAddress {
    const a: NominatimAddress = json.address ?? {};

    const city = this.cleanCity(
      a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? '',
    );

    // Primary street axis (the road the point sits on). This is the base line;
    // fetchFromNominatim then enriches it with the perpendicular cross street via
    // Overpass so both axes appear. Kept CLEAN here (no barrio / POI /
    // administrative noise) — the barrio goes to address_line2.
    const road = this.pickRoad(a);
    const barrio = this.cleanBarrio(
      a.neighbourhood ?? a.suburb ?? a.quarter ?? null,
    );

    let addressLine1: string;
    if (road) {
      addressLine1 = a.house_number ? `${road} # ${a.house_number}` : road;
    } else if (barrio) {
      addressLine1 = barrio;
    } else if (json.display_name) {
      // Last resort: only the first display-name segment (nearest feature),
      // never the administrative tail that pollutes the field.
      addressLine1 = json.display_name.split(',')[0].trim();
    } else {
      addressLine1 = '';
    }

    // Barrio/sector as the complement (address_line2), unless it already is the
    // primary line.
    const addressLine2 =
      barrio && this.norm(barrio) !== this.norm(addressLine1) ? barrio : null;

    return {
      address_line1: addressLine1,
      address_line2: addressLine2,
      city,
      state_province: a.state ?? null,
      country_code: (a.country_code ?? '').toUpperCase(),
      postal_code: a.postcode ?? null,
      municipality_code: null, // Nominatim does not provide this.
    };
  }

  /**
   * Drop administrative / planning labels (UPZ, Localidad, Comuna, RAP,
   * Distrito, corregimiento, vereda) that Nominatim sometimes exposes as
   * suburb/neighbourhood in Colombian cities — they are not a usable barrio for
   * a shipping address and only add noise to the prefilled field.
   */
  private cleanBarrio(value: string | null): string | null {
    if (!value) return null;
    const ADMIN =
      /\b(upz|upzs|localidad|comuna|rap|distrito|per[ií]metro|corregimiento|vereda)\b/i;
    return ADMIN.test(value) ? null : value;
  }

  /**
   * Strip the "Perímetro Urbano" administrative prefix Nominatim prepends to
   * Colombian city names (e.g. "Perímetro Urbano Medellín" -> "Medellín"). The
   * frontend maps this value to a City option in CountryService for CO, so the
   * bare city name is what lets the dropdown auto-select.
   */
  private cleanCity(value: string): string {
    return value.replace(/^per[ií]metro\s+urbano\s+/i, '').trim();
  }

  /** Accent-insensitive, lowercased normalization for comparisons. */
  private norm(v: string): string {
    return v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  // ------------------------------------------------------- Cross street
  /**
   * Composes the address line so it ALWAYS carries both a Calle and a Carrera
   * when the surrounding grid has them. Nominatim's road (the axis the point
   * sits on) is preferred for its own axis; the other axis is the nearest street
   * of the opposite kind found via Overpass. Ordering keeps the axis the point
   * is on first ("Carrera 13 con Calle 62"), defaulting to Calle-first when the
   * point is not on a named street. Returns null only when nothing usable is
   * found (keeps the base line).
   */
  private async composeBothAxes(
    lat: number,
    lng: number,
    primaryRoad: string | null,
    primaryAxis: 'calle' | 'carrera' | null,
    houseNumber?: string,
    axesPromise?: Promise<{ calle: string | null; carrera: string | null }>,
  ): Promise<string | null> {
    const { cross, plate: rawPlate } = this.decomposeHouseNumber(houseNumber);
    // Nominatim sometimes returns a noisy house_number (e.g. "11-carrera 8"),
    // which would surface as "... # carrera 8". Keep the plate only when it
    // looks like a real house plate (has a digit AND no street-axis word).
    const plate = this.sanitizePlate(rawPlate);

    // The CO house number ITSELF encodes the cross axis (exact for addressed
    // points). DANE nomenclature: "Calle 70 # 4-83" = primary Calle 70,
    // generating Carrera 4, plate 83 — the number before the dash is the
    // perpendicular street. Zero external calls when the point is addressed.
    const houseCarrera =
      primaryAxis === 'calle' && cross ? `Carrera ${cross}` : null;
    const houseCalle =
      primaryAxis === 'carrera' && cross ? `Calle ${cross}` : null;

    // Resolve each axis by precedence: the axis the point SITS ON comes from
    // Nominatim's road (most accurate); the CROSS axis comes from the house
    // number when present.
    let calle = (primaryAxis === 'calle' ? primaryRoad : null) ?? houseCalle;
    let carrera =
      (primaryAxis === 'carrera' ? primaryRoad : null) ?? houseCarrera;

    // Still missing an axis (bare street / no house number)? Run the spatial
    // nearest-street analysis (Overpass, mirror-rotated) to fill it so the line
    // ALWAYS carries a Calle AND a Carrera. Skipped when both axes are already
    // known, so addressed points never pay the network round-trip.
    if (!calle || !carrera) {
      // Reuse the lookup already fired in parallel with Nominatim when present,
      // so the network round-trip is not paid sequentially after Nominatim.
      const axes = await (axesPromise ?? this.findAxes(lat, lng));
      calle = calle ?? axes.calle;
      carrera = carrera ?? axes.carrera;
    }

    if (calle && carrera) {
      const line =
        primaryAxis === 'carrera'
          ? `${carrera} con ${calle}`
          : `${calle} con ${carrera}`;
      return plate ? `${line} # ${plate}` : line;
    }

    // Only one axis resolvable → keep it with its raw number.
    const only = calle ?? carrera ?? primaryRoad;
    if (!only) return null;
    return houseNumber ? `${only} # ${houseNumber}` : only;
  }

  /**
   * Nearest named street of EACH axis to the point (best-effort via Overpass).
   * Returns `{ calle, carrera }`, each null when none is found in range or on
   * any Overpass failure — the reverse geocode never fails because of this.
   */
  private async findAxes(
    lat: number,
    lng: number,
  ): Promise<{ calle: string | null; carrera: string | null }> {
    const elements = await this.overpassNamedRoads(lat, lng);
    let calle: string | null = null;
    let calleDist = Infinity;
    let carrera: string | null = null;
    let carreraDist = Infinity;

    for (const el of elements) {
      const name = el.tags?.name;
      if (!name) continue;
      const axis = this.axisOf(name);
      if (!axis) continue;
      const dist = this.minDistanceToWayMeters(lat, lng, el.geometry ?? []);
      if (axis === 'calle' && dist < calleDist) {
        calleDist = dist;
        calle = name;
      } else if (axis === 'carrera' && dist < carreraDist) {
        carreraDist = dist;
        carrera = name;
      }
    }
    return { calle, carrera };
  }

  /**
   * Lists named highways around the point via Overpass. All mirrors are RACED
   * concurrently (not tried in order): the first one to return a usable
   * (non-empty) response wins, so a single blocked/slow mirror (e.g.
   * `overpass-api.de` is refused on some networks) never stalls the reverse
   * geocode — the reachable mirror answers while the blocked one aborts on its
   * own timeout. This is on the checkout critical path, so latency = the FASTEST
   * mirror, not the sum of the slow ones. Empty only when EVERY mirror fails or
   * legitimately has no named road in range; the reverse geocode never fails.
   */
  private async overpassNamedRoads(
    lat: number,
    lng: number,
  ): Promise<OverpassElement[]> {
    const query =
      `[out:json][timeout:6];` +
      `way(around:${GeocodingService.CROSS_STREET_RADIUS_M},${lat},${lng})` +
      `[highway][name];out tags geom;`;

    const attempts = GeocodingService.OVERPASS_MIRRORS.map((url) =>
      this.fetchOverpassMirror(url, query),
    );
    try {
      // First FULFILLED attempt wins. A mirror that is reachable but empty
      // rejects (see fetchOverpassMirror) so a populated mirror beats a
      // fast-but-empty one. Equivalent to Promise.any, hand-rolled because the
      // backend targets ES2020 (Promise.any needs the ES2021 lib).
      return await this.firstFulfilled(attempts);
    } catch {
      // Every mirror failed or returned nothing usable → keep a single axis.
      return [];
    }
  }

  /**
   * Resolves with the first fulfilled promise, mirroring `Promise.any` without
   * requiring the ES2021 lib (the backend targets ES2020). Rejects only once
   * EVERY input has rejected, so a populated mirror still wins the race even if
   * a faster mirror rejects first.
   */
  private firstFulfilled<T>(promises: Promise<T>[]): Promise<T> {
    if (promises.length === 0) {
      return Promise.reject(new Error('no attempts'));
    }
    return new Promise<T>((resolve, reject) => {
      let remaining = promises.length;
      for (const promise of promises) {
        promise.then(resolve, () => {
          if (--remaining === 0) {
            reject(new Error('all attempts failed'));
          }
        });
      }
    });
  }

  /**
   * Single Overpass mirror call with its own timeout. REJECTS on any failure
   * (network, non-2xx, invalid JSON) AND on an empty element set, so that in the
   * {@link overpassNamedRoads} race a fast-but-empty mirror does not beat a
   * slower mirror that actually has the surrounding streets.
   */
  private async fetchOverpassMirror(
    url: string,
    query: string,
  ): Promise<OverpassElement[]> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GeocodingService.OVERPASS_TIMEOUT_MS,
    );
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Vendix/1.0 (soporte@vendix.online)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = (await response.json()) as OverpassResponse;
      const elements = json.elements ?? [];
      if (elements.length === 0) throw new Error('empty');
      return elements;
    } catch (err) {
      // Best-effort enrichment — log and let the race fall to another mirror.
      this.logger.warn(`Overpass ${url} failed: ${err}`);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Classifies a Colombian street name by axis: `carrera` (N-S: Carrera/Cra/Kra/
   * Transversal) or `calle` (E-W: Calle/Diagonal). Returns null for ambiguous
   * names (a bare "Avenida") so they are never treated as a cross street.
   */
  private axisOf(name: string): 'calle' | 'carrera' | null {
    const n = this.norm(name);
    if (/\b(carrera|cra|kra|kr|transversal|transv|tv)\b/.test(n)) {
      return 'carrera';
    }
    if (/\b(calle|cl|diagonal|diag)\b/.test(n)) return 'calle';
    return null;
  }

  /**
   * Splits a CO house number into its cross-axis number and plate.
   * "4-83" -> { cross: "4", plate: "83" } (Carrera 4, plate 83);
   * "83"   -> { cross: null, plate: "83" } (no cross axis encoded).
   * Uses the LAST dash so plates with internal dashes stay on the plate side.
   */
  private decomposeHouseNumber(houseNumber?: string): {
    cross: string | null;
    plate: string | null;
  } {
    if (!houseNumber) return { cross: null, plate: null };
    const trimmed = houseNumber.trim();
    if (!trimmed) return { cross: null, plate: null };
    const dash = trimmed.lastIndexOf('-');
    if (dash < 0) return { cross: null, plate: trimmed };
    return {
      cross: trimmed.slice(0, dash).trim() || null,
      plate: trimmed.slice(dash + 1).trim() || null,
    };
  }

  /**
   * A house plate must look real: contain at least one digit and NO street-axis
   * word. Drops Nominatim noise like "carrera 8", "sin número", or "s/n" that
   * would otherwise pollute the composed line as "... # carrera 8".
   */
  private sanitizePlate(plate: string | null): string | null {
    if (!plate) return null;
    const p = plate.trim();
    if (!p) return null;
    if (this.axisOf(p)) return null; // contains calle/carrera/diagonal/... → not a plate
    if (!/\d/.test(p)) return null; // no digit → not a plate
    return p;
  }

  /** Minimum distance (m) from a point to a way's polyline geometry. */
  private minDistanceToWayMeters(
    lat: number,
    lng: number,
    geom: OverpassPoint[],
  ): number {
    if (geom.length === 0) return Infinity;
    if (geom.length === 1) {
      return this.pointToSegmentMeters(lat, lng, geom[0], geom[0]);
    }
    let min = Infinity;
    for (let i = 0; i < geom.length - 1; i++) {
      const d = this.pointToSegmentMeters(lat, lng, geom[i], geom[i + 1]);
      if (d < min) min = d;
    }
    return min;
  }

  /**
   * Distance (m) from the query point to segment A-B using a local
   * equirectangular projection centered on the point (accurate at street scale).
   */
  private pointToSegmentMeters(
    lat: number,
    lng: number,
    a: OverpassPoint,
    b: OverpassPoint,
  ): number {
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
    // Query point is the origin; project A and B into local meters.
    const ax = (a.lon - lng) * mPerDegLng;
    const ay = (a.lat - lat) * mPerDegLat;
    const bx = (b.lon - lng) * mPerDegLng;
    const by = (b.lat - lat) * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(cx, cy);
  }

  // --------------------------------------------------------------- Redis
  private async readCache(key: string): Promise<NormalizedAddress | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as NormalizedAddress;
    } catch (err) {
      // Fail open: a cache read failure must not break the endpoint.
      this.logger.warn(`Redis read failed for ${key}: ${err}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: NormalizedAddress,
  ): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        GeocodingService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      // Fail open: caching is an optimization, not a correctness requirement.
      this.logger.warn(`Redis write failed for ${key}: ${err}`);
    }
  }

  private async readForwardCache(
    key: string,
  ): Promise<ForwardGeocodeResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as ForwardGeocodeResult;
    } catch (err) {
      this.logger.warn(`Redis read failed for ${key}: ${err}`);
      return null;
    }
  }

  private async writeForwardCache(
    key: string,
    value: ForwardGeocodeResult,
  ): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        GeocodingService.FORWARD_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`Redis write failed for ${key}: ${err}`);
    }
  }

  private async acquireLock(cell: string): Promise<boolean> {
    try {
      const res = await this.redis.set(
        `geocode:lock:${cell}`,
        '1',
        'PX',
        GeocodingService.LOCK_TTL_MS,
        'NX',
      );
      return res === 'OK';
    } catch {
      // Fail open: if the lock can't be evaluated, don't block the fetch.
      return true;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
