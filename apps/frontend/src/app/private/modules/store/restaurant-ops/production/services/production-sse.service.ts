import { DestroyRef, Injectable, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject } from 'rxjs';
import { debounceTime, filter } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ProductionStreamEvent } from '../interfaces';

export type ProductionConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

/** `live` = SSE connected; `manual` = SSE kept failing, polling tick instead. */
export type ProductionStreamMode = 'live' | 'manual';

/**
 * What consumers receive: a real `production_order.updated` event, or a
 * `refresh` signal (SSE reconnected after a gap, or the polling fallback
 * ticked) that means "reload, you may have missed events".
 */
export type ProductionStreamSignal =
  | ProductionStreamEvent
  | { type: 'refresh'; reason: 'reconnected' | 'poll' };

/**
 * Which API serves the shared production views. Planta (manufacturing) reads
 * through `store/manufacturing/orders/*` so a manufacturing-only store passes
 * its own industry guard; everything else uses `store/production-orders/*`.
 */
export type ProductionApiScope = 'restaurant' | 'manufacturing';

const STREAM_PATHS: Record<ProductionApiScope, string> = {
  restaurant: '/store/production-orders/stream',
  manufacturing: '/store/manufacturing/orders/stream',
};

/** Read permissions the backend accepts on each stream (the restaurant one takes either). */
const STREAM_PERMISSIONS: Record<ProductionApiScope, string[]> = {
  restaurant: ['store:production_orders:read', 'store:manufacturing:orders:read'],
  manufacturing: ['store:manufacturing:orders:read'],
};

export const PRODUCTION_POLLING_INTERVAL_MS = 15_000;
/** Same reconnection window as the KDS: after 5 min of failures, fall back to polling. */
export const PRODUCTION_RECONNECT_WINDOW_MS = 5 * 60_000;
/** A sale card start / finish emits one event per order; coalesce them. */
export const PRODUCTION_RELOAD_DEBOUNCE_MS = 300;

/**
 * Live sync of production orders (QUI-1002), modelled on `KdsSseService`:
 * a native EventSource with explicit exponential backoff (1s → 30s) and a
 * polling fallback. The stream is shared and reference-counted: it opens when
 * the first page listens and closes when the last one is destroyed.
 *
 * Pages use `listen(destroyRef, reload)`; the signal itself carries no data
 * the page needs, because every consumer reloads from its own endpoint.
 */
@Injectable({ providedIn: 'root' })
export class ProductionSseService implements OnDestroy {
  private readonly apiUrl = environment.apiUrl;
  private readonly auth = inject(AuthFacade);
  /** Scope of the open connection (both streams carry the same events). */
  private scope: ProductionApiScope = 'restaurant';
  /** Listeners per scope, so the connection follows the scope that can pass its guard. */
  private readonly scopeListeners: Record<ProductionApiScope, number> = {
    restaurant: 0,
    manufacturing: 0,
  };

  private readonly signalsSubject = new Subject<ProductionStreamSignal>();
  /** Raw stream of events and refresh signals. */
  readonly signals$: Observable<ProductionStreamSignal> =
    this.signalsSubject.asObservable();

  readonly connectionState = signal<ProductionConnectionState>('idle');
  readonly mode = signal<ProductionStreamMode>('live');
  /** True after the server answered 401/403: the stream stays stopped (no retry, no polling). */
  readonly forbidden = signal(false);

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectStartedAt: number | null = null;
  /** True after a failure, so the next `open` asks consumers to reconcile. */
  private hadGap = false;
  private listeners = 0;
  private destroyed = false;
  /** Bumped on every connect/disconnect so a late permission probe never acts on a stale connection. */
  private generation = 0;
  private probing = false;
  private recoveryBound = false;
  private readonly recoverLive = () => this.tryRecoverLive();

  /**
   * Whether the current user may open the stream of `scope`. Pages without the
   * permission must not call `listen`/`acquire`: the server would answer 403.
   */
  canStream(scope: ProductionApiScope = 'restaurant'): boolean {
    return this.auth.hasAnyPermission(STREAM_PERMISSIONS[scope]);
  }

  /**
   * Subscribes `callback` (debounced) to stream signals for the lifetime of
   * `destroyRef`, keeping the shared connection open meanwhile.
   * `accept` narrows real events (e.g. one order id); refresh signals always pass.
   */
  listen(
    destroyRef: DestroyRef,
    callback: () => void,
    accept?: (event: ProductionStreamEvent) => boolean,
    scope: ProductionApiScope = 'restaurant',
  ): void {
    const release = this.acquire(scope);
    destroyRef.onDestroy(release);
    this.signals$
      .pipe(
        // Filter before debouncing so unrelated events never delay a reload.
        filter(
          (s) =>
            s.type !== 'production_order.updated' || !accept || accept(s),
        ),
        debounceTime(PRODUCTION_RELOAD_DEBOUNCE_MS),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe(() => callback());
  }

  /** Reference-counted connection. Returns the idempotent release function. */
  acquire(scope: ProductionApiScope = 'restaurant'): () => void {
    this.scopeListeners[scope] += 1;
    this.listeners += 1;
    if (this.listeners === 1) {
      this.scope = this.desiredScope();
      this.connect();
    } else {
      this.syncScope();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.scopeListeners[scope] = Math.max(0, this.scopeListeners[scope] - 1);
      this.listeners = Math.max(0, this.listeners - 1);
      if (this.listeners === 0) this.disconnect();
      else this.syncScope();
    };
  }

  /** Restart the stream with a fresh reconnection window. */
  reconnect(): void {
    if (this.listeners === 0) return;
    this.disconnect();
    this.connect();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
    this.signalsSubject.complete();
  }

  // ─── private ─────────────────────────────────────────────────────────

  /**
   * Planta wins while any of its pages listens: a manufacturing listener only
   * mounts in a store with Planta, whose stream passes its own industry guard
   * (a manufacturing-only store fails the restaurant one) and carries the same
   * events.
   */
  private desiredScope(): ProductionApiScope {
    return this.scopeListeners.manufacturing > 0 ? 'manufacturing' : 'restaurant';
  }

  /** Reopens the shared stream on the desired scope; consumers reconcile once it opens. */
  private syncScope(): void {
    const desired = this.desiredScope();
    if (desired === this.scope) return;
    this.scope = desired;
    this.disconnect();
    this.hadGap = true;
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;
    if (this.eventSource) return;
    this.mode.set('live');
    this.forbidden.set(false);
    this.reconnectStartedAt = null;
    this.reconnectAttempt = 0;
    this.openEventSource();
  }

  private disconnect(): void {
    this.generation += 1;
    this.clearReconnectTimer();
    this.stopPolling();
    this.unbindRecovery();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.hadGap = false;
    this.connectionState.set(this.listeners === 0 ? 'idle' : 'closed');
  }

  private openEventSource(): void {
    const token = this.readAccessToken();
    if (!token) {
      this.connectionState.set('error');
      this.scheduleReconnect();
      return;
    }

    const url = `${this.apiUrl}${STREAM_PATHS[this.scope]}?token=${encodeURIComponent(token)}`;
    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      this.connectionState.set('error');
      this.scheduleReconnect();
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.reconnectStartedAt = null;
      this.connectionState.set('open');
      if (this.mode() !== 'live') {
        this.mode.set('live');
        this.stopPolling();
        this.unbindRecovery();
      }
      if (this.hadGap) {
        this.hadGap = false;
        this.signalsSubject.next({ type: 'refresh', reason: 'reconnected' });
      }
    };

    es.onmessage = (event: MessageEvent) => this.handleMessage(event);

    es.onerror = () => {
      // Close and reconnect ourselves so the backoff is explicit.
      this.connectionState.set('error');
      this.hadGap = true;
      try {
        es.close();
      } catch {
        // ignore
      }
      if (this.eventSource === es) this.eventSource = null;
      void this.handleStreamFailure(url);
    };
  }

  /**
   * EventSource hides the HTTP status, so ask the server once: a 401/403 means
   * the user cannot read production and retrying (or polling) is pointless.
   */
  private async handleStreamFailure(url: string): Promise<void> {
    const generation = this.generation;
    this.probing = true;
    let status: number | null = null;
    try {
      status = await this.probeStatus(url);
    } finally {
      this.probing = false;
    }
    if (generation !== this.generation || this.destroyed) return;
    if (status === 401 || status === 403) {
      this.stopForbidden();
      return;
    }
    this.scheduleReconnect();
  }

  /** HTTP status of the stream endpoint, or null when unreachable. Overridable in specs. */
  protected async probeStatus(url: string): Promise<number | null> {
    const controller = new AbortController();
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      });
      return response.status;
    } catch {
      return null;
    } finally {
      // Never keep an accepted stream open: only the status matters.
      controller.abort();
    }
  }

  private stopForbidden(): void {
    this.clearReconnectTimer();
    this.stopPolling();
    this.unbindRecovery();
    this.forbidden.set(true);
    this.mode.set('live');
    this.connectionState.set('closed');
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    // Heartbeats are SSE comments or non-JSON payloads: ignore.
    if (event.data.startsWith(':')) return;
    let parsed: ProductionStreamEvent;
    try {
      parsed = JSON.parse(event.data) as ProductionStreamEvent;
    } catch {
      return;
    }
    if (parsed?.type !== 'production_order.updated') return;
    this.signalsSubject.next(parsed);
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.listeners === 0) return;
    if (this.reconnectStartedAt === null) this.reconnectStartedAt = Date.now();
    if (Date.now() - this.reconnectStartedAt >= PRODUCTION_RECONNECT_WINDOW_MS) {
      this.transitionToManual();
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource();
    }, delay);
  }

  private transitionToManual(): void {
    if (this.mode() === 'manual') return;
    this.mode.set('manual');
    this.clearReconnectTimer();
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
    this.connectionState.set('closed');
    this.startPolling();
    this.bindRecovery();
  }

  /** Manual mode: network back or window focused → try the live stream again. */
  private bindRecovery(): void {
    if (this.recoveryBound || typeof window === 'undefined') return;
    this.recoveryBound = true;
    window.addEventListener('online', this.recoverLive);
    window.addEventListener('focus', this.recoverLive);
  }

  private unbindRecovery(): void {
    if (!this.recoveryBound || typeof window === 'undefined') return;
    this.recoveryBound = false;
    window.removeEventListener('online', this.recoverLive);
    window.removeEventListener('focus', this.recoverLive);
  }

  /**
   * One live attempt while polling keeps running; `onopen` switches back to
   * live and stops the polling. A failure leaves manual mode untouched.
   */
  private tryRecoverLive(): void {
    if (this.destroyed || this.listeners === 0) return;
    if (this.mode() !== 'manual' || this.eventSource || this.probing) return;
    if (this.forbidden()) return;
    this.openEventSource();
  }

  private startPolling(): void {
    if (this.pollingTimer) return;
    this.signalsSubject.next({ type: 'refresh', reason: 'poll' });
    this.pollingTimer = setInterval(
      () => this.signalsSubject.next({ type: 'refresh', reason: 'poll' }),
      PRODUCTION_POLLING_INTERVAL_MS,
    );
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private readAccessToken(): string | null {
    try {
      const raw = localStorage.getItem('vendix_auth_state');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.tokens?.access_token ?? null;
    } catch {
      return null;
    }
  }
}
