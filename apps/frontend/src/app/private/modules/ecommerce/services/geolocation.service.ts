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
   * Current geolocation permission state via the Permissions API:
   * - `granted`  → the customer already allowed location; use GPS directly.
   * - `denied`   → the customer blocked it; do not nag with the opt-in modal.
   * - `prompt`   → not decided yet; the opt-in modal should be offered.
   * - `unsupported` → the browser has no Geolocation API at all.
   *
   * Falls back to `prompt` when the Permissions API is missing or cannot query
   * geolocation (e.g. older Safari) so the modal is still offered as before.
   */
  async getPermissionState(): Promise<PermissionState | 'unsupported'> {
    if (!this.isSupported()) return 'unsupported';
    try {
      if (
        typeof navigator !== 'undefined' &&
        'permissions' in navigator &&
        navigator.permissions?.query
      ) {
        const status = await navigator.permissions.query({
          name: 'geolocation' as PermissionName,
        });
        return status.state;
      }
    } catch {
      // Permissions API not available for geolocation → default to asking.
    }
    return 'prompt';
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
        (error) => reject(this.mapError(error)),
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
          ...(options ?? {}),
        },
      );
    });
  }

  /**
   * Resolves a position FAST, favouring speed over the last few meters of
   * accuracy. Auto-focus must feel immediate, so we: (a) allow a recent cached
   * fix (`maximumAge`) so the first reading is near-instant, (b) resolve as soon
   * as a reading is "good enough" (`targetAccuracyM`, lenient by default), and
   * (c) cap the REFINEMENT window at a short `maxWaitMs`. That window starts
   * when the FIRST fix arrives, NOT at invocation: the time the customer spends
   * on the browser's permission prompt must not count against it. Until a first
   * fix arrives, `watchPosition`'s own `timeout` (`firstFixTimeoutMs`, which per
   * the browser spec only counts after permission is granted) decides the
   * error. `watchPosition` still lets a GPS device improve on the first coarse
   * fix within the short window; the draggable marker corrects any residual
   * offset (a WiFi-only device is biased no matter how long we wait).
   * Rejects only if no fix arrives at all (`timeout` / `permission_denied` /
   * `position_unavailable`).
   */
  getPrecisePosition(opts?: {
    maxWaitMs?: number;
    targetAccuracyM?: number;
    firstFixTimeoutMs?: number;
  }): Promise<GeoCoords> {
    const maxWaitMs = opts?.maxWaitMs ?? 2500;
    const firstFixTimeoutMs = opts?.firstFixTimeoutMs ?? 15000;
    const targetAccuracyM = opts?.targetAccuracyM ?? 50;

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

      let best: GeolocationPosition | null = null;
      let settled = false;
      let watchId = -1;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (watchId !== -1) {
          try {
            navigator.geolocation.clearWatch(watchId);
          } catch {
            /* noop */
          }
        }
        if (best) {
          resolve({
            lat: best.coords.latitude,
            lng: best.coords.longitude,
          });
        } else {
          reject(new GeolocationError('timeout', 'No se obtuvo ubicación.'));
        }
      };

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const isFirstFix = !best;
          if (!best || position.coords.accuracy < best.coords.accuracy) {
            best = position;
          }
          // Refinement window starts at the first fix (not at invocation).
          if (isFirstFix && !settled) {
            timer = setTimeout(finish, maxWaitMs);
          }
          // Precise enough → stop early; no need to keep the GPS on.
          if (best.coords.accuracy <= targetAccuracyM) finish();
        },
        (error) => {
          // Only fail if we never got any fix; otherwise resolve with the best.
          if (!best && !settled) {
            settled = true;
            clearTimeout(timer);
            if (watchId !== -1) {
              try {
                navigator.geolocation.clearWatch(watchId);
              } catch {
                /* noop */
              }
            }
            reject(this.mapError(error));
          }
        },
        // maximumAge: reuse a fix up to 30s old so the FIRST reading is near
        // instant instead of forcing a fresh (slow) GPS lock.
        {
          enableHighAccuracy: true,
          maximumAge: 30000,
          timeout: firstFixTimeoutMs,
        },
      );
    });
  }

  /** Maps a browser GeolocationPositionError to our typed {@link GeolocationError}. */
  private mapError(error: GeolocationPositionError): GeolocationError {
    let reason: GeolocationErrorReason = 'position_unavailable';
    if (error.code === error.PERMISSION_DENIED) {
      reason = 'permission_denied';
    } else if (error.code === error.TIMEOUT) {
      reason = 'timeout';
    } else if (error.code === error.POSITION_UNAVAILABLE) {
      reason = 'position_unavailable';
    }
    return new GeolocationError(reason, error.message);
  }
}
