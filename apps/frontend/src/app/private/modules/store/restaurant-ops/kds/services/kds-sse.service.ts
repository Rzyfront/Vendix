import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../../../../environments/environment';
import {
  KdsEvent,
  KitchenTicket,
  KitchenTicketStatus,
} from '../interfaces';

/**
 * Internal connection state for the KDS SSE stream. Exposed via signal
 * so zoneless templates can render the "Reconectando…" / "Conectado"
 * status without needing RxJS.
 */
export type KdsConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

export interface KdsReconnectAttempt {
  attempt: number;
  nextDelayMs: number;
  reason: string;
}

/**
 * KDS SSE service — wraps the browser's EventSource with explicit
 * reconnection, exponential backoff (1s → 2s → 4s → …, max 30s) and
 * snapshot reconciliation.
 *
 * Design notes (see `vendix-zoneless-signals`):
 *  - State is exposed as SIGNALS (not BehaviorSubject). The KDS page
 *    consumes them via `toSignal` or direct calls. We never use
 *    `markForCheck` / `detectChanges` — zoneless handles change
 *    detection via the signal itself.
 *  - We do NOT use the global `EventSource` auto-reconnect: the
 *    browser reconnects on TCP errors but at a fixed 3s delay and
 *    without any visibility. Instead we re-create the source ourselves
 *    with explicit backoff so the UI can show a counter.
 *  - The "snapshot" event from the server REPLACES the local tickets
 *    array; "ticket.*" events UPSERT or REMOVE by id. This means a
 *    fresh connection (e.g. after refresh) doesn't drop state.
 */
@Injectable({ providedIn: 'root' })
export class KdsSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/kitchen-fire';

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private destroyed = false;

  /** All tickets the KDS currently knows about, keyed by id. */
  readonly tickets = signal<KitchenTicket[]>([]);
  readonly connectionState = signal<KdsConnectionState>('idle');
  readonly lastEvent = signal<KdsEvent | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly lastReconnect = signal<KdsReconnectAttempt | null>(null);

  /** Open the SSE stream. Idempotent — calling twice is a no-op while open. */
  connect(windowMinutes: number = 120): void {
    if (this.destroyed) return;
    if (
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    this.openEventSource(windowMinutes);
  }

  /** Close the SSE stream and cancel any pending reconnect. */
  disconnect(): void {
    this.clearReconnectTimer();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  /**
   * Hard reset — closes the stream, clears the backoff counter and
   * tickets cache. Useful when the user clicks "Refrescar" in the KDS.
   */
  reset(): void {
    this.disconnect();
    this.reconnectAttempt = 0;
    this.tickets.set([]);
    this.lastError.set(null);
    this.lastReconnect.set(null);
    this.connectionState.set('idle');
  }

  /** Cleanup on service destroy (rare — service is root-provided). */
  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(windowMinutes: number): void {
    const token = this.readAccessToken();
    if (!token) {
      this.lastError.set('No hay token de autenticación');
      this.connectionState.set('error');
      this.scheduleReconnect('no_token', windowMinutes);
      return;
    }

    const url =
      `${this.apiUrl}${this.basePath}/stream` +
      `?token=${encodeURIComponent(token)}` +
      `&windowMinutes=${windowMinutes}`;

    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch (err) {
      this.lastError.set((err as Error).message);
      this.connectionState.set('error');
      this.scheduleReconnect('construct_failed', windowMinutes);
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.connectionState.set('open');
      this.lastError.set(null);
    };

    es.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    es.onerror = () => {
      // EventSource will internally try to reconnect on its own, but we
      // close it and manage reconnects ourselves so the backoff is
      // visible to the UI.
      this.lastError.set('Stream connection error');
      this.connectionState.set('error');
      try {
        es.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
      this.scheduleReconnect('onerror', windowMinutes);
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    // SSE comment lines (heartbeats) start with ":" — ignore them.
    if (event.data.startsWith(':')) return;
    let parsed: KdsEvent;
    try {
      parsed = JSON.parse(event.data) as KdsEvent;
    } catch {
      this.lastError.set('Malformed SSE payload');
      return;
    }
    this.lastEvent.set(parsed);
    this.applyEvent(parsed);
  }

  /**
   * Reconcile a single KDS event against the current tickets cache.
   *  - snapshot       → replace whole array
   *  - ticket.*       → upsert by id; if status is `delivered` or
   *                     `cancelled` we still keep it (the "Delivered"
   *                     column needs recent history).
   */
  private applyEvent(event: KdsEvent): void {
    if (event.type === 'snapshot') {
      this.tickets.set(event.tickets ?? []);
      return;
    }
    if (!('ticket' in event) || !event.ticket) return;
    const incoming = event.ticket as KitchenTicket;
    const id = incoming?.id;
    if (typeof id !== 'number') return;

    this.tickets.update((list) => {
      const idx = list.findIndex((t) => t.id === id);
      if (idx === -1) {
        return [...list, incoming];
      }
      const next = [...list];
      next[idx] = incoming;
      return next;
    });
  }

  private scheduleReconnect(reason: string, windowMinutes: number): void {
    if (this.destroyed) return;
    this.reconnectAttempt += 1;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 30s.
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    this.lastReconnect.set({
      attempt: this.reconnectAttempt,
      nextDelayMs: delay,
      reason,
    });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource(windowMinutes);
    }, delay);
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
