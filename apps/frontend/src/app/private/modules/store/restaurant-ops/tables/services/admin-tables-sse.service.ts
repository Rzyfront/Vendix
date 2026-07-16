import {
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { TablesService } from './tables.service';

/**
 * Estado de conexión del stream SSE staff de mesas. Expuesto vía
 * signal para que la floor-page pueda pintar un banner compacto
 * (igual que el KDS) sin necesidad de RxJS.
 */
export type AdminTablesConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

/**
 * Modo operativo del stream de mesas.
 *  - `live`:    conectado a SSE, recibiendo eventos en tiempo real.
 *  - `manual`:  el stream se cayó reiteradamente y caímos a polling
 *               contra `getFloorMap()` cada `ADMIN_TABLES_POLLING_INTERVAL_MS`.
 */
export type AdminTablesMode = 'live' | 'manual';

/** Intervalo de polling usado como fallback cuando el SSE falla. */
export const ADMIN_TABLES_POLLING_INTERVAL_MS = 10_000;
/**
 * Ventana máxima de reconexión. Igual que el KDS: 5 min. Si la
 * reconexión no vuelve a `open` en este intervalo, el servicio transiciona
 * a `mode='manual'` y arranca un `setInterval` contra `getFloorMap`.
 */
export const ADMIN_TABLES_RECONNECT_WINDOW_MS = 5 * 60_000;

/**
 * Payload live de una mesa ocupado, derivado del snapshot inicial y de
 * los eventos SSE entrantes. Es la única fuente de verdad para el floor
 * map cuando el stream está conectado: el `TableFloorMapComponent` lee
 * `liveCounts()` y pinta badges activos (comensales, ítems, pago).
 */
export interface AdminTablesLivePayload {
  session_id: number;
  table_id: number;
  order_id: number;
  guest_count: number | null;
  /** Comensales activos en la sesión — emitido por comensal_joined/left. */
  active_devices: number;
  /** # de ítems en la orden — derivado de item_added (no lo emite el BE). */
  item_count: number;
  /** Estado del pago agregado a nivel sesión. */
  payment_state: 'none' | 'pending' | 'confirmed';
  /** Última actualización (epoch ms). */
  updated_at: number;
  /**
   * Subtotal acumulado de la sesión en COP. Lo emite el BE en
   * `item_added`; cuando no hay payload nuevo, conservamos el último valor
   * conocido para no parpadear el contador en cada heartbeat.
   */
  subtotal: number;
}

/**
 * Envelope del snapshot inicial que envía el backend en `connect`.
 * Coincide con `listActiveSessions()` en el backend.
 */
interface AdminTablesSnapshotSession {
  id: number;
  store_id: number;
  table_id: number;
  order_id: number;
  opened_at: string | Date;
  guest_count: number | null;
  table: {
    id: number;
    name: string;
    zone: string | null;
    status: string;
  } | null;
  order: {
    id: number;
    state: string;
    grand_total: number | string;
    customer: {
      id: number;
      first_name: string;
      last_name: string;
    } | null;
  };
}

interface AdminTablesSnapshotPayload {
  sessions: AdminTablesSnapshotSession[];
  server_ts?: number;
  error?: string;
}

/**
 * Discriminador tipado de los eventos SSE que llegan por el stream
 * staff. Solo se modelan los tipos que el floor-map necesita; el
 * controller backend usa default-deny para cualquier otro.
 */
export type AdminTablesEvent =
  | { type: 'snapshot'; data: AdminTablesSnapshotPayload; ts?: number }
  | { type: 'item_added'; data: Record<string, unknown>; ts?: number }
  | {
      type: 'comensal_joined' | 'comensal_left';
      data: Record<string, unknown>;
      ts?: number;
    }
  | {
      type: 'guest_count_changed';
      data: Record<string, unknown>;
      ts?: number;
    }
  | {
      type: 'bill.requested';
      data: Record<string, unknown>;
      ts?: number;
    }
  | {
      type: 'payment.pending' | 'payment.confirmed';
      data: Record<string, unknown>;
      ts?: number;
    }
  | {
      type: 'table_payment_pending' | 'table_payment_confirmed';
      data: Record<string, unknown>;
      ts?: number;
    }
  | { type: 'kitchen.fired'; data: Record<string, unknown>; ts?: number }
  | {
      type:
        | 'kitchen.started'
        | 'kitchen.ready'
        | 'kitchen.delivered'
        | 'kitchen.cancelled';
      data: Record<string, unknown>;
      ts?: number;
    };

/**
 * AdminTablesSseService — wrappea el `EventSource` del staff stream
 * (`/api/store/table-sessions/stream?token=…`) con reconexión
 * exponencial (1s → 2s → 4s → …, max 30s) y reconciliación de
 * snapshot. Si la reconexión no vuelve a `open` dentro de
 * `ADMIN_TABLES_RECONNECT_WINDOW_MS` (5 min), cae en modo `manual`
 * (polling cada 10s contra `TablesService.getFloorMap()`).
 *
 * Notas de diseño (ver `vendix-zoneless-signals`):
 *  - El estado se expone como SIGNALS (no subjects RxJS). La floor
 *    page los consume directo; zoneless reacciona al write del signal
 *    sin necesidad de `markForCheck`.
 *  - No usamos la auto-reconexión del `EventSource` global: el browser
 *    reintenta a 3s fijos sin visibilidad. Re-creamos la conexión
 *    nosotros con backoff explícito para que la UI pueda mostrar el
 *    contador si así lo decide.
 *  - El evento `snapshot` REEMPLAZA el map local; el resto de eventos
 *    UPSERT por `session_id` o descartan silenciosamente si no traen
 *    identificador de sesión.
 *  - El polling fallback se cancela automáticamente al volver a modo
 *    `live` (effect en `mode()`).
 */
@Injectable({ providedIn: 'root' })
export class AdminTablesSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/table-sessions';
  private readonly tablesService = inject(TablesService);

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectStartedAt: number | null = null;
  private destroyed = false;

  /**
   * Map<session_id, payload live>. La floor-page lo lee para pintar
   * los badges activos sobre la celda de cada mesa. Vacío hasta que
   * llegue el primer `snapshot`.
   */
  readonly tablesLive = signal<Map<number, AdminTablesLivePayload>>(new Map());
  readonly connectionState = signal<AdminTablesConnectionState>('idle');
  readonly lastEvent = signal<AdminTablesEvent | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly mode = signal<AdminTablesMode>('live');
  readonly consecutiveFailures = signal<number>(0);
  /** True una vez que tenemos snapshot cargado (cells pintables). */
  readonly hasSnapshot = signal<boolean>(false);
  readonly lastEventAt = signal<Date | null>(null);

  constructor() {
    // Reaccionar al cambio de modo arrancando/detiniendo el polling.
    // Idéntico al patrón de KdsSseService.
    effect(() => {
      const current = this.mode();
      untracked(() => {
        if (current === 'manual') {
          this.startPollingInternal();
        } else {
          this.stopPollingInternal();
        }
      });
    });
  }

  /** Open the SSE stream. Idempotent — calling twice is a no-op while open. */
  connect(): void {
    if (this.destroyed) return;
    if (
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    if (this.mode() !== 'live') {
      this.mode.set('live');
    }
    this.reconnectStartedAt = null;
    this.reconnectAttempt = 0;
    this.openEventSource();
  }

  /** Close the SSE stream and cancel any pending reconnect. */
  disconnect(): void {
    this.clearReconnectTimer();
    this.stopPollingInternal();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  /** Hard reset — same semantics as KdsSseService.reset(). */
  reset(): void {
    this.disconnect();
    this.reconnectAttempt = 0;
    this.reconnectStartedAt = null;
    this.consecutiveFailures.set(0);
    this.tablesLive.set(new Map());
    this.lastError.set(null);
    this.hasSnapshot.set(false);
    this.connectionState.set('idle');
    this.mode.set('live');
    this.lastEventAt.set(null);
  }

  /** Cleanup on service destroy (rare — service is root-provided). */
  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // ─── private ───────────────────────────────────────────────────────

  private openEventSource(): void {
    const token = this.readAccessToken();
    if (!token) {
      this.lastError.set('No hay token de autenticación');
      this.connectionState.set('error');
      this.consecutiveFailures.update((n) => n + 1);
      this.scheduleReconnect('no_token');
      return;
    }

    const url =
      `${this.apiUrl}${this.basePath}/stream` +
      `?token=${encodeURIComponent(token)}`;

    this.connectionState.set(
      this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting',
    );

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch (err) {
      this.lastError.set((err as Error).message);
      this.connectionState.set('error');
      this.consecutiveFailures.update((n) => n + 1);
      this.scheduleReconnect('construct_failed');
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.reconnectStartedAt = null;
      this.consecutiveFailures.set(0);
      this.connectionState.set('open');
      this.lastError.set(null);
      if (this.mode() !== 'live') {
        this.mode.set('live');
      }
    };

    es.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    es.onerror = () => {
      this.lastError.set('Reconectando con mesas…');
      this.connectionState.set('error');
      this.consecutiveFailures.update((n) => n + 1);
      try {
        es.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
      this.scheduleReconnect('onerror');
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    if (event.data.startsWith(':')) return;
    let parsed: AdminTablesEvent;
    try {
      parsed = JSON.parse(event.data) as AdminTablesEvent;
    } catch {
      this.lastError.set('Malformed SSE payload');
      return;
    }
    this.lastEvent.set(parsed);
    this.lastEventAt.set(new Date());
    this.applyEvent(parsed);
  }

  /**
   * Reconciliación de un evento individual contra el map de sesiones.
   *  - `snapshot`     → REEMPLAZA el map completo.
   *  - `item_added`   → UPSERT de la sesión afectada (extrae session_id
   *                     desde `data.session_id` o `data.table_session_id`).
   *  - `comensal_*`   → ajusta `active_devices` (+1/-1).
   *  - `guest_count_changed` → reemplaza `guest_count`.
   *  - `payment.*` / `table_payment_*` → ajusta `payment_state`.
   *  - `bill.requested` / `kitchen.*` → no mutan el estado del map;
   *    sólo disparan `lastEventAt` para que la UI sepa "algo se movió".
   *  - cualquier otro tipo → default-deny (noop).
   */
  private applyEvent(event: AdminTablesEvent): void {
    if (event.type === 'snapshot') {
      this.applySnapshot(event.data);
      return;
    }

    const sessionId = this.extractSessionId(event.data);
    if (sessionId == null) return;

    switch (event.type) {
      case 'item_added': {
        const itemCount = this.extractItemCount(event.data);
        const subtotal = this.extractSubtotal(event.data);
        this.tablesLive.update((m) => {
          const current = m.get(sessionId);
          if (!current) return m;
          const next = new Map(m);
          next.set(sessionId, {
            ...current,
            item_count:
              itemCount != null
                ? itemCount
                : current.item_count + 1,
            subtotal: subtotal ?? current.subtotal,
            updated_at: Date.now(),
          });
          return next;
        });
        return;
      }
      case 'comensal_joined': {
        this.tablesLive.update((m) => {
          const current = m.get(sessionId);
          if (!current) return m;
          const next = new Map(m);
          next.set(sessionId, {
            ...current,
            active_devices: current.active_devices + 1,
            updated_at: Date.now(),
          });
          return next;
        });
        return;
      }
      case 'comensal_left': {
        this.tablesLive.update((m) => {
          const current = m.get(sessionId);
          if (!current) return m;
          const next = new Map(m);
          next.set(sessionId, {
            ...current,
            active_devices: Math.max(0, current.active_devices - 1),
            updated_at: Date.now(),
          });
          return next;
        });
        return;
      }
      case 'guest_count_changed': {
        const guestCount = this.extractGuestCount(event.data);
        this.tablesLive.update((m) => {
          const current = m.get(sessionId);
          if (!current) return m;
          const next = new Map(m);
          next.set(sessionId, {
            ...current,
            guest_count: guestCount,
            updated_at: Date.now(),
          });
          return next;
        });
        return;
      }
      case 'payment.pending':
      case 'table_payment_pending': {
        this.tablesLive.update((m) => {
          const current = m.get(sessionId);
          if (!current) return m;
          const next = new Map(m);
          next.set(sessionId, {
            ...current,
            payment_state: 'pending',
            updated_at: Date.now(),
          });
          return next;
        });
        return;
      }
      case 'payment.confirmed':
      case 'table_payment_confirmed': {
        this.tablesLive.update((m) => {
          const current = m.get(sessionId);
          if (!current) return m;
          const next = new Map(m);
          next.set(sessionId, {
            ...current,
            payment_state: 'confirmed',
            updated_at: Date.now(),
          });
          return next;
        });
        return;
      }
      // Eventos puramente informativos — no mutan el map.
      case 'bill.requested':
      case 'kitchen.fired':
      case 'kitchen.started':
      case 'kitchen.ready':
      case 'kitchen.delivered':
      case 'kitchen.cancelled':
      default:
        return;
    }
  }

  private applySnapshot(payload: AdminTablesSnapshotPayload): void {
    const sessions = payload?.sessions ?? [];
    const next = new Map<number, AdminTablesLivePayload>();
    const now = Date.now();
    for (const s of sessions) {
      if (typeof s?.id !== 'number' || typeof s?.table_id !== 'number') {
        continue;
      }
      next.set(s.id, {
        session_id: s.id,
        table_id: s.table_id,
        order_id: s.order_id,
        guest_count: s.guest_count ?? null,
        active_devices: 0,
        item_count: 0,
        payment_state: 'none',
        subtotal: Number(s.order?.grand_total ?? 0) || 0,
        updated_at: now,
      });
    }
    this.tablesLive.set(next);
    this.hasSnapshot.set(true);
  }

  // ─── helpers ───────────────────────────────────────────────────────

  private extractSessionId(data: Record<string, unknown>): number | null {
    const v =
      data?.['session_id'] ??
      data?.['table_session_id'] ??
      (data?.['session'] as { id?: unknown } | undefined)?.id;
    return typeof v === 'number' ? v : null;
  }

  private extractGuestCount(data: Record<string, unknown>): number | null {
    const v = data?.['guest_count'];
    return typeof v === 'number' ? v : null;
  }

  private extractItemCount(data: Record<string, unknown>): number | null {
    const v = data?.['item_count'] ?? data?.['added'];
    return typeof v === 'number' ? v : null;
  }

  private extractSubtotal(data: Record<string, unknown>): number | null {
    const v =
      data?.['subtotal'] ??
      data?.['subtotal_amount'] ??
      data?.['grand_total'];
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private scheduleReconnect(reason: string): void {
    if (this.destroyed) return;
    if (this.reconnectStartedAt === null) {
      this.reconnectStartedAt = Date.now();
    }
    if (Date.now() - this.reconnectStartedAt >= ADMIN_TABLES_RECONNECT_WINDOW_MS) {
      this.transitionToManual();
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(1_000 * 2 ** (this.reconnectAttempt - 1), 30_000);
    this.lastError.set(`Reconectando en ${Math.round(delay / 1000)}s… (${reason})`);
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource();
    }, delay);
  }

  private transitionToManual(): void {
    if (this.mode() === 'manual') return;
    this.mode.set('manual');
    this.lastError.set(null);
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
  }

  private startPollingInternal(
    intervalMs: number = ADMIN_TABLES_POLLING_INTERVAL_MS,
  ): void {
    if (this.pollingTimer) return;
    void this.pollOnce();
    this.pollingTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  private stopPollingInternal(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      const tables = await firstValueFrom(this.tablesService.getFloorMap());
      if (Array.isArray(tables) && this.mode() === 'manual') {
        // En modo manual sólo necesitamos saber que el backend responde;
        // el floor-page ya está pintando con `tables()` desde su propio
        // service. El último evento timestamp se actualiza para que la
        // UI muestre "Actualizado hace Xs".
        this.lastEventAt.set(new Date());
      }
    } catch {
      // Silencioso: el siguiente tick reintentará.
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