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

/** Subset of the Nominatim `address` object we read (jsonv2 + addressdetails=1). */
interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  residential?: string;
  suburb?: string;
  neighbourhood?: string;
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
  /** Nominatim request timeout (ms). */
  private static readonly FETCH_TIMEOUT_MS = 8000;
  private static readonly NOMINATIM_BASE =
    'https://nominatim.openstreetmap.org/reverse';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Reverse-geocode a coordinate to a normalized address.
   *
   * @throws ServiceUnavailableException when Nominatim is unreachable,
   *         returns a non-2xx, sends invalid JSON, or reports an error.
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

    const normalized = await this.fetchFromNominatim(lat, lng);
    await this.writeCache(cacheKey, normalized);
    return normalized;
  }

  // ----------------------------------------------------------- Nominatim
  private async fetchFromNominatim(
    lat: number,
    lng: number,
  ): Promise<NormalizedAddress> {
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
      this.logger.error(`Nominatim request failed for ${lat},${lng}: ${err}`);
      throw new ServiceUnavailableException(
        'Reverse geocoding provider unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      this.logger.error(
        `Nominatim returned HTTP ${response.status} for ${lat},${lng}`,
      );
      throw new ServiceUnavailableException(
        'Reverse geocoding provider error',
      );
    }

    let json: NominatimReverseResponse;
    try {
      json = (await response.json()) as NominatimReverseResponse;
    } catch (err) {
      this.logger.error(`Nominatim returned invalid JSON: ${err}`);
      throw new ServiceUnavailableException(
        'Reverse geocoding provider returned invalid data',
      );
    }

    if (json.error) {
      this.logger.warn(
        `Nominatim error for ${lat},${lng}: ${json.error}`,
      );
      throw new ServiceUnavailableException(
        'Reverse geocoding provider could not resolve the coordinates',
      );
    }

    return this.normalize(json);
  }

  /** Map a Nominatim jsonv2 response to our normalized contract shape. */
  private normalize(json: NominatimReverseResponse): NormalizedAddress {
    const a: NominatimAddress = json.address ?? {};

    const road = a.road ?? a.pedestrian ?? a.footway ?? a.residential ?? null;
    let addressLine1: string;
    if (road) {
      addressLine1 = a.house_number ? `${road} ${a.house_number}` : road;
    } else if (json.display_name) {
      // Fallback: first two segments of the display name, trimmed.
      addressLine1 = json.display_name.split(',').slice(0, 2).join(',').trim();
    } else {
      addressLine1 = '';
    }

    const city =
      a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? '';

    return {
      address_line1: addressLine1,
      address_line2: a.suburb ?? a.neighbourhood ?? null,
      city,
      state_province: a.state ?? null,
      country_code: (a.country_code ?? '').toUpperCase(),
      postal_code: a.postcode ?? null,
      municipality_code: null, // Nominatim does not provide this.
    };
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
