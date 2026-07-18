import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';

/**
 * A route geometry: a GeoJSON `LineString` following the actual road network.
 * Coordinates are `[lng, lat]` pairs (GeoJSON order), exactly as OSRM emits
 * them and as the frontend map (MapLibre) consumes them.
 */
export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

/**
 * Cached routing payload (WITHOUT the transient `cached` flag). This is the
 * shape stored in Redis; `cached` is stamped on read/return, never persisted.
 */
export interface RoutingDirections {
  geometry: RouteGeometry;
  /** Total route distance in meters. */
  distance_m: number;
  /** Total route duration (ETA) in seconds. */
  duration_s: number;
}

/**
 * Normalized directions result returned by `GET /ecommerce/routing/directions`
 * (no `{ success, data }` wrapper — the backend has no global response-transform
 * interceptor, so this object is the raw 200 body the frontend consumes).
 */
export interface DirectionsResult extends RoutingDirections {
  /** `true` when served from the Redis cache, `false` on a fresh OSRM fetch. */
  cached: boolean;
}

/** Subset of an OSRM `/route` element we read. */
interface OsrmRoute {
  geometry?: RouteGeometry;
  distance?: number;
  duration?: number;
}

/** Subset of the OSRM `/route/v1/driving` response we read. */
interface OsrmResponse {
  code?: string;
  message?: string;
  routes?: OsrmRoute[];
}

/**
 * RoutingService
 *
 * Server-side street-routing proxy so the frontend NEVER calls OSRM directly.
 * Given an ordered list of waypoints it returns the real driving polyline
 * (geometry), total distance and ETA. Results are cached in Redis for 24h keyed
 * by a hash of the normalized coords string; the long cache is what keeps us
 * within the public OSRM demo's usage policy for real traffic. A short per-key
 * lock provides best-effort single-flight for concurrent misses on the same
 * route.
 *
 * Mirrors the sibling {@link GeocodingService} 1:1 (Redis cache + single-flight
 * lock + `User-Agent: Vendix/1.0` + timeout/error handling on a keyless public
 * OSM service). Base URL lives in a constant so a later migration to a
 * self-hosted OSRM is a one-line change.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  /** 24 hours — the road network is effectively static at this granularity. */
  private static readonly CACHE_TTL_SECONDS = 86400;
  /** Best-effort single-flight lock TTL (ms). */
  private static readonly LOCK_TTL_MS = 1500;
  /** OSRM request timeout (ms). */
  private static readonly FETCH_TIMEOUT_MS = 8000;
  /**
   * Public keyless OSRM demo. Kept in a constant so migrating to a self-hosted
   * OSRM later is a single-line change (only the host differs — the path and
   * query contract are identical).
   */
  private static readonly OSRM_BASE = 'https://router.project-osrm.org';
  /**
   * Public keyless Valhalla demo (FOSSGIS, same operator family as the OSRM
   * demo). PRIMARY provider: unlike OSRM, Valhalla supports TRUE shortest-
   * distance routing (`costing_options.auto.shortest: true`), which is what
   * urban delivery wants — OSRM only optimizes by time and favours main roads.
   */
  private static readonly VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';
  /**
   * Redis key prefix for cached directions payloads. `v2` = shortest-distance
   * era (Valhalla primary); the bump orphans pre-shortest fastest-route entries
   * so they age out via TTL instead of serving stale main-road geometry.
   */
  private static readonly CACHE_PREFIX = 'routing:directions:v2:';
  /** Redis key prefix for the single-flight lock. */
  private static readonly LOCK_PREFIX = 'routing:lock:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Resolve street-following directions for an ordered list of waypoints,
   * favouring the SHORTEST route (min distance), not OSRM's default fastest.
   *
   * OSRM only returns alternative routes for 2-point requests (no via
   * waypoints), so multi-stop routes are resolved LEG BY LEG (each consecutive
   * pair) and stitched: per leg we ask for alternatives and keep the one with
   * the smallest distance. Legs are cached individually, which also improves
   * reuse — when the driver advances, only the first leg changes; the
   * stop→stop legs stay cached.
   *
   * @param coords OSRM-native `<lng>,<lat>;<lng>,<lat>;...` string (≥2 points),
   *   already shape-validated by the DTO. Ranges are re-validated here.
   * @throws BadRequestException when a coordinate is out of range or the string
   *   has fewer than 2 valid points (defense-in-depth).
   * @throws ServiceUnavailableException when OSRM is unreachable, returns a
   *   non-2xx, sends invalid JSON, or reports a non-`Ok` code / no route.
   */
  async directions(coords: string): Promise<DirectionsResult> {
    const normalized = this.normalizeCoords(coords);
    const points = normalized.split(';');

    const legCoords: string[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      legCoords.push(`${points[i]};${points[i + 1]}`);
    }

    const legs = await Promise.all(
      legCoords.map((leg) => this.resolveLeg(leg)),
    );

    const allCached = legs.every((l) => l.cached);
    return { ...this.stitchLegs(legs.map((l) => l.result)), cached: allCached };
  }

  /**
   * Resolve ONE leg (exactly 2 waypoints) through the Redis cache + best-effort
   * single-flight lock, falling through to OSRM on a miss.
   */
  private async resolveLeg(
    coords: string,
  ): Promise<{ result: RoutingDirections; cached: boolean }> {
    const cacheKey = `${RoutingService.CACHE_PREFIX}${this.hash(coords)}`;

    const cached = await this.readCache(cacheKey);
    if (cached) {
      this.logger.debug(`directions cache HIT ${cacheKey}`);
      return { result: cached, cached: true };
    }
    this.logger.debug(`directions cache MISS ${cacheKey}`);

    // Best-effort single-flight: if another request already holds the lock for
    // this leg, wait briefly and re-check the cache before falling through to
    // our own OSRM call (never block indefinitely).
    const gotLock = await this.acquireLock(cacheKey);
    if (!gotLock) {
      await this.sleep(900);
      const retry = await this.readCache(cacheKey);
      if (retry) {
        this.logger.debug(`directions cache HIT (after lock wait) ${cacheKey}`);
        return { result: retry, cached: true };
      }
    }

    const result = await this.fetchLeg(coords);
    await this.writeCache(cacheKey, result);
    return { result, cached: false };
  }

  /**
   * Fetch one leg from the routing providers: Valhalla `shortest: true` first
   * (true min-distance routing), falling back to OSRM (fastest, min-distance
   * alternative picked) only if Valhalla is unreachable or errors.
   */
  private async fetchLeg(coords: string): Promise<RoutingDirections> {
    try {
      return await this.fetchFromValhalla(coords);
    } catch (err) {
      this.logger.warn(
        `Valhalla failed for "${coords}" (${err instanceof Error ? err.message : err}); falling back to OSRM`,
      );
      return this.fetchFromOsrm(coords);
    }
  }

  /**
   * Concatenate per-leg geometries into one continuous LineString (dropping the
   * duplicated joint point between consecutive legs) and sum distance/ETA.
   */
  private stitchLegs(legs: RoutingDirections[]): RoutingDirections {
    if (legs.length === 1) return legs[0];

    const coordinates: [number, number][] = [];
    let distance = 0;
    let duration = 0;
    for (const leg of legs) {
      const start = coordinates.length > 0 ? 1 : 0;
      coordinates.push(...leg.geometry.coordinates.slice(start));
      distance += leg.distance_m;
      duration += leg.duration_s;
    }
    return {
      geometry: { type: 'LineString', coordinates },
      distance_m: distance,
      duration_s: duration,
    };
  }

  /**
   * Validate ranges and canonicalize the coords string. The DTO already
   * guaranteed the `<lng>,<lat>;...` shape and the ≥2-point count; here we bound
   * each number to a valid WGS84 range (defense-in-depth) and re-serialize into
   * a stable form so equivalent inputs share one cache key.
   */
  private normalizeCoords(coords: string): string {
    const points = coords.trim().split(';');
    if (points.length < 2) {
      throw new BadRequestException('coords must contain at least 2 points');
    }

    const normalizedPoints = points.map((point) => {
      const [lngRaw, latRaw] = point.split(',');
      const lng = Number(lngRaw);
      const lat = Number(latRaw);
      if (
        Number.isNaN(lng) ||
        Number.isNaN(lat) ||
        lng < -180 ||
        lng > 180 ||
        lat < -90 ||
        lat > 90
      ) {
        throw new BadRequestException(
          'each coord must be "<lng>,<lat>" with lng in [-180,180] and lat in [-90,90]',
        );
      }
      return `${lng},${lat}`;
    });

    return normalizedPoints.join(';');
  }

  // ------------------------------------------------------------- Valhalla
  /**
   * Resolve one leg via Valhalla with `shortest: true` — routing weighted by
   * DISTANCE, not time. This is the only public keyless provider that honours
   * "always take the shortest path" instead of preferring main roads.
   */
  private async fetchFromValhalla(coords: string): Promise<RoutingDirections> {
    const locations = coords.split(';').map((point) => {
      const [lng, lat] = point.split(',');
      return { lat: Number(lat), lon: Number(lng) };
    });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      RoutingService.FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(`${RoutingService.VALHALLA_BASE}/route`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Vendix/1.0 (soporte@vendix.online)',
        },
        body: JSON.stringify({
          locations,
          costing: 'auto',
          costing_options: { auto: { shortest: true } },
          units: 'kilometers',
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Valhalla HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      trip?: {
        summary?: { length?: number; time?: number };
        legs?: { shape?: string }[];
      };
    };

    const summary = json.trip?.summary;
    const legs = json.trip?.legs ?? [];
    if (
      typeof summary?.length !== 'number' ||
      typeof summary?.time !== 'number' ||
      legs.length === 0 ||
      legs.some((l) => typeof l.shape !== 'string')
    ) {
      throw new Error('Valhalla returned an incomplete route');
    }

    // Un request puede traer varios legs (si hubiera >2 locations); se
    // concatenan quitando el punto de unión duplicado.
    const coordinates: [number, number][] = [];
    for (const leg of legs) {
      const decoded = this.decodePolyline6(leg.shape as string);
      const start = coordinates.length > 0 ? 1 : 0;
      coordinates.push(...decoded.slice(start));
    }
    if (coordinates.length < 2) {
      throw new Error('Valhalla returned an empty geometry');
    }

    return {
      geometry: { type: 'LineString', coordinates },
      distance_m: Math.round(summary.length * 1000),
      duration_s: summary.time,
    };
  }

  /**
   * Decode a Valhalla encoded polyline (precision 6) into GeoJSON `[lng, lat]`
   * pairs. Standard Google polyline algorithm with a 1e6 factor.
   */
  private decodePolyline6(encoded: string): [number, number][] {
    const factor = 1e6;
    const coordinates: [number, number][] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let result = 1;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63 - 1;
        result += byte << shift;
        shift += 5;
      } while (byte >= 0x1f);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      result = 1;
      shift = 0;
      do {
        byte = encoded.charCodeAt(index++) - 63 - 1;
        result += byte << shift;
        shift += 5;
      } while (byte >= 0x1f);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      coordinates.push([lng / factor, lat / factor]);
    }
    return coordinates;
  }

  // ----------------------------------------------------------------- OSRM
  private async fetchFromOsrm(coords: string): Promise<RoutingDirections> {
    // `alternatives=true` (válido solo en requests de 2 puntos — por eso el
    // ruteo por tramos de `directions()`): OSRM ordena por DURACIÓN y favorece
    // vías principales; pidiendo alternativas podemos elegir la MÁS CORTA.
    const url =
      `${RoutingService.OSRM_BASE}/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson&alternatives=true`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      RoutingService.FETCH_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Vendix/1.0 (soporte@vendix.online)' },
      });
    } catch (err) {
      this.logger.error(`OSRM request failed for "${coords}": ${err}`);
      throw new ServiceUnavailableException('Routing provider unavailable');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      this.logger.error(`OSRM returned HTTP ${response.status} for "${coords}"`);
      throw new ServiceUnavailableException('Routing provider error');
    }

    let json: OsrmResponse;
    try {
      json = (await response.json()) as OsrmResponse;
    } catch (err) {
      this.logger.error(`OSRM returned invalid JSON: ${err}`);
      throw new ServiceUnavailableException(
        'Routing provider returned invalid data',
      );
    }

    if (json.code !== 'Ok') {
      this.logger.warn(
        `OSRM could not route "${coords}": ${json.code ?? 'unknown'}` +
          `${json.message ? ` (${json.message})` : ''}`,
      );
      throw new ServiceUnavailableException(
        'Routing provider could not resolve a route',
      );
    }

    // Entre las rutas válidas devueltas (principal + alternativas), elige la de
    // MENOR DISTANCIA — no la más rápida. El reparto urbano quiere el camino
    // más corto, no la vía principal que OSRM prefiere por defecto.
    const candidates = (json.routes ?? []).filter(
      (r): r is Required<OsrmRoute> =>
        !!r.geometry &&
        r.geometry.type === 'LineString' &&
        Array.isArray(r.geometry.coordinates) &&
        typeof r.distance === 'number' &&
        typeof r.duration === 'number',
    );
    if (candidates.length === 0) {
      this.logger.warn(`OSRM returned a malformed route for "${coords}"`);
      throw new ServiceUnavailableException(
        'Routing provider returned an incomplete route',
      );
    }
    const route = candidates.reduce((best, r) =>
      r.distance < best.distance ? r : best,
    );

    return {
      geometry: {
        type: 'LineString',
        coordinates: route.geometry.coordinates,
      },
      distance_m: route.distance,
      duration_s: route.duration,
    };
  }

  // --------------------------------------------------------------- Redis
  private async readCache(key: string): Promise<RoutingDirections | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as RoutingDirections;
    } catch (err) {
      // Fail open: a cache read failure must not break the endpoint.
      this.logger.warn(`Redis read failed for ${key}: ${err}`);
      return null;
    }
  }

  private async writeCache(
    key: string,
    value: RoutingDirections,
  ): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        RoutingService.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      // Fail open: caching is an optimization, not a correctness requirement.
      this.logger.warn(`Redis write failed for ${key}: ${err}`);
    }
  }

  private async acquireLock(cacheKey: string): Promise<boolean> {
    try {
      const res = await this.redis.set(
        `${RoutingService.LOCK_PREFIX}${cacheKey}`,
        '1',
        'PX',
        RoutingService.LOCK_TTL_MS,
        'NX',
      );
      return res === 'OK';
    } catch {
      // Fail open: if the lock can't be evaluated, don't block the fetch.
      return true;
    }
  }

  /** Stable, bounded cache-key component for an arbitrarily long coords string. */
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
