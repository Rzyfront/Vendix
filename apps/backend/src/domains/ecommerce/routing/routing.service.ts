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
  /** Redis key prefix for cached directions payloads. */
  private static readonly CACHE_PREFIX = 'routing:directions:';
  /** Redis key prefix for the single-flight lock. */
  private static readonly LOCK_PREFIX = 'routing:lock:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Resolve street-following directions for an ordered list of waypoints.
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
    const cacheKey = `${RoutingService.CACHE_PREFIX}${this.hash(normalized)}`;

    const cached = await this.readCache(cacheKey);
    if (cached) {
      this.logger.debug(`directions cache HIT ${cacheKey}`);
      return { ...cached, cached: true };
    }
    this.logger.debug(`directions cache MISS ${cacheKey}`);

    // Best-effort single-flight: if another request already holds the lock for
    // this route, wait briefly and re-check the cache before falling through to
    // our own OSRM call (never block indefinitely).
    const gotLock = await this.acquireLock(cacheKey);
    if (!gotLock) {
      await this.sleep(900);
      const retry = await this.readCache(cacheKey);
      if (retry) {
        this.logger.debug(`directions cache HIT (after lock wait) ${cacheKey}`);
        return { ...retry, cached: true };
      }
    }

    const result = await this.fetchFromOsrm(normalized);
    await this.writeCache(cacheKey, result);
    return { ...result, cached: false };
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

  // ----------------------------------------------------------------- OSRM
  private async fetchFromOsrm(coords: string): Promise<RoutingDirections> {
    const url =
      `${RoutingService.OSRM_BASE}/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson`;

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

    const route = json.routes?.[0];
    const geometry = route?.geometry;
    if (
      !route ||
      !geometry ||
      geometry.type !== 'LineString' ||
      !Array.isArray(geometry.coordinates) ||
      typeof route.distance !== 'number' ||
      typeof route.duration !== 'number'
    ) {
      this.logger.warn(`OSRM returned a malformed route for "${coords}"`);
      throw new ServiceUnavailableException(
        'Routing provider returned an incomplete route',
      );
    }

    return {
      geometry: {
        type: 'LineString',
        coordinates: geometry.coordinates,
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
