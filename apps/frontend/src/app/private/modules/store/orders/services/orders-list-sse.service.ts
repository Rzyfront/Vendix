import { Injectable, signal } from '@angular/core';
import { environment } from '../../../../../../environments/environment';
import { OrderState } from '../interfaces/order.interface';

/**
 * Set exhaustivo de estados de orden (mirror literal de `OrderState`).
 * Se reescribe acá para validar runtime que el valor que llega del SSE
 * pertenece al union — si el backend pushea un estado que ya no existe
 * (refactor, typo), descartamos el evento silencioso. El upsert del
 * componente downstream nunca ve strings ajenos al contrato.
 */
const ORDER_STATES: ReadonlySet<string> = new Set<string>([
  'draft',
  'created',
  'pending_payment',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
  'finished',
  'pending_delivery',
]);

/**
 * QUI-777: payload canónico que el backend publica al SSE compartido por
 * tienda para refrescar la lista de Órdenes de Venta sin F5. Mismo shape
 * que consume `OrderDetailSseService` (envuelto por `OrderSseService.pushOrderEvent`).
 *
 * Esta vista consume cambios de estado/creación y emite señales de hidratación
 * para tickets KDS y cambios de ítems. Otros tipos del subject se ignoran.
 */
export interface OrderListStateChangedEvent {
  /** ID incremental monotónico del backend (vía `OrderSseService.seq`). */
  id: number;
  type: 'order.status_changed';
  /** ISO timestamp del backend. */
  occurred_at: string;
  data: {
    order_id: number;
    kind: 'order.status_changed';
    old_state: string;
    new_state: OrderState;
    order_number?: string;
  };
}

/**
 * CP-orders-sales-sse-realtime: payload de orden nueva. El backend solo
 * envia identificadores y totales (ver `OrdersService.onOrderCreated`); la
 * fila completa se hidrata por REST en el componente para reutilizar la
 * normalizacion de `loadOrders` (mesa, customer_name, numeros).
 */
export interface OrderListCreatedEvent {
  /** ID incremental monotónico del backend (vía `OrderSseService.seq`). */
  id: number;
  type: 'order.created';
  /** ISO timestamp del backend. */
  occurred_at: string;
  data: {
    order_id: number;
    kind: 'order.created';
    order_number?: string;
    grand_total?: number;
    currency?: string;
  };
}

export interface OrderListHydrationEvent {
  id: number;
  type: string;
  order_id: number;
}

const KITCHEN_TICKET_EVENTS: ReadonlySet<string> = new Set([
  'ticket.created', 'ticket.started', 'ticket.ready', 'ticket.updated',
  'ticket.delivered', 'ticket.cancelled', 'ticket.reverted',
]);

function isOrderId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export type OrdersListConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/**
 * Backoff 1s -> 30s. Sin polling fallback (a diferencia del KDS): si el
 * SSE se cae, la lista sigue mostrando los datos que cargó via REST. El
 * usuario puede refrescar manualmente o navegar fuera y volver. Es la misma
 * política que `OrderDetailSseService` — el detalle es tolerante a
 * quedarse sin updates en vivo, y la lista hereda esa tolerancia.
 */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/**
 * QUI-777: cliente SSE para la LISTA de Órdenes de Venta. Refresca la fila
 * correspondiente sin F5 cuando el KDS marca todos los tickets de una orden
 * como delivered (o revierte uno).
 *
 * CP-orders-sales-sse-realtime: además expone `order.created` para que la
 * lista inserte la orden nueva sin F5.
 *
 * Replica el patrón de `OrderDetailSseService` (EventSource manual con
 * backoff, no auto-reconnect del browser) pero:
 *  - NO filtra por un orderId específico: la lista recibe los eventos de la
 *    tienda y el componente limita la hidratación a filas visibles.
 *  - El componente consumidor reconcilia con un signal upsert:
 *    `orders.update(prev => prev.map(o => o.id === evt.data.order_id
 *      ? { ...o, state: evt.data.new_state } : o))`.
 *  - El servicio expone `lastRelevantEvent` (status), `lastCreatedEvent`
 *    (creadas) y una cola de eventos de hidratación; el componente decide si la fila está en su página actual
 *    antes de aplicar el upsert (si la orden no está en `orders()`, el
 *    evento de estado se ignora silencioso).
 *  - Idempotencia: el upsert siempre overwrite. Si llega el mismo evento
 *    dos veces (re-conexión SSE), el resultado es el mismo `state`.
 *
 * Endpoint consumido: `GET /store/orders/stream` (mismo que
 * `OrderDetailSseService`, mismo subject compartido por tienda en
 * `NotificationsSseService`).
 */
@Injectable({ providedIn: 'root' })
export class OrdersListSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/orders/stream';

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private hasOpened = false;
  private recoveryPending = false;
  private destroyed = false;

  readonly connectionState = signal<OrdersListConnectionState>('idle');
  /**
   * Último evento `order.status_changed` que vio el stream. Null cuando
   * no hay eventos. El componente limpia el signal a `null` después de
   * aplicarlo para que el effect corra de nuevo en el próximo cambio.
   */
  readonly lastRelevantEvent = signal<OrderListStateChangedEvent | null>(null);
  /**
   * Último evento `order.created` que vio el stream. El componente lo
   * hidrata por REST y lo limpia a `null` igual que `lastRelevantEvent`.
   */
  readonly lastCreatedEvent = signal<OrderListCreatedEvent | null>(null);
  readonly hydrationEvents = signal<readonly OrderListHydrationEvent[]>([]);
  readonly recoveredConnection = signal(0);
  /** Último evento que vio el stream, sea relevante o no (debug/UI). */
  readonly lastEvent = signal<
    OrderListStateChangedEvent | OrderListCreatedEvent | OrderListHydrationEvent | null
  >(null);

  /**
   * Abre el SSE para la lista. Idempotente: si ya está abierto, no-op.
   * Si está reconectando, deja el ciclo correr.
   */
  connect(): void {
    if (this.destroyed) return;
    if (
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting')
    ) {
      return;
    }
    this.disconnect();
    this.openEventSource();
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.recoveryPending = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // === internals =========================================================

  private openEventSource(): void {
    const token = this.readAuthToken();
    if (!token) {
      // Sin token no abrimos; el page debería pedir login antes. Cerramos
      // silenciosamente para no spamear intentos.
      this.connectionState.set('idle');
      return;
    }
    this.connectionState.set('connecting');
    const url = `${this.apiUrl}${this.basePath}?token=${encodeURIComponent(token)}`;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      // No podemos abrir (modo browser restringido, etc.) — cerramos.
      this.connectionState.set('closed');
      return;
    }
    this.eventSource = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.connectionState.set('open');
      if (this.recoveryPending) this.recoveredConnection.update((n) => n + 1);
      this.recoveryPending = false;
      this.hasOpened = true;
    };

    es.onmessage = (ev) => {
      this.handleMessage(ev.data);
    };

    es.onerror = () => {
      // El browser intenta auto-reconectar, pero a delay fijo y sin
      // visibilidad. Cerramos y manejamos nosotros con backoff.
      try {
        es.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
      this.recoveryPending = this.hasOpened;
      this.scheduleReconnect();
    };
  }

  private handleMessage(rawData: string | null): void {
    if (!rawData) return;
    // SSE comment lines (heartbeats) start with ":" — ignoramos.
    if (rawData.startsWith(':')) return;
    let payload: {
      id?: number;
      type?: string;
      data?: Record<string, unknown>;
      ticket?: { order_id?: unknown };
      created_at?: string;
    } | null = null;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return; // payload binario o mal formado — ignoramos
    }
    if (!payload) return;

    if (typeof payload.type === 'string' && KITCHEN_TICKET_EVENTS.has(payload.type)) {
      const ticket = (payload as any).ticket;
      if (!ticket || !isOrderId(ticket.order_id)) return;
      const evt: OrderListHydrationEvent = {
        id: isOrderId(payload.id) ? payload.id : 0,
        type: payload.type,
        order_id: ticket.order_id,
      };
      this.lastEvent.set(evt);
      this.hydrationEvents.update((events) => [...events, evt]);
      return;
    }

    if (!payload.data || typeof payload.data !== 'object') return;
    const orderId = payload.data['order_id'];
    if (!isOrderId(orderId)) return;

    if (payload.type === 'order.items.updated') {
      const evt: OrderListHydrationEvent = {
        id: isOrderId(payload.id) ? payload.id : 0,
        type: payload.type,
        order_id: orderId,
      };
      this.lastEvent.set(evt);
      this.hydrationEvents.update((events) => [...events, evt]);
      return;
    }

    // CP-orders-sales-sse-realtime: keep create/status handling independent;
    // kitchen and item events are emitted through the hydration queue above.
    if (
      payload.type === 'order.created' &&
      payload.data['kind'] === 'order.created'
    ) {
      const evt: OrderListCreatedEvent = {
        id: payload.id ?? 0,
        type: 'order.created',
        occurred_at: payload.created_at ?? new Date().toISOString(),
        data: {
          order_id: payload.data['order_id'] as number,
          kind: 'order.created',
          ...(typeof payload.data['order_number'] === 'string'
            ? { order_number: payload.data['order_number'] }
            : {}),
          ...(typeof payload.data['grand_total'] === 'number'
            ? { grand_total: payload.data['grand_total'] }
            : {}),
          ...(typeof payload.data['currency'] === 'string'
            ? { currency: payload.data['currency'] }
            : {}),
        },
      };
      this.lastEvent.set(evt);
      this.lastCreatedEvent.set(evt);
      return;
    }

    if (payload.type !== 'order.status_changed') return;
    if (payload.data['kind'] !== 'order.status_changed') return;

    // Validación runtime del new_state: si el backend pushea un estado que
    // ya no existe (typo, refactor, versión vieja del cliente), descartamos
    // el evento silencioso. El upsert downstream nunca ve un valor fuera
    // del union `OrderState` — sin necesidad de cast en el componente.
    if (
      typeof payload.data['new_state'] !== 'string' ||
      !ORDER_STATES.has(payload.data['new_state'])
    ) {
      return;
    }

    const evt: OrderListStateChangedEvent = {
      id: payload.id ?? 0,
      type: 'order.status_changed',
      occurred_at: payload.created_at ?? new Date().toISOString(),
      data: {
        order_id: payload.data['order_id'] as number,
        kind: 'order.status_changed',
        old_state:
          typeof payload.data['old_state'] === 'string'
            ? payload.data['old_state']
            : '',
        new_state: payload.data['new_state'] as OrderState,
        ...(typeof payload.data['order_number'] === 'string'
          ? { order_number: payload.data['order_number'] }
          : {}),
      },
    };
    this.lastEvent.set(evt);
    this.lastRelevantEvent.set(evt);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) {
      this.connectionState.set('closed');
      return;
    }
    this.connectionState.set('reconnecting');
    this.reconnectAttempt += 1;
    const delay = Math.min(
      BACKOFF_INITIAL_MS * Math.pow(2, this.reconnectAttempt - 1),
      BACKOFF_MAX_MS,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openEventSource();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Lee el JWT de auth_state para adjuntarlo como `?token=`. EventSource
   * no puede setear Authorization header.
   */
  private readAuthToken(): string | null {
    if (typeof localStorage === 'undefined') return null;
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
