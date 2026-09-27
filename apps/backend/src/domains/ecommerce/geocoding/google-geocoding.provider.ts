import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import type { GeocodePrecision } from './geocoding.service';

export interface GoogleGeocodeResult {
  lat: number;
  lng: number;
  precision: GeocodePrecision;
  label: string;
}

interface GoogleGeocodeApiResult {
  formatted_address?: string;
  geometry?: {
    location?: { lat: number; lng: number };
    location_type?: string;
  };
  types?: string[];
}

interface GoogleGeocodeApiResponse {
  status: string;
  results?: GoogleGeocodeApiResult[];
}

/**
 * Google Geocoding API fallback, used ONLY when the OSM cascade in
 * {@link GeocodingService} resolves to null / 'street' / 'area'. Gated by
 * `GOOGLE_GEOCODING_API_KEY` (absent = feature disabled, free tier stays
 * OSM-only) and a Redis-backed monthly call cap
 * (`GOOGLE_GEOCODING_MONTHLY_CAP`, default 5000) so a traffic spike can
 * never produce a surprise bill.
 *
 * NEVER throws and NEVER blocks the request: every failure mode (no key,
 * cap hit, network error, timeout, ZERO_RESULTS, OVER_QUERY_LIMIT,
 * REQUEST_DENIED, malformed response) resolves to `null` so the caller
 * silently keeps its own OSM resolution — see the class doc on
 * {@link GeocodingService.forward} for the full acceptance policy.
 */
@Injectable()
export class GoogleGeocodingProvider {
  private readonly logger = new Logger(GoogleGeocodingProvider.name);

  private static readonly TIMEOUT_MS = 4000;
  private static readonly BASE_URL =
    'https://maps.googleapis.com/maps/api/geocode/json';
  private static readonly CAP_TTL_SECONDS = 60 * 60 * 24 * 35;
  /** Logged once per process so a sustained no-key deployment doesn't spam. */
  private static loggedNoKeyOnce = false;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private get apiKey(): string {
    return process.env.GOOGLE_GEOCODING_API_KEY || '';
  }

  private get monthlyCap(): number {
    const raw = Number(process.env.GOOGLE_GEOCODING_MONTHLY_CAP);
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
  }

  /**
   * Resolves `canonicalAddress` via Google. `bbox` (municipality bounding
   * box), when known, is sent as a soft `bounds` hint to Google — the
   * caller is still responsible for validating the returned point actually
   * falls inside it (see {@link GeocodingService}).
   */
  async geocode(
    canonicalAddress: string,
    city: string | null,
    state: string | null,
    bbox: { south: number; west: number; north: number; east: number } | null,
  ): Promise<GoogleGeocodeResult | null> {
    if (!this.apiKey) {
      if (!GoogleGeocodingProvider.loggedNoKeyOnce) {
        GoogleGeocodingProvider.loggedNoKeyOnce = true;
        this.logger.warn(JSON.stringify({ reason: 'google_no_key' }));
      }
      return null;
    }

    const withinCap = await this.checkAndIncrementCap();
    if (!withinCap) {
      this.logger.warn(JSON.stringify({ reason: 'google_cap' }));
      return null;
    }

    const params = new URLSearchParams({
      address: [canonicalAddress, city, state, 'Colombia']
        .filter(Boolean)
        .join(', '),
      region: 'co',
      language: 'es',
      key: this.apiKey,
    });
    const components = ['country:CO'];
    if (city) components.push(`locality:${city}`);
    params.set('components', components.join('|'));
    if (bbox) {
      params.set(
        'bounds',
        `${bbox.south},${bbox.west}|${bbox.north},${bbox.east}`,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      GoogleGeocodingProvider.TIMEOUT_MS,
    );
    let json: GoogleGeocodeApiResponse;
    try {
      const response = await fetch(
        `${GoogleGeocodingProvider.BASE_URL}?${params.toString()}`,
        {
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        this.logger.warn(
          JSON.stringify({ reason: 'google_error', status: response.status }),
        );
        return null;
      }
      json = (await response.json()) as GoogleGeocodeApiResponse;
    } catch (err) {
      const reason =
        (err as Error)?.name === 'AbortError'
          ? 'google_timeout'
          : 'google_error';
      this.logger.warn(JSON.stringify({ reason }));
      return null;
    } finally {
      clearTimeout(timeout);
    }

    if (json.status === 'ZERO_RESULTS') return null;
    if (json.status === 'OVER_QUERY_LIMIT') {
      this.logger.warn(JSON.stringify({ reason: 'google_cap' }));
      return null;
    }
    if (json.status === 'REQUEST_DENIED') {
      this.logger.warn(JSON.stringify({ reason: 'google_denied' }));
      return null;
    }
    if (json.status !== 'OK' || !json.results?.length) {
      this.logger.warn(
        JSON.stringify({ reason: 'google_error', status: json.status }),
      );
      return null;
    }

    const result = json.results[0];
    const location = result.geometry?.location;
    if (
      !location ||
      typeof location.lat !== 'number' ||
      typeof location.lng !== 'number'
    ) {
      return null;
    }

    return {
      lat: location.lat,
      lng: location.lng,
      precision: this.mapPrecision(
        result.geometry?.location_type,
        result.types ?? [],
      ),
      label: result.formatted_address ?? canonicalAddress,
    };
  }

  private mapPrecision(
    locationType: string | undefined,
    types: string[],
  ): GeocodePrecision {
    switch (locationType) {
      case 'ROOFTOP':
        return 'exact';
      case 'RANGE_INTERPOLATED':
        return 'interpolated';
      case 'GEOMETRIC_CENTER':
        if (types.includes('intersection')) return 'intersection';
        if (types.includes('route')) return 'street';
        return 'area';
      case 'APPROXIMATE':
      default:
        return 'area';
    }
  }

  /** INCR-before-call: this caps CALLS ATTEMPTED (Google bills per request
   * regardless of outcome), not successful operations — intentionally
   * different from the AI-feature "consume after success" quota pattern. */
  private async checkAndIncrementCap(): Promise<boolean> {
    const key = `geocode:google:${this.currentUtcPeriod()}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, GoogleGeocodingProvider.CAP_TTL_SECONDS);
      }
      return count <= this.monthlyCap;
    } catch (err) {
      this.logger.warn(`Google quota check failed, allowing call: ${err}`);
      return true;
    }
  }

  private currentUtcPeriod(): string {
    const now = new Date();
    return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
}
