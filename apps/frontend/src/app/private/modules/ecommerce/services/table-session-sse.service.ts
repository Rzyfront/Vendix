import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { environment } from '../../../../../environments/environment';
import { TableContextService } from './table-context.service';

/**
 * Connection state for the diner-facing table stream. Exposed as a signal
 * so zoneless templates can render a "Reconectando…" hint without RxJS.
 */
export type TableSseConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

/** Kitchen lifecycle event types emitted by the table stream. */
export type KitchenEventType =
  | 'kitchen.fired'
  | 'kitchen.preparing'
  | 'kitchen.ready'
  | 'kitchen.delivered';

/** High-level, diner-friendly order status derived from kitchen events. */
export type TableOrderStatus =
  | 'enviado-a-cocina'
  | 'en-preparación'
  | 'listo'
  | 'entregado';

/** Shape of the SSE payloads we care about (loose — we only read `type`). */
interface TableSseEvent {
  type: string;
  bill?: unknown;
  [key: string]: unknown;
}

/**
 * Backoff schedule: 1s, 2s, 4s, 8s, 16s, capped at 30s. Matches the KDS
 * service's visible-backoff approach so the diner UI can reason about it.
 */
const MAX_BACKOFF_MS = 30_000;

/**
 * Anonymous table-session SSE client for the storefront diner.
 *
 * Unlike `KdsSseService` (which authenticates the staff member with a JWT in
 * the query string), the diner is ANONYMOUS: the table's public token in the
 * URL path is the only credential. We therefore never read `vendix_auth_state`.
 *
 * The service auto-connects/disconnects by watching
 * `TableContextService.tableToken()` via an `effect`:
 *  - token != null → open the stream for that token
 *  - token == null → tear the stream down (e.g. the diner cleared the table)
 *
 * Design notes (see `vendix-zoneless-signals`):
 *  - State is exposed as SIGNALS; templates read them directly and zoneless
 *    CD reacts to the writes. No NgZone / markForCheck / detectChanges.
 *  - The `EventSource` and all timers are cleaned up in `disconnect()` and on
 *    `DestroyRef.onDestroy` — no orphan streams when switching tables.
 *  - Snapshot events carrying a `bill` are mirrored into
 *    `TableContextService.bill` so the "Mi cuenta" modal stays live.
 */
@Injectable({ providedIn: 'root' })
export class TableSessionSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly tableContext = inject(TableContextService);
  private readonly destroyRef = inject(DestroyRef);

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private currentToken: string | null = null;
  private destroyed = false;

  readonly connectionState = signal<TableSseConnectionState>('idle');
  readonly lastEvent = signal<TableSseEvent | null>(null);
  /** Last kitchen event type received — drives `orderStatus`. */
  private readonly lastKitchenType = signal<KitchenEventType | null>(null);

  /**
   * Diner-friendly order status derived from the most recent kitchen event.
   * `null` when nothing has been fired to the kitchen yet.
   */
  readonly orderStatus = computed<TableOrderStatus | null>(() => {
    switch (this.lastKitchenType()) {
      case 'kitchen.ready':
        return 'listo';
      case 'kitchen.preparing':
        return 'en-preparación';
      case 'kitchen.fired':
        return 'enviado-a-cocina';
      case 'kitchen.delivered':
        return 'entregado';
      default:
        return null;
    }
  });

  constructor() {
    // Auto-connect to whichever table is active. `untracked` keeps the
    // connect/disconnect side effects (which read signals internally) from
    // becoming dependencies of this effect — it only re-runs when the token
    // itself changes.
    effect(() => {
      const token = this.tableContext.tableToken();
      untracked(() => {
        if (token) {
          this.connect(token);
        } else {
          this.disconnect();
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.disconnect();
    });
  }

  /**
   * Open the stream for `token`. Idempotent while already streaming the same
   * token; switching tokens tears the old stream down first.
   */
  connect(token: string): void {
    if (this.destroyed) return;
    if (
      this.currentToken === token &&
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    // New table (or reconnect after teardown): reset the previous stream.
    this.teardownSource();
    this.currentToken = token;
    this.reconnectAttempt = 0;
    this.openEventSource(token);
  }

  /** Close the stream, cancel reconnects and clear the derived status. */
  disconnect(): void {
    this.clearReconnectTimer();
    this.teardownSource();
    this.currentToken = null;
    this.lastKitchenType.set(null);
    this.lastEvent.set(null);
    this.connectionState.set('closed');
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(token: string): void {
    if (this.destroyed) return;

    // Anonymous: the token lives in the path. EventSource CANNOT send an
    // `x-store-id` header, so the store the middleware needs is passed as a
    // query param (`DomainResolverMiddleware` reads `req.query.store_id`).
    // Without it the stream resolves store_id=undefined → 403 → tight retry.
    const storeId = this.tableContext.storeId();
    const url =
      `${this.apiUrl}/ecommerce/tables/${encodeURIComponent(token)}/stream` +
      (storeId != null ? `?store_id=${storeId}` : '');

    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      this.connectionState.set('error');
      this.scheduleReconnect(token);
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.connectionState.set('open');
    };

    es.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    es.onerror = () => {
      // We manage reconnection ourselves (visible backoff) instead of relying
      // on EventSource's fixed internal retry.
      this.connectionState.set('error');
      this.teardownSource();
      this.scheduleReconnect(token);
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    // SSE comment lines (heartbeats ": heartbeat") start with ":" — ignore.
    if (event.data.startsWith(':')) return;

    let parsed: TableSseEvent;
    try {
      parsed = JSON.parse(event.data) as TableSseEvent;
    } catch {
      return;
    }
    this.lastEvent.set(parsed);

    // Mirror the live bill from snapshots into the shared table context so the
    // "Mi cuenta" modal reflects new items without a manual refetch.
    if (parsed.type === 'snapshot' && parsed.bill) {
      this.tableContext.bill.set(parsed.bill as never);
      return;
    }

    if (typeof parsed.type === 'string' && parsed.type.startsWith('kitchen.')) {
      this.lastKitchenType.set(parsed.type as KitchenEventType);
    }
  }

  private scheduleReconnect(token: string): void {
    if (this.destroyed) return;
    if (this.currentToken !== token) return; // table changed — abandon.

    this.reconnectAttempt += 1;
    const delay = Math.min(
      1_000 * 2 ** (this.reconnectAttempt - 1),
      MAX_BACKOFF_MS,
    );
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource(token);
    }, delay);
  }

  private teardownSource(): void {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
