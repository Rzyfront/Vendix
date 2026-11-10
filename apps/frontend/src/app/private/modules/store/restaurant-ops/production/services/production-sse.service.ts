import { DestroyRef, Injectable, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject } from 'rxjs';
import { debounceTime, filter } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
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
  /** Scope of the open connection; set by the first listener (both streams carry the same events). */
  private scope: ProductionApiScope = 'restaurant';

  private readonly signalsSubject = new Subject<ProductionStreamSignal>();
  /** Raw stream of events and refresh signals. */
  readonly signals$: Observable<ProductionStreamSignal> =
    this.signalsSubject.asObservable();

  readonly connectionState = signal<ProductionConnectionState>('idle');
  readonly mode = signal<ProductionStreamMode>('live');

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectStartedAt: number | null = null;
  /** True after a failure, so the next `open` asks consumers to reconcile. */
  private hadGap = false;
  private listeners = 0;
  private destroyed = false;

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
    if (this.listeners === 0) this.scope = scope;
    this.listeners += 1;
    if (this.listeners === 1) this.connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.listeners = Math.max(0, this.listeners - 1);
      if (this.listeners === 0) this.disconnect();
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

  private connect(): void {
    if (this.destroyed) return;
    if (this.eventSource) return;
    this.mode.set('live');
    this.reconnectStartedAt = null;
    this.reconnectAttempt = 0;
    this.openEventSource();
  }

  private disconnect(): void {
    this.clearReconnectTimer();
    this.stopPolling();
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
      this.scheduleReconnect();
    };
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
