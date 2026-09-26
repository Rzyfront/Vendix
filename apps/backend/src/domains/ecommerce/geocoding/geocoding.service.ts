import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import {
  crossViaTipoLabel,
  GeocodeCandidate,
  ParsedColombianAddress,
  normalizeColombianAddress,
  parseFreeTextQuery,
  selectBestCandidate,
} from './colombian-address.util';

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
  /**
   * How the coordinate was resolved, in decreasing accuracy order:
   * `exact` (house-numbered Nominatim match) > `intersection` (DANE
   * cross-street computed via Overpass) > `street` (Nominatim matched the
   * named street but not a specific house) > `area` (barrio/suburb
   * centroid, last resort). Optional and purely additive — omitted when the
   * query could not be resolved at all, or on a code path that predates
   * this field. Never treat its absence as an error.
   */
  precision?: 'exact' | 'intersection' | 'street' | 'area';
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
 * Server-side reverse/forward-geocoding proxy so the frontend NEVER calls
 * Nominatim directly.
 *
 * `reverse()` results are cached in Redis for 30 days keyed by a
 * ~1m-precision cell (`lat/lng.toFixed(5)`); the long cache is what keeps us
 * within Nominatim's 1 req/sec usage policy for real traffic. A short
 * per-cell lock provides best-effort single-flight for concurrent misses on
 * the same cell.
 *
 * `forward()` runs a Colombia-specific cascade (see its own doc) over a
 * normalized version of the query (see `colombian-address.util.ts`):
 *   a) DANE intersection via Overpass (when the line parses as
 *      "<viaTipo> <viaNum> # <cruceNum>-<placa>" and a city is known);
 *   b) Nominatim structured search (`street=`/`city=`/`state=`);
 *   c) Nominatim free-text search — the final fallback.
 * At most 3 external requests are fired per call, and a resolved coordinate
 * is cached for 7 days while an unresolved one is cached only 6 hours, so a
 * typo fix or a newly-mapped rural address does not stay "not found" for a
 * week.
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
  /**
   * Forward-geocode cache TTL for a RESOLVED coordinate (7 days) — addresses
   * move far less than a cell. A NULL (unresolved) result is cached far
   * shorter (see {@link FORWARD_NULL_CACHE_TTL_SECONDS}): retrying a bad/new
   * address immediately after a typo fix should not have to wait a week.
   */
  private static readonly FORWARD_CACHE_TTL_SECONDS = 604800;
  /**
   * TTL for a forward-geocode MISS (6 hours). Short enough that a customer
   * who fixes a typo, or a rural/new address that appears in OSM later the
   * same day, is not stuck behind a week-long null cache; long enough to
   * still absorb repeated retries of the same bad query within a session.
   */
  private static readonly FORWARD_NULL_CACHE_TTL_SECONDS = 21600;
  /**
   * Hard cap on cascade ATTEMPTS fired by a single {@link forward} call —
   * i.e. Nominatim requests (the provider the "~1 req/s" usage policy in
   * the class doc actually applies to), fired strictly SEQUENTIALLY so the
   * cap doubles as rate-limiting. The one non-Nominatim attempt
   * ({@link tryIntersection}'s Overpass lookup) reuses the SAME
   * mirror-racing pattern already established for `reverse()`'s cross-street
   * enrichment (4 mirrors queried concurrently, first usable one wins) — a
   * pre-existing pattern for a different provider with no stated 1 req/s
   * policy in this codebase, so it counts as exactly one cascade attempt
   * here regardless of how many mirrors it internally races.
   */
  private static readonly MAX_FORWARD_EXTERNAL_REQUESTS = 3;
  /** Per-step timeouts for the forward cascade. Their sum (7.5s) stays under
   * the ≤8s total budget even in the worst case (three sequential misses). */
  private static readonly INTERSECTION_TIMEOUT_MS = 2500;
  private static readonly STRUCTURED_TIMEOUT_MS = 2500;
  private static readonly FREETEXT_TIMEOUT_MS = 2500;
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
   * Forward-geocode a free-text Colombian address to a coordinate. Used when
   * the customer TYPES the address manually so the map can center on it.
   *
   * Runs a cascade that stops at the first good result (see class doc for
   * the full strategy):
   *   a) DANE intersection — locate the crossing of the primary and
   *      generating streets via Overpass, when the line parses as DANE
   *      nomenclature ("Calle 45 # 12-30") AND a city is known.
   *   b) Nominatim structured search (`street=`, `city=`, `state=`).
   *   c) Nominatim free-text search (`q=`) as the final fallback.
   * At most {@link MAX_FORWARD_EXTERNAL_REQUESTS} external requests are
   * fired, honoring Nominatim's usage policy.
   *
   * `city`/`state` are OPTIONAL and backward-compatible: the current
   * frontend only sends `q` (e.g. "Cra 13 # 62-40, Bogotá, Colombia"), so
   * when they are omitted this parses them out of `query` itself via
   * {@link parseFreeTextQuery}.
   *
   * Cached in Redis by the NORMALIZED query (+ city/state). Unlike the old
   * single-shot implementation, this NEVER throws: a total cascade failure
   * (every attempt errors or comes back empty) degrades to
   * `{ lat: null, lng: null }`, matching {@link reverse}'s "never block
   * checkout" philosophy — forward-geocoding only feeds a non-blocking map
   * preview/warning (see `vendix-address-geocoding` skill), so a 503 here
   * would only ever be swallowed by the caller anyway.
   */
  async forward(
    query: string,
    city?: string,
    state?: string,
  ): Promise<ForwardGeocodeResult> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 3) return { lat: null, lng: null };

    const freeText = parseFreeTextQuery(q);
    const addressLine = freeText.addressLine || q;
    const resolvedCity = (city ?? freeText.city ?? '').trim() || null;
    const resolvedState = (state ?? freeText.state ?? '').trim() || null;
    const parsed = normalizeColombianAddress(addressLine);

    const cacheKey = this.buildForwardCacheKey(
      parsed.normalized,
      resolvedCity,
      resolvedState,
    );
    const cached = await this.readForwardCache(cacheKey);
    if (cached) {
      this.logger.debug(`forward cache HIT ${cacheKey}`);
      return cached;
    }
    this.logger.debug(`forward cache MISS ${cacheKey}`);

    const result = await this.forwardCascade(
      parsed,
      resolvedCity,
      resolvedState,
      q,
    );
    await this.writeForwardCache(cacheKey, result);
    return result;
  }

  /** Cache key over the NORMALIZED line + city + state (see class doc §Caché). */
  private buildForwardCacheKey(
    normalizedLine: string,
    city: string | null,
    state: string | null,
  ): string {
    const parts = [
      normalizedLine.toLowerCase(),
      (city ?? '').toLowerCase(),
      (state ?? '').toLowerCase(),
    ];
    // "v2" bumps the key prefix so the previous 7-day-cached nulls (keyed by
    // raw lowercased `q`) are simply never read again, instead of having to
    // be actively purged.
    return `geocode:fwd:v2:${parts.join('|')}`;
  }

  /**
   * Runs the forward cascade in priority order, stopping at the first
   * attempt that resolves a coordinate. An attempt that is not applicable
   * (e.g. intersection without a known city) is never queued, so the
   * request budget is spent on attempts that can actually succeed.
   */
  private async forwardCascade(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    rawQuery: string,
  ): Promise<ForwardGeocodeResult> {
    type Attempt = () => Promise<ForwardGeocodeResult | null>;
    const attempts: Attempt[] = [];

    if (parsed.isDaneFormat) {
      if (city) {
        attempts.push(() => this.tryIntersection(parsed, city));
      }
      attempts.push(() => this.tryStructuredSearch(parsed, city, state, true));
      // Only spend a slot on the "bare street" structured variant when we
      // did NOT already spend one on the intersection attempt above — this
      // keeps every branch at exactly <= MAX_FORWARD_EXTERNAL_REQUESTS while
      // still always reaching the free-text fallback.
      if (!city) {
        attempts.push(() =>
          this.tryStructuredSearch(parsed, city, state, false),
        );
      }
    }
    attempts.push(() =>
      this.tryFreeText(parsed.normalized || rawQuery, city),
    );

    const capped = attempts.slice(
      0,
      GeocodingService.MAX_FORWARD_EXTERNAL_REQUESTS,
    );

    for (const attempt of capped) {
      let outcome: ForwardGeocodeResult | null;
      try {
        outcome = await attempt();
      } catch (err) {
        this.logger.warn(`Forward geocode attempt failed, trying next: ${err}`);
        outcome = null;
      }
      if (outcome && outcome.lat != null && outcome.lng != null) {
        return outcome;
      }
    }
    return { lat: null, lng: null };
  }

  /**
   * Step (a): locate the DANE intersection (primary via ∩ generating via) via
   * Overpass, within the named city's administrative area. Best-effort: any
   * failure (area not found, ways not found, no geometry close enough)
   * returns null so the cascade falls through to (b).
   */
  private async tryIntersection(
    parsed: ParsedColombianAddress,
    city: string,
  ): Promise<ForwardGeocodeResult | null> {
    const crossTipo = crossViaTipoLabel(parsed.viaTipo);
    if (!parsed.viaTipo || !parsed.viaNum || !parsed.cruceNum || !crossTipo) {
      return null;
    }

    const primaryVariants = this.buildOsmNameVariants(
      parsed.viaTipo,
      parsed.viaNum,
    );
    const crossVariants = this.buildOsmNameVariants(crossTipo, parsed.cruceNum);

    const query =
      `[out:json][timeout:5];` +
      `area["name"="${this.escapeOverpassString(city)}"]->.a;` +
      `(way(area.a)["highway"]["name"~"${this.toOverpassRegex(primaryVariants)}",i];` +
      `way(area.a)["highway"]["name"~"${this.toOverpassRegex(crossVariants)}",i];);` +
      `out tags geom;`;

    let elements: OverpassElement[];
    try {
      elements = await this.raceOverpassMirrors(
        query,
        GeocodingService.INTERSECTION_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(`Intersection Overpass lookup failed for ${city}: ${err}`);
      return null;
    }
    if (elements.length === 0) return null;

    const primaryWays = elements.filter((el) =>
      this.matchesAnyVariant(el.tags?.name, primaryVariants),
    );
    const crossWays = elements.filter((el) =>
      this.matchesAnyVariant(el.tags?.name, crossVariants),
    );
    if (primaryWays.length === 0 || crossWays.length === 0) return null;

    const point = this.nearestPointBetweenWays(primaryWays, crossWays);
    if (!point) return null;

    return { lat: point.lat, lng: point.lng, precision: 'intersection' };
  }

  /**
   * Step (b): Nominatim structured search. `full=true` sends the complete
   * "<viaTipo> <viaNum> # <cruceNum>-<placa>" street value; `full=false`
   * sends only "<viaTipo> <viaNum>" (used when no city is known and the
   * cascade can afford a second structured attempt).
   */
  private async tryStructuredSearch(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    full: boolean,
  ): Promise<ForwardGeocodeResult | null> {
    if (!parsed.viaTipo || !parsed.viaNum) return null;
    const street =
      full && parsed.cruceNum && parsed.placa
        ? `${parsed.viaTipo} ${parsed.viaNum} # ${parsed.cruceNum}-${parsed.placa}`
        : `${parsed.viaTipo} ${parsed.viaNum}`;

    const params = new URLSearchParams({
      format: 'jsonv2',
      street,
      country: 'Colombia',
      countrycodes: 'co',
      addressdetails: '1',
      limit: '5',
      'accept-language': 'es',
    });
    if (city) params.set('city', city);
    if (state) params.set('state', state);

    const candidates = await this.fetchNominatimSearch(
      params,
      GeocodingService.STRUCTURED_TIMEOUT_MS,
    );
    const best = selectBestCandidate(candidates, city);
    if (!best) return null;
    return {
      lat: Number(best.candidate.lat),
      lng: Number(best.candidate.lon),
      precision: best.precision,
    };
  }

  /** Step (c): Nominatim free-text search — the final, most forgiving fallback. */
  private async tryFreeText(
    q: string,
    city: string | null,
  ): Promise<ForwardGeocodeResult | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      q,
      countrycodes: 'co',
      addressdetails: '1',
      limit: '5',
      'accept-language': 'es',
    });

    const candidates = await this.fetchNominatimSearch(
      params,
      GeocodingService.FREETEXT_TIMEOUT_MS,
    );
    const best = selectBestCandidate(candidates, city);
    if (!best) return null;
    return {
      lat: Number(best.candidate.lat),
      lng: Number(best.candidate.lon),
      precision: best.precision,
    };
  }

  /**
   * Shared Nominatim `/search` fetch for the structured and free-text steps.
   * Never throws: a network error, non-2xx, or invalid JSON all resolve to
   * an empty candidate list so the caller just moves to the next cascade
   * step instead of aborting the whole request.
   */
  private async fetchNominatimSearch(
    params: URLSearchParams,
    timeoutMs: number,
  ): Promise<GeocodeCandidate[]> {
    const url = `${GeocodingService.NOMINATIM_SEARCH_BASE}?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Vendix/1.0 (soporte@vendix.online)' },
      });
      if (!response.ok) {
        this.logger.warn(`Nominatim search HTTP ${response.status} for ${url}`);
        return [];
      }
      const json = (await response.json()) as GeocodeCandidate[];
      return Array.isArray(json) ? json : [];
    } catch (err) {
      this.logger.warn(`Nominatim search failed for ${url}: ${err}`);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Builds a small set of literal OSM name variants for a via type + number,
   * so the Overpass intersection lookup tolerates the naming differences OSM
   * contributors commonly use (e.g. "Calle 45A" vs "Calle 45 A", or a name
   * with/without a trailing "Bis").
   */
  private buildOsmNameVariants(tipo: string, num: string): string[] {
    const variants = new Set<string>();
    const base = num.trim();
    variants.add(`${tipo} ${base}`);

    const noBis = base.replace(/\s*bis\b/i, '').trim();
    if (noBis && noBis !== base) variants.add(`${tipo} ${noBis}`);

    const m = base.match(/^(\d+)([A-Za-z])(.*)$/);
    if (m) variants.add(`${tipo} ${m[1]} ${m[2]}${m[3]}`.trim());

    return Array.from(variants);
  }

  /** Builds an Overpass regex-value (`~"...",i`) matching any of the variants. */
  private toOverpassRegex(variants: string[]): string {
    const escaped = variants.map((v) =>
      v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    return `^(${escaped.join('|')})`;
  }

  /** Escapes a value embedded in an Overpass QL string literal (`"..."`). */
  private escapeOverpassString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /** Accent/case-insensitive check that `name` matches (or extends) any variant. */
  private matchesAnyVariant(name: string | undefined, variants: string[]): boolean {
    if (!name) return false;
    const n = this.norm(name);
    return variants.some((v) => {
      const nv = this.norm(v);
      return n === nv || n.startsWith(nv);
    });
  }

  /**
   * Finds the closest point between any primary-way vertex and any
   * cross-way's geometry, within a small tolerance — an OSM intersection
   * usually shares an exact node, but a few meters of slack tolerates ways
   * that were digitized slightly apart. Returns null when nothing is close
   * enough to trust as an intersection.
   */
  private nearestPointBetweenWays(
    primaryWays: OverpassElement[],
    crossWays: OverpassElement[],
  ): { lat: number; lng: number } | null {
    const THRESHOLD_M = 40;
    let best: { lat: number; lng: number; dist: number } | null = null;

    for (const pWay of primaryWays) {
      for (const vertex of pWay.geometry ?? []) {
        for (const cWay of crossWays) {
          const dist = this.minDistanceToWayMeters(
            vertex.lat,
            vertex.lon,
            cWay.geometry ?? [],
          );
          if (dist < THRESHOLD_M && (!best || dist < best.dist)) {
            best = { lat: vertex.lat, lng: vertex.lon, dist };
          }
        }
      }
    }
    return best ? { lat: best.lat, lng: best.lng } : null;
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

    return this.raceOverpassMirrors(query, GeocodingService.OVERPASS_TIMEOUT_MS);
  }

  /**
   * Races an arbitrary Overpass QL `query` across all configured mirrors
   * (see {@link overpassNamedRoads} for why racing beats trying in order),
   * used both by the reverse-geocode cross-street lookup and by the forward
   * cascade's intersection lookup ({@link tryIntersection}) — each with its
   * own `timeoutMs` budget. Returns `[]` when every mirror fails or has
   * nothing usable; never throws.
   */
  private async raceOverpassMirrors(
    query: string,
    timeoutMs: number,
  ): Promise<OverpassElement[]> {
    const attempts = GeocodingService.OVERPASS_MIRRORS.map((url) =>
      this.fetchOverpassMirror(url, query, timeoutMs),
    );
    try {
      // First FULFILLED attempt wins. A mirror that is reachable but empty
      // rejects (see fetchOverpassMirror) so a populated mirror beats a
      // fast-but-empty one. Equivalent to Promise.any, hand-rolled because the
      // backend targets ES2020 (Promise.any needs the ES2021 lib).
      return await this.firstFulfilled(attempts);
    } catch {
      // Every mirror failed or returned nothing usable → caller degrades.
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
    timeoutMs: number = GeocodingService.OVERPASS_TIMEOUT_MS,
  ): Promise<OverpassElement[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

  /**
   * A RESOLVED coordinate is cached for 7 days; an unresolved (`lat`/`lng`
   * null) result only for 6 hours — see the TTL constants' doc for why the
   * null case is deliberately much shorter.
   */
  private async writeForwardCache(
    key: string,
    value: ForwardGeocodeResult,
  ): Promise<void> {
    const ttl =
      value.lat == null || value.lng == null
        ? GeocodingService.FORWARD_NULL_CACHE_TTL_SECONDS
        : GeocodingService.FORWARD_CACHE_TTL_SECONDS;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
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
