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
 * Solo nos importan los eventos `order.status_changed`. El subject compartido
 * emite muchos otros tipos (`ticket.*`, notificaciones, etc.) — esta vista
 * los ignora.
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
 * Replica el patrón de `OrderDetailSseService` (EventSource manual con
 * backoff, no auto-reconnect del browser) pero:
 *  - NO filtra por un orderId específico: la lista ve TODAS las
 *    `order.status_changed` de la tienda.
 *  - El componente consumidor reconcilia con un signal upsert:
 *    `orders.update(prev => prev.map(o => o.id === evt.data.order_id
 *      ? { ...o, state: evt.data.new_state } : o))`.
 *  - El servicio solo expone `lastRelevantEvent` (signal); el componente
 *    decide si la fila está en su página actual antes de aplicar el upsert
 *    (si la orden no está en `orders()`, el evento se ignora silencioso).
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
  private destroyed = false;

  readonly connectionState = signal<OrdersListConnectionState>('idle');
  /**
   * Último evento `order.status_changed` que vio el stream. Null cuando
   * no hay eventos. El componente limpia el signal a `null` después de
   * aplicarlo para que el effect corra de nuevo en el próximo cambio.
   */
  readonly lastRelevantEvent = signal<OrderListStateChangedEvent | null>(null);
  /** Último evento que vio el stream, sea relevante o no (debug/UI). */
  readonly lastEvent = signal<OrderListStateChangedEvent | null>(null);

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
      data?: OrderListStateChangedEvent['data'];
      created_at?: string;
    } | null = null;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return; // payload binario o mal formado — ignoramos
    }
    if (!payload || !payload.data || typeof payload.data !== 'object') return;

    // La lista SOLO se interesa en `order.status_changed`. Otros eventos
    // del subject compartido (notificaciones, ticket.*, order.created,
    // order.items.updated, etc.) los descartamos sin procesarlos.
    if (payload.type !== 'order.status_changed') return;
    if (payload.data.kind !== 'order.status_changed') return;
    if (typeof payload.data.order_id !== 'number') return;

    // Validación runtime del new_state: si el backend pushea un estado que
    // ya no existe (typo, refactor, versión vieja del cliente), descartamos
    // el evento silencioso. El upsert downstream nunca ve un valor fuera
    // del union `OrderState` — sin necesidad de cast en el componente.
    if (
      typeof payload.data.new_state !== 'string' ||
      !ORDER_STATES.has(payload.data.new_state)
    ) {
      return;
    }

    const evt: OrderListStateChangedEvent = {
      id: payload.id ?? 0,
      type: 'order.status_changed',
      occurred_at: payload.created_at ?? new Date().toISOString(),
      data: payload.data as OrderListStateChangedEvent['data'],
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
