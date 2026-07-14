import { Injectable } from '@angular/core';

/** Latitude/longitude pair resolved from the browser Geolocation API. */
export interface GeoCoords {
  lat: number;
  lng: number;
}

/** Typed reason so callers can branch (e.g. silent fallback vs. toast). */
export type GeolocationErrorReason =
  | 'unsupported'
  | 'insecure_context'
  | 'permission_denied'
  | 'position_unavailable'
  | 'timeout';

/** Typed rejection thrown by {@link GeolocationService.getCurrentPosition}. */
export class GeolocationError extends Error {
  constructor(
    readonly reason: GeolocationErrorReason,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = 'GeolocationError';
  }
}

/**
 * Thin wrapper around `navigator.geolocation` that returns a Promise with a
 * simplified {lat,lng} shape and a typed rejection. The Geolocation API only
 * works in a secure context (https / localhost); we surface that as a typed
 * error so the checkout can fall back to the manual form silently.
 */
@Injectable({ providedIn: 'root' })
export class GeolocationService {
  /** True when the browser exposes the Geolocation API. */
  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator &&
      !!navigator.geolocation
    );
  }

  /**
   * Resolves the current device position. Rejects with a {@link GeolocationError}
   * on unsupported/insecure context, permission denial, unavailability or timeout.
   */
  getCurrentPosition(options?: PositionOptions): Promise<GeoCoords> {
    return new Promise<GeoCoords>((resolve, reject) => {
      if (!this.isSupported()) {
        reject(
          new GeolocationError(
            'unsupported',
            'La geolocalización no está disponible en este navegador.',
          ),
        );
        return;
      }

      if (
        typeof window !== 'undefined' &&
        (window as Window).isSecureContext === false
      ) {
        reject(
          new GeolocationError(
            'insecure_context',
            'La ubicación solo está disponible en conexiones seguras (HTTPS).',
          ),
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }),
        (error) => {
          let reason: GeolocationErrorReason = 'position_unavailable';
          if (error.code === error.PERMISSION_DENIED) {
            reason = 'permission_denied';
          } else if (error.code === error.TIMEOUT) {
            reason = 'timeout';
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            reason = 'position_unavailable';
          }
          reject(new GeolocationError(reason, error.message));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
          ...(options ?? {}),
        },
      );
    });
  }
}
