import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import {
  crossViaTipoLabel,
  GeocodeCandidate,
  ParsedColombianAddress,
  ViaTipo,
  normalizeColombianAddress,
  parseFreeTextQuery,
  selectBestCandidate,
} from './colombian-address.util';
import { GoogleGeocodingProvider } from './google-geocoding.provider';

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
   * `exact` (house-numbered match) > `interpolated` (DANE plate walked
   * `placa` metres from the corner along the main street, or Google
   * RANGE_INTERPOLATED) > `intersection` (DANE cross-street corner) >
   * `street` (named street matched, no specific house) > `area`
   * (barrio/suburb/vereda centroid, last resort). Optional and purely
   * additive — omitted when the query could not be resolved at all. Never
   * treat its absence as an error.
   */
  precision?: GeocodePrecision;
  /** Provider that produced the winning coordinate. */
  source?: 'osm' | 'google';
  /** Canonical, human-readable address the coordinate belongs to. */
  label?: string;
}

export type GeocodePrecision =
  | 'exact'
  | 'interpolated'
  | 'intersection'
  | 'street'
  | 'area';

/**
 * Optional hints for {@link GeocodingService.forward}. Every field is
 * additive: omitting them keeps the plain `(query, city, state)` behaviour.
 */
export interface ForwardGeocodeOptions {
  /** DANE municipality code (5 digits) — pins the municipality exactly. */
  municipalityCode?: string;
  /**
   * Fallback geographic bias when no city is known (e.g. the shipping
   * method origin of the store). Used only to bound/rank candidates.
   */
  bias?: { lat: number; lng: number };
}

interface MunicipalityBbox {
  south: number;
  north: number;
  west: number;
  east: number;
}

/** Sequential external-request budget shared across one `forward()` call. */
class RequestBudget {
  constructor(private remaining: number) {}
  canSpend(): boolean {
    return this.remaining > 0;
  }
  spend(): void {
    this.remaining -= 1;
  }
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

/** Subset of an Overpass `way`/`relation` element we read. */
interface OverpassElement {
  tags?: { name?: string; highway?: string; ref?: string };
  geometry?: OverpassPoint[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
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
 * `forward()` runs a Colombia-specific cascade over a normalized/structured
 * version of the query (see `colombian-address.util.ts`), bounded to a
 * resolved municipality bounding box so a same-named street in another city
 * can never win:
 *   0) Resolve the municipality bbox (Nominatim `boundingbox`, Redis-cached
 *      30 days; Overpass administrative-boundary name-variant lookup as a
 *      fallback) — or a ~25km box around `opts.bias` when no city is known.
 *   a) Rural/manzana kinds search the vereda/corregimiento/barrio/finca name
 *      as an area within the bbox (`precision: 'area'`).
 *   b) DANE intersection via Overpass (primary ∩ generating street), with
 *      PLATE INTERPOLATION walking `placa` metres along the main way from
 *      the corner when a direction can be determined.
 *   c) Nominatim structured search (`street="<placa> <viaTipo> <viaNum>"`).
 *   d) Nominatim free-text search — the final fallback.
 * A resolved coordinate outside the bbox is discarded. Once the best OSM
 * result is null / 'street' / 'area', {@link GoogleGeocodingProvider} is
 * tried as a paid fallback (only if a key + quota are available) and wins
 * only when it lands inside the bbox with a STRICTLY better precision.
 */
@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);

  /** 30 days, per the reverse-geocoding cache contract. */
  private static readonly CACHE_TTL_SECONDS = 2592000;
  /** Best-effort single-flight lock TTL (ms). */
  private static readonly LOCK_TTL_MS = 1500;
  private static readonly FETCH_TIMEOUT_MS = 3500;
  private static readonly NOMINATIM_BASE =
    'https://nominatim.openstreetmap.org/reverse';
  private static readonly NOMINATIM_SEARCH_BASE =
    'https://nominatim.openstreetmap.org/search';
  private static readonly FORWARD_CACHE_TTL_SECONDS = 604800;
  private static readonly FORWARD_NULL_CACHE_TTL_SECONDS = 21600;
  /** 30 days — a municipality's administrative boundary essentially never moves. */
  private static readonly MUNI_BBOX_CACHE_TTL_SECONDS = 2592000;
  /** Short TTL for an UNRESOLVED municipality bbox, so a typo'd city name self-heals soon. */
  private static readonly MUNI_BBOX_NULL_CACHE_TTL_SECONDS = 86400;
  /**
   * Hard cap on external requests fired by a single {@link forward} call
   * (Nominatim + Overpass, the latter counted once per mirror-race). Kept
   * low enough to honor Nominatim's ~1 req/s usage policy even in the
   * worst case (bbox resolution + intersection + structured + free-text).
   */
  private static readonly MAX_FORWARD_EXTERNAL_REQUESTS = 5;
  /**
   * Measured live against the real mirrors (2026-09-27): `fr` answers the
   * cross-then-around query in 1-4s, `de` is intermittently 406/504, and
   * `mail.ru` is slow but usable. 2.5s was cutting off `fr` before it could
   * even finish the cheaper query shape below — 8s gives it (and `de` on a
   * slow day) room without blowing the overall forward budget.
   */
  private static readonly INTERSECTION_TIMEOUT_MS = 8000;
  private static readonly STRUCTURED_TIMEOUT_MS = 2500;
  private static readonly FREETEXT_TIMEOUT_MS = 2500;
  /** Plate walks beyond this are suspicious (likely a mis-detected axis) — keep the corner instead. */
  private static readonly MAX_INTERPOLATION_METERS = 150;
  /**
   * `overpass.osm.ch` is Swiss-infrastructure-only and answers every query
   * with an empty result set instantly — it never contributes a usable
   * response and was removed rather than raced. Ordered by measured
   * reliability: `fr` first (fastest, most consistent), `de` next
   * (intermittent 406/504), `mail.ru` last (works but slow). Order does not
   * change the racing behaviour (`raceOverpassMirrors` fires all of them
   * concurrently) — it is purely for readability/maintenance.
   */
  private static readonly OVERPASS_MIRRORS = [
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  private static readonly OVERPASS_TIMEOUT_MS = 8000;
  private static readonly CROSS_STREET_RADIUS_M = 350;
  /** ~25km half-width box used when only a bias point (no city) is known. */
  private static readonly BIAS_BBOX_RADIUS_KM = 25;
  /**
   * Hard wall-clock ceiling for one `forward()` call, counted from the
   * moment the cascade starts (municipality bbox resolution included). A
   * successful result is cached 7 days, so a slow-but-eventually-correct
   * cascade is not worth risking a caller-side timeout for — once exceeded,
   * the cascade stops advancing to the next attempt with whatever it has.
   */
  private static readonly FORWARD_OVERALL_BUDGET_MS = 15000;
  /**
   * Plausibility gate for an Overpass intersection corner (2026-09-27 live
   * finding): "Calle 14 # 26-13, Bogotá" matched an OSM way pair named
   * "Calle 14"/"Carrera 26" ~15km from the real Ricaurte/Paloquemao corner
   * (Bogotá D.C.'s administrative bbox reaches rural corregimientos far from
   * the urban core, so a bbox-only filter cannot reject it) — the cascade
   * reported it as 'interpolated' with false confidence. A corner is now
   * only accepted within this radius of an independent anchor (same-address
   * Nominatim search, or failing that the primary street's own centroid);
   * otherwise it is discarded and the cascade falls through to Nominatim's
   * honest 'street'/'area' precision. See {@link resolveIntersectionAnchor}.
   */
  private static readonly INTERSECTION_ANCHOR_MAX_METERS = 2000;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly googleProvider: GoogleGeocodingProvider,
  ) {}

  /**
   * Reverse-geocode a coordinate to a normalized address. Never throws on a
   * provider problem — degrades to a minimal empty {@link NormalizedAddress}.
   * Degraded results are intentionally NOT written to the 30-day cache.
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
    if (!degraded) {
      await this.writeCache(cacheKey, address);
    }
    return address;
  }

  /**
   * Forward-geocode a free-text Colombian address to a coordinate. Used when
   * the customer TYPES the address manually so the map can center on it, or
   * when a shipping quote needs a distance-accurate point.
   *
   * `city`/`state` are OPTIONAL and backward-compatible: when omitted they
   * are parsed out of `query` itself via {@link parseFreeTextQuery}. `opts`
   * is fully additive (see {@link ForwardGeocodeOptions}).
   *
   * NEVER throws: a total cascade failure degrades to `{ lat: null, lng: null }`.
   */
  async forward(
    query: string,
    city?: string,
    state?: string,
    opts?: ForwardGeocodeOptions,
  ): Promise<ForwardGeocodeResult> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 3) return { lat: null, lng: null };

    const freeText = parseFreeTextQuery(q);
    const addressLine = freeText.addressLine || q;
    const resolvedCity = (city ?? freeText.city ?? '').trim() || null;
    const resolvedState = (state ?? freeText.state ?? '').trim() || null;
    const parsed = normalizeColombianAddress(addressLine);
    const municipalityCode = opts?.municipalityCode?.trim() || null;
    const bias = opts?.bias ?? null;

    const cacheKey = this.buildForwardCacheKey(
      parsed.normalized,
      resolvedCity,
      resolvedState,
      municipalityCode,
      bias,
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
      bias,
    );
    await this.writeForwardCache(cacheKey, result);
    return result;
  }

  /**
   * Cache key over the NORMALIZED line + city + state + municipalityCode.
   * `bias` only enters the key when there is NO other location context
   * (no city, no municipalityCode) — a quote step (bias = first shipping
   * method's origin) and the confirm step (bias = the CHOSEN method's
   * origin) for the same address+city MUST read the same key, or they could
   * measure distance from different points (vendix-shipping-distance-pricing
   * rule 2). When it does enter the key, it is rounded to 2 decimals
   * (~1.1km cells) so nearby bias points still share a cascade run.
   */
  private buildForwardCacheKey(
    normalizedLine: string,
    city: string | null,
    state: string | null,
    municipalityCode: string | null,
    bias: { lat: number; lng: number } | null,
  ): string {
    const parts = [
      normalizedLine.toLowerCase(),
      (city ?? '').toLowerCase(),
      (state ?? '').toLowerCase(),
      municipalityCode ?? '',
    ];
    const hasLocationContext = Boolean(
      (city && city.trim()) || municipalityCode,
    );
    if (!hasLocationContext && bias) {
      parts.push(`bias:${bias.lat.toFixed(2)},${bias.lng.toFixed(2)}`);
    }
    // v4: bumped from v3 when the intersection cascade's Overpass query
    // shape and street-name matching changed materially (Avenida-prefix
    // matching, cuadrante-exact matching, cross-then-around scoping,
    // Bogotá/Soacha corner disambiguation) — a v3-cached 'street'/'area'
    // result for an address that now resolves to 'intersection'/
    // 'interpolated' must not shadow the improved result for its 7-day TTL.
    // v5: bumped from v4 when the intersection corner plausibility gate was
    // added (2026-09-27 live finding: "Calle 14 # 26-13, Bogotá" matched an
    // OSM way pair ~15km from the real corner and was cached as
    // 'interpolated' with false confidence) — a v4-cached false-confident
    // corner must not shadow the now-gated, honest result for its 7-day TTL.
    return `geocode:fwd:v5:${parts.join('|')}`;
  }

  // ------------------------------------------------------------- Cascade

  private async forwardCascade(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    rawQuery: string,
    bias: { lat: number; lng: number } | null,
  ): Promise<ForwardGeocodeResult> {
    const budget = new RequestBudget(
      GeocodingService.MAX_FORWARD_EXTERNAL_REQUESTS,
    );
    const deadline = Date.now() + GeocodingService.FORWARD_OVERALL_BUDGET_MS;

    let bbox: MunicipalityBbox | null = null;
    if (city) {
      bbox = await this.resolveMunicipalityBbox(city, state, budget);
    } else if (bias) {
      bbox = this.bboxAroundPoint(
        bias.lat,
        bias.lng,
        GeocodingService.BIAS_BBOX_RADIUS_KM,
      );
    }

    type Attempt = () => Promise<ForwardGeocodeResult | null>;
    const attempts: Attempt[] = [];

    if (parsed.kind === 'rural') {
      attempts.push(() => this.tryRural(parsed, city, state, bbox, budget));
    } else if (parsed.kind === 'manzana') {
      const name =
        parsed.urbanizacion ??
        parsed.barrio ??
        parsed.conjunto ??
        parsed.complementos.manzana ??
        null;
      attempts.push(() => this.tryAreaName(name, city, state, bbox, budget));
    } else {
      if ((parsed.kind === 'dane' || parsed.kind === 'interseccion') && city) {
        attempts.push(() =>
          this.tryIntersection(parsed, city, state, bbox, bias, budget),
        );
      }
      if (parsed.viaTipo && parsed.viaNum) {
        attempts.push(() =>
          this.tryStructuredSearch(parsed, city, state, bbox, budget),
        );
      }
      attempts.push(() =>
        this.tryFreeText(parsed, city, state, rawQuery, bbox, budget),
      );
    }

    let best: ForwardGeocodeResult | null = null;
    for (const attempt of attempts) {
      if (!budget.canSpend()) break;
      if (Date.now() > deadline) {
        this.logger.warn(
          'Forward geocode overall time budget exceeded, stopping cascade early',
        );
        break;
      }
      let outcome: ForwardGeocodeResult | null;
      try {
        outcome = await attempt();
      } catch (err) {
        this.logger.warn(`Forward geocode attempt failed, trying next: ${err}`);
        outcome = null;
      }
      if (outcome && outcome.lat != null && outcome.lng != null) {
        if (bbox && !this.isWithinBbox(outcome.lat, outcome.lng, bbox)) {
          continue; // a candidate outside the municipality is never usable
        }
        best = outcome;
        if (
          this.precisionRank(outcome.precision) >=
          this.precisionRank('intersection')
        ) {
          break; // stop the cascade at the first result >= intersection
        }
      }
    }

    if (
      (!best || best.precision === 'street' || best.precision === 'area') &&
      Date.now() <= deadline
    ) {
      const googleResult = await this.tryGoogleFallback(
        parsed,
        city,
        state,
        bbox,
        best,
      );
      if (googleResult) best = googleResult;
    }

    if (!best) return { lat: null, lng: null };
    return {
      ...best,
      source: best.source ?? 'osm',
      label: best.label ?? this.buildLabel(parsed, city),
    };
  }

  private buildLabel(
    parsed: ParsedColombianAddress,
    city: string | null,
  ): string {
    const line = parsed.normalized || parsed.raw;
    return city ? `${line}, ${city}` : line;
  }

  private precisionRank(p?: GeocodePrecision | null): number {
    switch (p) {
      case 'exact':
        return 5;
      case 'interpolated':
        return 4;
      case 'intersection':
        return 3;
      case 'street':
        return 2;
      case 'area':
        return 1;
      default:
        return 0;
    }
  }

  // ------------------------------------------------------- Municipality bbox

  /**
   * Center of the municipality bounding box. VISUAL FRAMING ONLY — never a
   * delivery location. Never throws: any failure resolves to `null`.
   */
  async municipalityCenter(
    city: string,
    state?: string | null,
  ): Promise<{ lat: number; lng: number } | null> {
    try {
      const cleanCity = (city ?? '').trim();
      if (cleanCity.length < 2) return null;
      const bbox = await this.resolveMunicipalityBbox(
        cleanCity,
        state?.trim() || null,
        new RequestBudget(1),
      );
      if (!bbox) return null;
      return {
        lat: (bbox.south + bbox.north) / 2,
        lng: (bbox.west + bbox.east) / 2,
      };
    } catch {
      return null;
    }
  }

  private async resolveMunicipalityBbox(
    city: string,
    state: string | null,
    budget: RequestBudget,
  ): Promise<MunicipalityBbox | null> {
    const cacheKey = `geocode:muni:bbox:v1:${this.norm(city)}|${this.norm(state ?? '')}`;
    const cached = await this.readMuniBboxCache(cacheKey);
    if (cached !== undefined) return cached;

    let bbox: MunicipalityBbox | null = null;
    if (budget.canSpend()) {
      budget.spend();
      bbox = await this.fetchMunicipalityBboxNominatim(city, state);
    }
    if (!bbox && budget.canSpend()) {
      budget.spend();
      bbox = await this.fetchMunicipalityBboxOverpass(city);
    }
    await this.writeMuniBboxCache(cacheKey, bbox);
    return bbox;
  }

  private async fetchMunicipalityBboxNominatim(
    city: string,
    state: string | null,
  ): Promise<MunicipalityBbox | null> {
    const params = new URLSearchParams({
      format: 'jsonv2',
      city,
      country: 'Colombia',
      countrycodes: 'co',
      limit: '1',
      addressdetails: '1',
    });
    if (state) params.set('state', state);

    const candidates = await this.fetchNominatimSearch(
      params,
      GeocodingService.STRUCTURED_TIMEOUT_MS,
    );
    const hit = candidates.find(
      (c) => Array.isArray(c.boundingbox) && c.boundingbox.length === 4,
    );
    if (!hit?.boundingbox) return null;
    const [south, north, west, east] = hit.boundingbox.map(Number);
    if ([south, north, west, east].some((n) => Number.isNaN(n))) return null;
    return { south, north, west, east };
  }

  private async fetchMunicipalityBboxOverpass(
    city: string,
  ): Promise<MunicipalityBbox | null> {
    const variants = this.buildCityNameVariants(city);
    const query =
      `[out:json][timeout:8];` +
      `relation["boundary"="administrative"]["admin_level"~"^(6|7|8)$"]["name"~"${this.toOverpassRegex(
        variants,
      )}",i];out bb;`;

    let elements: OverpassElement[];
    try {
      elements = await this.raceOverpassMirrors(
        query,
        GeocodingService.OVERPASS_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(
        `Municipality bbox Overpass lookup failed for ${city}: ${err}`,
      );
      return null;
    }
    const withBounds = elements.find((el) => el.bounds);
    if (!withBounds?.bounds) return null;
    return {
      south: withBounds.bounds.minlat,
      north: withBounds.bounds.maxlat,
      west: withBounds.bounds.minlon,
      east: withBounds.bounds.maxlon,
    };
  }

  /** Common accent/suffix variants so "Bogotá", "Bogotá, D.C." and "Bogotá D.C." all resolve. */
  private buildCityNameVariants(city: string): string[] {
    const variants = new Set<string>();
    const base = city.trim();
    variants.add(base);
    const stripped = base.replace(/,?\s*D\.?\s*C\.?$/i, '').trim();
    if (stripped && stripped !== base) variants.add(stripped);
    if (/^bogot[aá]$/i.test(stripped || base)) {
      variants.add('Bogotá');
      variants.add('Bogotá, D.C.');
      variants.add('Bogotá D.C.');
      variants.add('Bogotá D.C');
    }
    return Array.from(variants);
  }

  private bboxAroundPoint(
    lat: number,
    lng: number,
    radiusKm: number,
  ): MunicipalityBbox {
    const dLat = radiusKm / 111.32;
    const cos = Math.cos((lat * Math.PI) / 180);
    const dLng = radiusKm / (111.32 * (Math.abs(cos) > 0.01 ? cos : 0.01));
    return {
      south: lat - dLat,
      north: lat + dLat,
      west: lng - dLng,
      east: lng + dLng,
    };
  }

  private isWithinBbox(
    lat: number,
    lng: number,
    bbox: MunicipalityBbox,
  ): boolean {
    return (
      lat >= bbox.south &&
      lat <= bbox.north &&
      lng >= bbox.west &&
      lng <= bbox.east
    );
  }

  private filterWithinBbox(
    candidates: GeocodeCandidate[],
    bbox: MunicipalityBbox | null,
  ): GeocodeCandidate[] {
    if (!bbox) return candidates;
    return candidates.filter((c) => {
      const lat = Number(c.lat);
      const lon = Number(c.lon);
      if (Number.isNaN(lat) || Number.isNaN(lon)) return false;
      return this.isWithinBbox(lat, lon, bbox);
    });
  }

  // ------------------------------------------------------------ Rural/area

  private async tryRural(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    bbox: MunicipalityBbox | null,
    budget: RequestBudget,
  ): Promise<ForwardGeocodeResult | null> {
    const r = parsed.rural;
    if (!r) return null;

    if (r.km && r.via) {
      const roadPoint = await this.tryRoadPoint(
        r.via,
        Number(r.km) * 1000,
        bbox,
        budget,
      );
      if (roadPoint) return roadPoint;
    }

    const name = r.finca ?? r.vereda ?? r.corregimiento ?? r.sector ?? null;
    return this.tryAreaName(name, city, state, bbox, budget);
  }

  /** Best-effort: locate a named/ref'd road via Overpass and walk `metres` along it. */
  private async tryRoadPoint(
    viaText: string,
    metres: number,
    bbox: MunicipalityBbox | null,
    budget: RequestBudget,
  ): Promise<ForwardGeocodeResult | null> {
    if (!budget.canSpend()) return null;
    const endpoints = viaText
      .split('-')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!endpoints.length) return null;

    budget.spend();
    const query =
      `[out:json][timeout:6];` +
      `(way["highway"]["name"~"${this.toOverpassRegex(endpoints)}",i];` +
      `way["highway"]["ref"~"${this.toOverpassRegex(endpoints)}",i];);out tags geom;`;

    let elements: OverpassElement[];
    try {
      elements = await this.raceOverpassMirrors(
        query,
        GeocodingService.INTERSECTION_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(
        `Rural road Overpass lookup failed for "${viaText}": ${err}`,
      );
      return null;
    }
    const way = elements.find((el) => (el.geometry?.length ?? 0) >= 2);
    if (!way?.geometry) return null;

    const walked =
      this.walkDirection(way.geometry, 0, 1, metres) ?? way.geometry[0];
    if (
      bbox &&
      !this.isWithinBbox(walked.lat, walked.lon ?? walked.lon, bbox)
    ) {
      // no-op guard kept simple below
    }
    const point = { lat: walked.lat, lng: walked.lon };
    if (bbox && !this.isWithinBbox(point.lat, point.lng, bbox)) return null;
    return { lat: point.lat, lng: point.lng, precision: 'area' };
  }

  private async tryAreaName(
    name: string | null,
    city: string | null,
    state: string | null,
    bbox: MunicipalityBbox | null,
    budget: RequestBudget,
  ): Promise<ForwardGeocodeResult | null> {
    if (!name) return bbox ? this.bboxCentreResult(bbox) : null;
    if (!budget.canSpend()) return bbox ? this.bboxCentreResult(bbox) : null;

    budget.spend();
    const q = [name, city, state, 'Colombia'].filter(Boolean).join(', ');
    const params = new URLSearchParams({
      format: 'jsonv2',
      q,
      countrycodes: 'co',
      addressdetails: '1',
      limit: '5',
      'accept-language': 'es',
    });
    this.applyViewbox(params, bbox);

    const candidates = await this.fetchNominatimSearch(
      params,
      GeocodingService.FREETEXT_TIMEOUT_MS,
    );
    const filtered = this.filterWithinBbox(candidates, bbox);
    if (filtered.length) {
      const c = filtered[0];
      return { lat: Number(c.lat), lng: Number(c.lon), precision: 'area' };
    }
    return bbox ? this.bboxCentreResult(bbox) : null;
  }

  private bboxCentreResult(bbox: MunicipalityBbox): ForwardGeocodeResult {
    return {
      lat: (bbox.south + bbox.north) / 2,
      lng: (bbox.west + bbox.east) / 2,
      precision: 'area',
    };
  }

  // -------------------------------------------------------- Intersection

  private async tryIntersection(
    parsed: ParsedColombianAddress,
    city: string,
    state: string | null,
    bbox: MunicipalityBbox | null,
    bias: { lat: number; lng: number } | null,
    budget: RequestBudget,
  ): Promise<ForwardGeocodeResult | null> {
    const crossTipo: ViaTipo | null =
      parsed.kind === 'interseccion'
        ? parsed.cruceTipo
        : crossViaTipoLabel(parsed.viaTipo);
    if (!parsed.viaTipo || !parsed.viaNum || !parsed.cruceNum || !crossTipo)
      return null;
    if (!budget.canSpend()) return null;

    const primaryVariants = this.buildOsmNameVariants(
      parsed.viaTipo,
      parsed.viaNum,
      parsed.viaLetra,
      parsed.viaBis,
      parsed.viaCuadrante,
    );
    const crossVariants = this.buildOsmNameVariants(
      crossTipo,
      parsed.cruceNum,
      parsed.cruceLetra,
      parsed.cruceBis,
      parsed.cruceCuadrante,
    );
    // Without a resolved municipality bbox there is no safe scope to search
    // Overpass within (a bare name search risks matching a same-named street
    // anywhere in Colombia) — let structured/free-text Nominatim search
    // handle it instead, since those already carry `city`/`state` params.
    if (!bbox) return null;

    // Cross street first, bounded to the ALREADY-RESOLVED municipality bbox
    // (a literal bbox filter, not a live `area["boundary"=...]` lookup — an
    // administrative-boundary Overpass query for a municipality the size of
    // Bogotá was measured live to take 15-20s and time out even at an 8s
    // budget, while the same query with a literal bbox filter answers in
    // ~5s). The primary street is then searched only `around` that cross
    // street (40m) instead of across the whole city, which is both far
    // cheaper for Overpass to evaluate than two city-wide `out geom` sets
    // and a second, independent guard against matching a same-named street
    // on the far side of town. Because the bbox is a rectangle (not a
    // polygon), it can still admit a corner from a bordering municipality
    // (the measured Bogotá/Soacha "Calle 32 × Carrera 7" collision) —
    // {@link selectBestCorner} is what actually disambiguates that case.
    const query =
      `[out:json][timeout:8];` +
      `way["highway"]["name"~"${this.toStreetOverpassRegex(crossVariants)}",i]` +
      `(${bbox.south},${bbox.west},${bbox.north},${bbox.east})->.b;` +
      `way["highway"]["name"~"${this.toStreetOverpassRegex(primaryVariants)}",i](around.b:40)->.a;` +
      `(.a;.b;);out tags geom;`;

    budget.spend();
    let elements: OverpassElement[];
    try {
      elements = await this.raceOverpassMirrors(
        query,
        GeocodingService.INTERSECTION_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.warn(
        `Intersection Overpass lookup failed for ${city}: ${err}`,
      );
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

    const cornerCandidate = this.selectBestCorner(
      primaryWays,
      crossWays,
      bbox,
      bias,
    );
    if (!cornerCandidate) return null;
    const corner = { lat: cornerCandidate.lat, lng: cornerCandidate.lng };

    // Plausibility gate — ONLY for an isolated match (candidateCount === 1).
    // Live 2026-09-27 finding: a real, densely-tagged urban grid intersection
    // (e.g. Carrera 7 x Calle 32) produces MANY nearby way fragments once
    // filtered to the bbox (Overpass returned 15+ clustered candidates there),
    // so `selectBestCorner`'s own proximity-to-bbox-center/bias tie-break
    // already self-corroborates a multi-candidate result — no extra check
    // needed, and none is applied here for that case.
    //
    // A genuinely wrong match (Calle 14 x Carrera 26 resolving to an isolated
    // rural corregimiento ~15km from the real Ricaurte/Paloquemao corner) is
    // structurally different: Overpass found exactly ONE matched pair for the
    // whole city-wide bbox, with no alternative cluster to corroborate it.
    // That is the case this gate targets: cross-check the sole candidate
    // against an independent anchor (same-address Nominatim search, or the
    // primary street's own centroid) and discard it if implausible.
    //
    // NOTE: Nominatim's structured search was empirically proven (live,
    // 2026-09-27) to be an UNRELIABLE anchor for common/long Bogotá streets
    // regardless of house-number qualification — its closest of 10 ranked
    // results for "Carrera 7" sat 5.6km+ from a verified-correct corner. That
    // is exactly why this gate is scoped to the single-candidate path only:
    // applying it universally caused false rejections of legitimate,
    // multi-candidate corners on common streets.
    if (cornerCandidate.candidateCount <= 1) {
      const anchor = await this.resolveIntersectionAnchor(
        parsed,
        city,
        state,
        bbox,
        primaryWays,
        budget,
      );
      if (!anchor) {
        // No independent anchor at all AND no alternative candidate to
        // corroborate against — cannot verify this corner, discard it.
        return null;
      }
      const anchorDistM = this.approxMeters(
        corner.lat,
        corner.lng,
        anchor.lat,
        anchor.lng,
      );
      if (anchorDistM > GeocodingService.INTERSECTION_ANCHOR_MAX_METERS) {
        this.logger.warn(
          `Intersection corner rejected: ${anchorDistM.toFixed(0)}m from ` +
            `${anchor.source} anchor (>${GeocodingService.INTERSECTION_ANCHOR_MAX_METERS}m) — ` +
            `falling back to Nominatim's own precision`,
        );
        return null;
      }
    }

    if (parsed.placa) {
      const placaMeters = Number(parsed.placa.replace(/[^\d]/g, ''));
      if (
        Number.isFinite(placaMeters) &&
        placaMeters > 0 &&
        placaMeters <= GeocodingService.MAX_INTERPOLATION_METERS
      ) {
        const walked = this.walkAlongWayFromPoint(
          primaryWays,
          corner,
          placaMeters,
        );
        if (
          walked &&
          (!bbox || this.isWithinBbox(walked.lat, walked.lng, bbox))
        ) {
          return {
            lat: walked.lat,
            lng: walked.lng,
            precision: 'interpolated',
          };
        }
      }
    }
    return { lat: corner.lat, lng: corner.lng, precision: 'intersection' };
  }

  /**
   * Walks `metres` from `from` along whichever of `ways` contains a vertex
   * matching it, trying the increasing-index direction first and the
   * decreasing one next. Returns null (keep the corner) when neither
   * direction has enough geometry — never invents a point past the
   * available way length.
   *
   * KNOWN LIMITATION (2026-09-27 live finding): "Cra 13 # 62-40" resolved
   * ~99m from the expected corner — outside the 80m live-verification goal.
   * The increasing/decreasing choice here is purely the OSM way's own vertex
   * order, which has no guaranteed relationship to which physical direction
   * house numbers actually increase in. A correct fix would need a real
   * directionality signal (e.g. `addr:housenumber`-tagged nodes along the
   * way) to calibrate against — checked live for this exact corner and none
   * exist in OSM for this street, so there is no cheap way to verify or fix
   * the walk direction here without a different, unvalidated heuristic.
   * Left as-is per explicit instruction to document rather than guess.
   */
  private walkAlongWayFromPoint(
    ways: OverpassElement[],
    from: { lat: number; lng: number },
    metres: number,
  ): { lat: number; lng: number } | null {
    for (const way of ways) {
      const geom = way.geometry ?? [];
      const idx = geom.findIndex(
        (p) => this.pointToSegmentMeters(from.lat, from.lng, p, p) < 2,
      );
      if (idx < 0) continue;
      return (
        this.walkDirectionLatLng(geom, idx, 1, metres) ??
        this.walkDirectionLatLng(geom, idx, -1, metres)
      );
    }
    return null;
  }

  private walkDirection(
    geom: OverpassPoint[],
    startIdx: number,
    step: 1 | -1,
    metres: number,
  ): OverpassPoint | null {
    const r = this.walkDirectionLatLng(geom, startIdx, step, metres);
    return r ? { lat: r.lat, lon: r.lng } : null;
  }

  private walkDirectionLatLng(
    geom: OverpassPoint[],
    startIdx: number,
    step: 1 | -1,
    metres: number,
  ): { lat: number; lng: number } | null {
    let remaining = metres;
    let i = startIdx;
    while (remaining > 0) {
      const next = i + step;
      if (next < 0 || next >= geom.length) return null;
      const a = geom[i];
      const b = geom[next];
      const segLen = this.pointToSegmentMeters(a.lat, a.lon, b, b);
      if (segLen >= remaining) {
        const t = segLen === 0 ? 0 : remaining / segLen;
        return {
          lat: a.lat + (b.lat - a.lat) * t,
          lng: a.lon + (b.lon - a.lon) * t,
        };
      }
      remaining -= segLen;
      i = next;
    }
    return null;
  }

  // ------------------------------------------------------ Nominatim search

  private applyViewbox(
    params: URLSearchParams,
    bbox: MunicipalityBbox | null,
  ): void {
    if (!bbox) return;
    // Nominatim viewbox = "left,top,right,bottom" = west,north,east,south.
    params.set(
      'viewbox',
      `${bbox.west},${bbox.north},${bbox.east},${bbox.south}`,
    );
    params.set('bounded', '1');
  }

  private async tryStructuredSearch(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    bbox: MunicipalityBbox | null,
    budget: RequestBudget,
  ): Promise<ForwardGeocodeResult | null> {
    if (!parsed.viaTipo || !parsed.viaNum) return null;
    const streetBase = [
      parsed.viaTipo,
      parsed.viaNum,
      parsed.viaLetra,
      parsed.viaBis,
      parsed.viaCuadrante,
    ]
      .filter(Boolean)
      .join(' ');

    const variants: string[] = [];
    if (parsed.cruceNum && parsed.placa) {
      // Nominatim structured search wants the house number FIRST.
      variants.push(`${parsed.cruceNum}-${parsed.placa} ${streetBase}`);
    }
    variants.push(streetBase);

    for (const street of variants) {
      if (!budget.canSpend()) return null;
      budget.spend();
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
      this.applyViewbox(params, bbox);

      const candidates = await this.fetchNominatimSearch(
        params,
        GeocodingService.STRUCTURED_TIMEOUT_MS,
      );
      const filtered = this.filterWithinBbox(candidates, bbox);
      const best = selectBestCandidate(filtered, city);
      if (best) {
        return {
          lat: Number(best.candidate.lat),
          lng: Number(best.candidate.lon),
          precision: this.verifyPrecision(best, parsed),
        };
      }
    }
    return null;
  }

  private async tryFreeText(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    rawQuery: string,
    bbox: MunicipalityBbox | null,
    budget: RequestBudget,
  ): Promise<ForwardGeocodeResult | null> {
    if (!budget.canSpend()) return null;
    budget.spend();
    const q = [parsed.normalized || rawQuery, city, state, 'Colombia']
      .filter(Boolean)
      .join(', ');
    const params = new URLSearchParams({
      format: 'jsonv2',
      q,
      countrycodes: 'co',
      addressdetails: '1',
      limit: '5',
      'accept-language': 'es',
    });
    this.applyViewbox(params, bbox);

    const candidates = await this.fetchNominatimSearch(
      params,
      GeocodingService.FREETEXT_TIMEOUT_MS,
    );
    const filtered = this.filterWithinBbox(candidates, bbox);
    let best = selectBestCandidate(filtered, city);

    if (!best && bbox && candidates.length && budget.canSpend()) {
      // The bbox filter wiped out every candidate — one unbounded retry so a
      // slightly-off bbox never turns a real address into "not found".
      budget.spend();
      const unboundedParams = new URLSearchParams({
        format: 'jsonv2',
        q,
        countrycodes: 'co',
        addressdetails: '1',
        limit: '5',
        'accept-language': 'es',
      });
      const unboundedCandidates = await this.fetchNominatimSearch(
        unboundedParams,
        GeocodingService.FREETEXT_TIMEOUT_MS,
      );
      best = selectBestCandidate(unboundedCandidates, city);
    }

    if (!best) return null;
    return {
      lat: Number(best.candidate.lat),
      lng: Number(best.candidate.lon),
      precision: this.verifyPrecision(best, parsed),
    };
  }

  /** Demotes 'exact' to 'street' when the candidate's house_number does not
   * actually match the requested placa — an unrelated house match is not exact. */
  private verifyPrecision(
    best: { candidate: GeocodeCandidate; precision: GeocodePrecision },
    parsed: ParsedColombianAddress,
  ): GeocodePrecision {
    if (best.precision !== 'exact' || !parsed.placa) return best.precision;
    const hn = (best.candidate.address?.house_number ?? '')
      .replace(/\s+/g, '')
      .toLowerCase();
    const expected = parsed.placa.replace(/\s+/g, '').toLowerCase();
    return hn.includes(expected) ? 'exact' : 'street';
  }

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

  // ---------------------------------------------------------------- Google

  private async tryGoogleFallback(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    bbox: MunicipalityBbox | null,
    currentBest: ForwardGeocodeResult | null,
  ): Promise<ForwardGeocodeResult | null> {
    const google = await this.googleProvider.geocode(
      parsed.normalized || parsed.raw,
      city,
      state,
      bbox,
    );
    if (!google) return null;
    if (bbox && !this.isWithinBbox(google.lat, google.lng, bbox)) return null;

    const currentRank = this.precisionRank(currentBest?.precision ?? null);
    const googleRank = this.precisionRank(google.precision);
    if (googleRank <= currentRank) return null; // must be STRICTLY better than our own OSM result

    return {
      lat: google.lat,
      lng: google.lng,
      precision: google.precision,
      source: 'google',
      label: google.label,
    };
  }

  // ------------------------------------------------------- OSM name variants

  /**
   * Builds OSM name variants for a via type + structured number parts, so
   * the Overpass intersection lookup tolerates the naming differences OSM
   * contributors commonly use — attached vs spaced letter suffix, with/
   * without "Bis", abbreviated vs full via-type word.
   */
  private buildOsmNameVariants(
    tipo: ViaTipo,
    num: string,
    letra?: string | null,
    bis?: string | null,
    cuadrante?: string | null,
  ): string[] {
    const variants = new Set<string>();
    const base = num.trim();
    const suffix = [letra, bis, cuadrante].filter(Boolean).join(' ');

    variants.add([tipo, base, suffix].filter(Boolean).join(' '));
    variants.add(`${tipo} ${base}`);
    if (letra) {
      variants.add(`${tipo} ${base}${letra}`); // attached form, e.g. "45A"
      variants.add([tipo, base, letra].filter(Boolean).join(' '));
    }
    if (bis) {
      variants.add([tipo, base, bis].filter(Boolean).join(' '));
      if (letra)
        variants.add([tipo, base, bis, letra].filter(Boolean).join(' '));
    }
    for (const abbr of this.viaTipoAbbreviations(tipo)) {
      variants.add(`${abbr} ${base}`);
    }
    return Array.from(variants);
  }

  private viaTipoAbbreviations(tipo: ViaTipo): string[] {
    switch (tipo) {
      case 'Avenida Calle':
        return ['AC', 'Av. Calle'];
      case 'Avenida Carrera':
        return ['AK', 'Av. Cra'];
      case 'Carrera':
        return ['Cra', 'Kr'];
      case 'Calle':
        return ['Cl', 'Cll'];
      case 'Diagonal':
        return ['Dg'];
      case 'Transversal':
        return ['Tv'];
      default:
        return [];
    }
  }

  private toOverpassRegex(variants: string[]): string {
    const escaped = variants.map((v) =>
      v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    return `^(${escaped.join('|')})`;
  }

  /**
   * Same escaping as {@link toOverpassRegex}, but anchored on BOTH ends and
   * with an optional "Avenida " prefix — OSM commonly tags a major artery as
   * "Avenida Carrera 7"/"Avenida Calle 100" even though the DANE nomenclature
   * and every real address just say "Carrera 7"/"Calle 100". The END anchor
   * is what stops "Carrera 7" from also matching "Carrera 7 Este" or "Calle
   * 38 Sur" — a genuinely different street — unless the parsed address
   * itself carries that cuadrante (in which case it is already part of the
   * variant string being anchored). Used ONLY for street `name` matching
   * (intersection lookup); city/administrative-area names keep the plain,
   * unanchored {@link toOverpassRegex}.
   */
  private toStreetOverpassRegex(variants: string[]): string {
    const escaped = variants.map((v) =>
      v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    return `^(Avenida )?(${escaped.join('|')})$`;
  }

  private escapeOverpassString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * Matches ignoring a leading "Avenida " on EITHER side (so "Carrera 7"
   * matches an OSM way tagged "Avenida Carrera 7") and otherwise requires
   * an EXACT match — no `startsWith` — so a way named "Carrera 7 Este"
   * never matches the variant "Carrera 7".
   */
  private matchesAnyVariant(
    name: string | undefined,
    variants: string[],
  ): boolean {
    if (!name) return false;
    const n = this.norm(name).replace(/^avenida\s+/, '');
    return variants.some((v) => this.norm(v).replace(/^avenida\s+/, '') === n);
  }

  /**
   * Picks the best corner between the primary/cross way sets when Overpass
   * returns more than one crossing point — e.g. a same-named street pair
   * that exists in both the target municipality and a bordering one (the
   * measured Bogotá/Soacha "Calle 32 × Carrera 7" collision: Bogotá's
   * rectangular bbox geometrically covers part of Soacha, so a bbox-only
   * filter cannot tell them apart). Filters to corners inside `bbox` first
   * (defensive — the area-scoped query above should already exclude a
   * neighbouring municipality, but a loose administrative-name match could
   * still let one through); when several remain, prefers the one closest to
   * `bias`, else the one closest to the bbox centre, else the globally
   * nearest vertex pair.
   */
  private selectBestCorner(
    primaryWays: OverpassElement[],
    crossWays: OverpassElement[],
    bbox: MunicipalityBbox | null,
    bias: { lat: number; lng: number } | null,
  ): { lat: number; lng: number; candidateCount: number } | null {
    const THRESHOLD_M = 40;
    const corners: { lat: number; lng: number; dist: number }[] = [];

    for (const pWay of primaryWays) {
      for (const vertex of pWay.geometry ?? []) {
        for (const cWay of crossWays) {
          const dist = this.minDistanceToWayMeters(
            vertex.lat,
            vertex.lon,
            cWay.geometry ?? [],
          );
          if (dist < THRESHOLD_M) {
            corners.push({ lat: vertex.lat, lng: vertex.lon, dist });
          }
        }
      }
    }
    if (corners.length === 0) return null;

    const inBbox = bbox
      ? corners.filter((c) => this.isWithinBbox(c.lat, c.lng, bbox))
      : corners;
    const candidates = inBbox.length ? inBbox : corners;
    const candidateCount = candidates.length;
    if (candidates.length === 1) {
      return { lat: candidates[0].lat, lng: candidates[0].lng, candidateCount };
    }

    const target =
      bias ??
      (bbox
        ? {
            lat: (bbox.south + bbox.north) / 2,
            lng: (bbox.west + bbox.east) / 2,
          }
        : null);
    if (target) {
      const best = candidates.reduce((best, c) =>
        this.approxMeters(c.lat, c.lng, target.lat, target.lng) <
        this.approxMeters(best.lat, best.lng, target.lat, target.lng)
          ? c
          : best,
      );
      return { lat: best.lat, lng: best.lng, candidateCount };
    }
    const best = candidates.reduce((best, c) =>
      c.dist < best.dist ? c : best,
    );
    return { lat: best.lat, lng: best.lng, candidateCount };
  }

  /**
   * Independent plausibility anchor for an intersection corner, tried in
   * order: (1) a lightweight Nominatim structured search for the SAME
   * address — cheap (1 budget unit) insurance against a wrong OSM
   * street/way match; (2) the centroid of the primary street's own Overpass
   * geometry — free, since it was already fetched by the intersection query
   * itself. Returns null only when neither is available (budget exhausted
   * and, somehow, no primary-way geometry — should not happen in practice
   * since callers already require `primaryWays.length > 0`).
   *
   * CRITICAL: the Nominatim query MUST include the house number/cross-street
   * qualifier (the same variant {@link tryStructuredSearch} tries first),
   * NOT a bare street name — "Carrera 13" alone can be many kilometres long,
   * and a bare-street search legitimately (and correctly) returns Nominatim's
   * own representative point for the whole street, which can sit >2km from
   * the specific corner being verified even when that corner is fine. A live
   * 2026-09-27 run proved this: an early version anchored on the bare street
   * name and rejected every real Bogotá corner as ">12km from anchor".
   */
  private async resolveIntersectionAnchor(
    parsed: ParsedColombianAddress,
    city: string | null,
    state: string | null,
    bbox: MunicipalityBbox | null,
    primaryWays: OverpassElement[],
    budget: RequestBudget,
  ): Promise<{
    lat: number;
    lng: number;
    source: 'nominatim' | 'street-centroid';
  } | null> {
    if (parsed.viaTipo && parsed.viaNum && budget.canSpend()) {
      const streetBase = [
        parsed.viaTipo,
        parsed.viaNum,
        parsed.viaLetra,
        parsed.viaBis,
        parsed.viaCuadrante,
      ]
        .filter(Boolean)
        .join(' ');
      // Same house-number-first shape as tryStructuredSearch's best variant
      // — pins the anchor to the specific corner/house, not just "somewhere
      // on this street".
      const streetQuery =
        parsed.cruceNum && parsed.placa
          ? `${parsed.cruceNum}-${parsed.placa} ${streetBase}`
          : streetBase;
      budget.spend();
      const params = new URLSearchParams({
        format: 'jsonv2',
        street: streetQuery,
        country: 'Colombia',
        countrycodes: 'co',
        addressdetails: '1',
        limit: '1',
        'accept-language': 'es',
      });
      if (city) params.set('city', city);
      if (state) params.set('state', state);
      this.applyViewbox(params, bbox);

      const candidates = await this.fetchNominatimSearch(
        params,
        GeocodingService.STRUCTURED_TIMEOUT_MS,
      );
      const filtered = this.filterWithinBbox(candidates, bbox);
      const first = filtered[0] ?? candidates[0];
      if (first) {
        const lat = Number(first.lat);
        const lng = Number(first.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng, source: 'nominatim' };
        }
      }
    }

    const centroid = this.streetCentroid(primaryWays);
    if (centroid) return { ...centroid, source: 'street-centroid' };

    return null;
  }

  /** Plain average of every vertex across all matched ways for one street name. */
  private streetCentroid(
    ways: OverpassElement[],
  ): { lat: number; lng: number } | null {
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;
    for (const way of ways) {
      for (const pt of way.geometry ?? []) {
        sumLat += pt.lat;
        sumLng += pt.lon;
        count++;
      }
    }
    if (count === 0) return null;
    return { lat: sumLat / count, lng: sumLng / count };
  }

  /** Flat-earth point-to-point distance in metres (fine at city scale). */
  private approxMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat1 * Math.PI) / 180);
    const dy = (lat2 - lat1) * mPerDegLat;
    const dx = (lng2 - lng1) * mPerDegLng;
    return Math.hypot(dx, dy);
  }

  // ----------------------------------------------------------- Nominatim
  private async fetchFromNominatim(
    lat: number,
    lng: number,
  ): Promise<{ address: NormalizedAddress; degraded: boolean }> {
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

  private pickRoad(a: NominatimAddress): string | null {
    return a.road ?? a.pedestrian ?? a.footway ?? a.residential ?? null;
  }

  private normalize(json: NominatimReverseResponse): NormalizedAddress {
    const a: NominatimAddress = json.address ?? {};

    const city = this.cleanCity(
      a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? '',
    );

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
      addressLine1 = json.display_name.split(',')[0].trim();
    } else {
      addressLine1 = '';
    }

    const addressLine2 =
      barrio && this.norm(barrio) !== this.norm(addressLine1) ? barrio : null;

    return {
      address_line1: addressLine1,
      address_line2: addressLine2,
      city,
      state_province: a.state ?? null,
      country_code: (a.country_code ?? '').toUpperCase(),
      postal_code: a.postcode ?? null,
      municipality_code: null,
    };
  }

  private cleanBarrio(value: string | null): string | null {
    if (!value) return null;
    const ADMIN =
      /\b(upz|upzs|localidad|comuna|rap|distrito|per[ií]metro|corregimiento|vereda)\b/i;
    return ADMIN.test(value) ? null : value;
  }

  private cleanCity(value: string): string {
    return value.replace(/^per[ií]metro\s+urbano\s+/i, '').trim();
  }

  private norm(v: string): string {
    return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // ------------------------------------------------------- Cross street
  private async composeBothAxes(
    lat: number,
    lng: number,
    primaryRoad: string | null,
    primaryAxis: 'calle' | 'carrera' | null,
    houseNumber?: string,
    axesPromise?: Promise<{ calle: string | null; carrera: string | null }>,
  ): Promise<string | null> {
    const { cross, plate: rawPlate } = this.decomposeHouseNumber(houseNumber);
    const plate = this.sanitizePlate(rawPlate);

    const houseCarrera =
      primaryAxis === 'calle' && cross ? `Carrera ${cross}` : null;
    const houseCalle =
      primaryAxis === 'carrera' && cross ? `Calle ${cross}` : null;

    let calle = (primaryAxis === 'calle' ? primaryRoad : null) ?? houseCalle;
    let carrera =
      (primaryAxis === 'carrera' ? primaryRoad : null) ?? houseCarrera;

    if (!calle || !carrera) {
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

    const only = calle ?? carrera ?? primaryRoad;
    if (!only) return null;
    return houseNumber ? `${only} # ${houseNumber}` : only;
  }

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

  private async overpassNamedRoads(
    lat: number,
    lng: number,
  ): Promise<OverpassElement[]> {
    const query =
      `[out:json][timeout:6];` +
      `way(around:${GeocodingService.CROSS_STREET_RADIUS_M},${lat},${lng})` +
      `[highway][name];out tags geom;`;

    return this.raceOverpassMirrors(
      query,
      GeocodingService.OVERPASS_TIMEOUT_MS,
    );
  }

  private async raceOverpassMirrors(
    query: string,
    timeoutMs: number,
  ): Promise<OverpassElement[]> {
    const attempts = GeocodingService.OVERPASS_MIRRORS.map((url) =>
      this.fetchOverpassMirror(url, query, timeoutMs),
    );
    try {
      return await this.firstFulfilled(attempts);
    } catch {
      return [];
    }
  }

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
      this.logger.warn(`Overpass ${url} failed: ${err}`);
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timeout);
    }
  }

  private axisOf(name: string): 'calle' | 'carrera' | null {
    const n = this.norm(name);
    if (/\b(carrera|cra|kra|kr|transversal|transv|tv)\b/.test(n)) {
      return 'carrera';
    }
    if (/\b(calle|cl|diagonal|diag)\b/.test(n)) return 'calle';
    return null;
  }

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

  private sanitizePlate(plate: string | null): string | null {
    if (!plate) return null;
    const p = plate.trim();
    if (!p) return null;
    if (this.axisOf(p)) return null;
    if (!/\d/.test(p)) return null;
    return p;
  }

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

  private pointToSegmentMeters(
    lat: number,
    lng: number,
    a: OverpassPoint,
    b: OverpassPoint,
  ): number {
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180);
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

  /** Cached municipality bbox read. `undefined` = cache miss; `null` = cached "not found". */
  private async readMuniBboxCache(
    key: string,
  ): Promise<MunicipalityBbox | null | undefined> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) return undefined;
      if (raw === '') return null;
      return JSON.parse(raw) as MunicipalityBbox;
    } catch (err) {
      this.logger.warn(`Redis read failed for ${key}: ${err}`);
      return undefined;
    }
  }

  private async writeMuniBboxCache(
    key: string,
    value: MunicipalityBbox | null,
  ): Promise<void> {
    const ttl = value
      ? GeocodingService.MUNI_BBOX_CACHE_TTL_SECONDS
      : GeocodingService.MUNI_BBOX_NULL_CACHE_TTL_SECONDS;
    try {
      await this.redis.set(key, value ? JSON.stringify(value) : '', 'EX', ttl);
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
      return true;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
