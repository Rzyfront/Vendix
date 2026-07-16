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
import { ToastService } from '../../../../shared/components/toast/toast.service';

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
 * Minimal shape of a `comensal_joined` / `comensal_left` event. Mirrors
 * `DinerJoinEvent` in `TableContextService` (kept loose here so the SSE
 * service does not depend on the diner-context type at runtime).
 */
interface ComensalPresenceEvent {
  device_id: string;
  active_devices: number;
  timestamp?: number;
}

/**
 * Minimal shape of a `payment.pending` SSE event. Mirrors
 * `PaymentTablePendingView` from `TableContextService` — kept loose here
 * so the SSE service does not couple to the diner-context type.
 */
interface PaymentPendingEvent {
  payment_id: number;
  amount?: number;
  method?: string;
}

/**
 * Minimal shape of a `payment.confirmed` SSE event. Mirrors
 * `PaymentTableConfirmedView` from `TableContextService`.
 */
interface PaymentConfirmedEvent {
  payment_id: number;
  amount?: number;
  method?: string;
  state?: string;
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
  private readonly toast = inject(ToastService);
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

  // ── Diner presence + bill + guest count mirrors (D2) ───────────────
  /**
   * Wall-clock epoch (ms) of the most recent `item_added` event for this
   * table. Templates use this as a "dirty" tick to refresh the bill view
   * via the existing `getMyBill()` (D3 wires the explicit refetch). Just
   * exposing the timestamp avoids a forced HTTP round-trip on every SSE
   * delta — consumers can opt into a refetch when they care.
   */
  readonly billLastUpdated = signal<number>(0);
  /**
   * `guest_count` mirror. The backend pushes `guest_count_changed` whenever
   * the table's diner count changes (POST `/guests` or a mesero edit).
   */
  readonly guestCount = signal<number>(0);

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
    this.billLastUpdated.set(0);
    this.guestCount.set(0);
    this.connectionState.set('closed');
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(token: string): void {
    if (this.destroyed) return;

    // Anonymous: the token lives in the path. EventSource CANNOT send an
    // `x-store-id` header, so the store the middleware needs is passed as a
    // query param (`DomainResolverMiddleware` reads `req.query.store_id`).
    // Without it the stream resolves store_id=undefined → 403 → tight retry.
    //
    // `device_id` is the per-tab UUID from `TableContextService.deviceUuid()`
    // (sessionStorage, see D1). The backend reads it from `req.query.device_id`
    // and feeds it to `recordDinerPresence` so the staff can see how many
    // phones are at the table. We send it on EVERY reconnect (the
    // sessionStorage value is stable for the lifetime of the tab).
    const storeId = this.tableContext.storeId();
    const deviceId = this.tableContext.deviceUuid();
    const params: string[] = [];
    if (storeId != null) {
      params.push(`store_id=${encodeURIComponent(String(storeId))}`);
    }
    if (deviceId) {
      params.push(`device_id=${encodeURIComponent(deviceId)}`);
    }
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const url = `${this.apiUrl}/ecommerce/tables/${encodeURIComponent(token)}/stream${query}`;

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

    // Dispatch on `type`. The `switch` keeps the mapping table-shaped — easy
    // to audit against the backend's `comensal_joined`, `item_added`, etc.
    // event list (see `vendix-restaurant-table-qr` §SSE Snapshot Pattern).
    switch (parsed.type) {
      case 'snapshot': {
        // Mirror the live bill from snapshots into the shared table context
        // so the "Mi cuenta" modal reflects new items without a manual
        // refetch. `guest_count` is also seedable from the snapshot.
        if (parsed.bill) {
          this.tableContext.bill.set(parsed.bill as never);
        }
        const guestCount = (parsed as { guest_count?: unknown }).guest_count;
        if (typeof guestCount === 'number') {
          this.guestCount.set(guestCount);
        }
        return;
      }

      case 'kitchen.fired':
      case 'kitchen.preparing':
      case 'kitchen.ready':
      case 'kitchen.delivered': {
        this.lastKitchenType.set(parsed.type as KitchenEventType);
        return;
      }

      case 'comensal_joined':
      case 'comensal_left': {
        // Diner presence — the backend tells us the new running count of
        // active devices so the banner can render "3 dispositivos en la
        // mesa". We delegate the write to `TableContextService` so it stays
        // the single source of truth for diner presence signals.
        const ev = parsed as unknown as Partial<ComensalPresenceEvent>;
        if (
          typeof ev.device_id === 'string' &&
          typeof ev.active_devices === 'number'
        ) {
          this.tableContext.recordDinerPresence({
            device_id: ev.device_id,
            active_devices: ev.active_devices,
            timestamp:
              typeof ev.timestamp === 'number' ? ev.timestamp : Date.now(),
          });
        }
        return;
      }

      case 'item_added': {
        // Bill is dirty. We do NOT push a partial line into
        // `tableContext.bill` here — the authoritative bill payload comes
        // from the backend's snapshot/bill endpoint and is reconciled by
        // D3. We just bump a timestamp so templates can opt into a
        // reactive refetch via `effect(() => billLastUpdated())`.
        this.billLastUpdated.set(Date.now());
        return;
      }

      case 'guest_count_changed': {
        const ev = parsed as { guest_count?: unknown };
        if (typeof ev.guest_count === 'number') {
          this.guestCount.set(ev.guest_count);
        }
        return;
      }

      case 'payment.pending': {
        // Mirrors `PaymentTablePendingView` into the shared table-context
        // signal so the banner flips to "Pago pendiente" without a refetch.
        const ev = parsed as Partial<PaymentPendingEvent>;
        if (typeof ev.payment_id === 'number') {
          this.tableContext.paymentPending.set({
            payment_id: ev.payment_id,
            amount: typeof ev.amount === 'number' ? ev.amount : 0,
            method: typeof ev.method === 'string' ? ev.method : '',
            state: 'pending',
          });
        }
        return;
      }

      case 'payment.confirmed': {
        // Mirrors `PaymentTableConfirmedView` AND clears the pending slot —
        // a confirmed payment always supersedes a pending one for the same
        // diner flow.
        const ev = parsed as Partial<PaymentConfirmedEvent>;
        if (typeof ev.payment_id === 'number') {
          const state: 'succeeded' | 'captured' =
            ev.state === 'captured' ? 'captured' : 'succeeded';
          this.tableContext.paymentConfirmed.set({
            payment_id: ev.payment_id,
            amount: typeof ev.amount === 'number' ? ev.amount : 0,
            method: typeof ev.method === 'string' ? ev.method : '',
            state,
          });
          this.tableContext.paymentPending.set(null);
        }
        return;
      }

      case 'session_closed': {
        // The table session was settled/closed (POS cash/card, diner
        // self-checkout, or explicit close). Backend contract carries the
        // closed session id under `data.table_session_id` (some diner
        // projections flatten it to the top level — read both).
        const closedSessionId =
          (parsed as { table_session_id?: unknown }).table_session_id ??
          (parsed as { data?: { table_session_id?: unknown } }).data
            ?.table_session_id;
        const active = this.tableContext.sessionId();
        // Multi-tenant / stale-event isolation: when both ids are known and
        // differ, this close belongs to another session — ignore it.
        if (
          typeof closedSessionId === 'number' &&
          typeof active === 'number' &&
          closedSessionId !== active
        ) {
          return;
        }
        this.handleSessionClosed();
        return;
      }

      default:
        // Unknown event type — already mirrored into `lastEvent` for
        // debugging. Ignore silently otherwise.
        return;
    }
  }

  /**
   * Reacts to a `session_closed` event: flips the diner into the farewell
   * state WITHOUT refetching the bill (the account is settled), stops the
   * stream cleanly (no reconnect — the session is over), and surfaces a
   * global "Mesa cerrada / ¡Gracias por tu visita!" toast.
   *
   * The table context is intentionally NOT cleared here — the diner keeps
   * their final bill visible and acknowledges via
   * `TableContextService.acknowledgeSessionClosed()` (wired to the banner
   * farewell CTA), which then `leaveTable()`s.
   */
  private handleSessionClosed(): void {
    // Mark closed — the banner reads `sessionClosed()` to show the farewell.
    // Deliberately NO `getMyBill()` refetch: the closed bill is final.
    this.tableContext.sessionClosed.set(true);
    // Stop this stream cleanly; the session is over, so we neither keep the
    // source open nor schedule a reconnect (which would re-snapshot a dead
    // session in a tight backoff loop).
    this.clearReconnectTimer();
    this.teardownSource();
    this.currentToken = null;
    this.connectionState.set('closed');
    // Immediate diner-facing farewell via the global toast overlay — visible
    // even though the persistent banner lives in the (out-of-scope) layout.
    this.toast.info('Mesa cerrada. ¡Gracias por tu visita!');
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
