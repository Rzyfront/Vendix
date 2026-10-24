import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  PublishPositionPoint,
  RoutePosition,
  RouteTrackingSnapshot,
} from '../interfaces/route-tracking.interface';

/** Handle returned by {@link RouteTrackingService.watch}; call `close()` to stop. */
export interface RouteTrackingWatch {
  close(): void;
}

/**
 * HTTP + realtime access to dispatch-route tracking.
 * SSE (EventSource, `?token=`) with exponential-backoff reconnection; when the
 * stream errors it falls back to polling the snapshot every 15 s while it keeps
 * retrying SSE in the background.
 */
@Injectable({ providedIn: 'root' })
export class RouteTrackingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getTracking(routeId: number): Observable<RouteTrackingSnapshot> {
    return this.http
      .get<any>(`${this.apiUrl}/store/dispatch-routes/${routeId}/tracking`)
      .pipe(
        map((r) => r.data as RouteTrackingSnapshot),
        catchError((e) => throwError(() => new Error(this.extractMessage(e)))),
      );
  }

  /** Returns the raw HttpErrorResponse on failure (publisher needs the status). */
  publishPositions(
    routeId: number,
    positions: PublishPositionPoint[],
  ): Observable<{ accepted: number }> {
    return this.http
      .post<any>(
        `${this.apiUrl}/store/dispatch-routes/${routeId}/tracking/positions`,
        { positions },
      )
      .pipe(map((r) => (r.data ?? { accepted: 0 }) as { accepted: number }));
  }

  /**
   * Subscribes to live positions. `onPosition` gets each new fix (SSE) and
   * `onSnapshot` gets full snapshots (polling fallback). `onState` reports
   * channel health.
   */
  watch(
    routeId: number,
    handlers: {
      onPosition: (p: RoutePosition) => void;
      onSnapshot: (s: RouteTrackingSnapshot) => void;
      onState?: (s: 'connecting' | 'sse' | 'polling' | 'closed') => void;
    },
  ): RouteTrackingWatch {
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    const stopPolling = () => {
      if (pollTimer != null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };
    const pollOnce = () => {
      this.getTracking(routeId).subscribe({
        next: (s) => {
          if (!closed) handlers.onSnapshot(s);
        },
        error: () => {
          /* keep polling; next tick retries */
        },
      });
    };
    const startPolling = () => {
      if (pollTimer != null) return;
      handlers.onState?.('polling');
      pollTimer = setInterval(pollOnce, 15_000);
    };

    const connect = () => {
      if (closed) return;
      const token = this.readAccessToken();
      if (!token || typeof EventSource === 'undefined') {
        startPolling();
        scheduleReconnect();
        return;
      }
      handlers.onState?.('connecting');
      const url =
        `${this.apiUrl}/store/dispatch-routes/${routeId}/tracking/stream` +
        `?token=${encodeURIComponent(token)}`;
      try {
        es = new EventSource(url);
      } catch {
        startPolling();
        scheduleReconnect();
        return;
      }
      es.onopen = () => {
        attempt = 0;
        stopPolling();
        handlers.onState?.('sse');
      };
      es.onmessage = (ev: MessageEvent) => {
        if (typeof ev.data !== 'string' || ev.data.startsWith(':')) return;
        try {
          const parsed = JSON.parse(ev.data);
          const pos = (parsed?.data ?? parsed) as RoutePosition;
          if (pos && typeof pos.lat === 'number' && typeof pos.lng === 'number') {
            handlers.onPosition(pos);
          }
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        try {
          es?.close();
        } catch {
          /* noop */
        }
        es = null;
        startPolling();
        pollOnce();
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer != null) return;
      const delay = Math.min(30_000, 1_000 * 2 ** attempt);
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    connect();

    return {
      close: () => {
        closed = true;
        stopPolling();
        if (reconnectTimer != null) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        try {
          es?.close();
        } catch {
          /* noop */
        }
        es = null;
        handlers.onState?.('closed');
      },
    };
  }

  private readAccessToken(): string | null {
    try {
      const raw = localStorage.getItem('vendix_auth_state');
      if (!raw) return null;
      return JSON.parse(raw)?.tokens?.access_token ?? null;
    } catch {
      return null;
    }
  }

  private extractMessage(error: any): string {
    return (
      error?.error?.message ||
      error?.error?.error ||
      error?.message ||
      'Error desconocido'
    );
  }
}
