import {
  effect,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { environment } from '../../../../../../environments/environment';

/**
 * Tipos de evento del SSE de detalle de orden. Coinciden con el kind
 * discriminator del backend `OrderSseService.pushOrderEvent`.
 */
export type OrderDetailEventKind =
  | 'order.created'
  | 'order.items.updated'
  | 'order.status_changed'
  | 'order.shipping_assigned';

export interface OrderDetailEvent {
  id: number;
  kind: OrderDetailEventKind;
  order_id: number;
  /** ISO timestamp del backend. */
  occurred_at: string;
  /** Payload crudo por si la UI necesita desglose (new_state, etc.). */
  raw: unknown;
}

export type OrderDetailConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/**
 * Backoff 1s -> 30s. Sin polling fallback (a diferencia del KDS): si el
 * SSE se cae, el detalle sigue mostrando los datos que cargo via REST.
 * El usuario puede refrescar manualmente o navegar fuera y volver.
 */
const BACKOFF_INITIAL_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/**
 * Carril B - B3: cliente SSE para el detalle de orden. Replica el patron
 * de KdsSseService (EventSource manual con backoff, no auto-reconnect del
 * browser) pero:
 *  - Filtra por `payload.data.order_id` porque el hub del backend es por
 *    `store_id` (compartido con notifications y otros consumidores).
 *  - No tiene snapshot inicial: el detalle ya cargo la orden via
 *    GET /store/orders/:id antes de abrir el stream; aqui solo entran
 *    cambios en vivo.
 *  - No tiene modo manual / polling: el fallback del KDS existe porque
 *    el board necesita datos frescos siempre; aqui el detalle es
 *    tolerante a quedarse sin updates (el usuario puede refrescar).
 *
 * Consumo tipico en el page:
 *   const sse = inject(OrderDetailSseService);
 *   effect(() => {
 *     const evt = sse.lastRelevantEvent();
 *     if (evt) ordersFacade.refresh();
 *   });
 *   sse.connect(orderId);
 */
@Injectable({ providedIn: 'root' })
export class OrderDetailSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly basePath = '/store/orders/stream';

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private currentOrderId: number | null = null;
  private destroyed = false;

  readonly connectionState = signal<OrderDetailConnectionState>('idle');
  readonly lastRelevantEvent = signal<OrderDetailEvent | null>(null);
  /** Ultimo evento que vio el stream, sea relevante o no (debug/UI). */
  readonly lastEvent = signal<OrderDetailEvent | null>(null);

  constructor() {
    // Si el servicio es destruido (cambio de ruta), cerramos la conexion.
    // providedIn:'root' rara vez se destruye, pero defendemos igual.
    effect(() => {
      // No leemos nada del effect; solo queremos registrar la limpieza
      // cuando `destroyed` pase a true (manejado por ngOnDestroy abajo).
      untracked(() => undefined);
    });
  }

  /**
   * Abre el SSE para el detalle de una orden. Idempotente: si ya esta
   * abierto para el mismo `orderId`, no-op; si es otro `orderId`,
   * reconecta con el nuevo filtro.
   */
  connect(orderId: number): void {
    if (this.destroyed) return;
    if (this.currentOrderId === orderId && this.eventSource) {
      // Ya estamos conectados a esta orden.
      if (
        this.connectionState() === 'open' ||
        this.connectionState() === 'connecting'
      ) {
        return;
      }
    }
    this.disconnect();
    this.currentOrderId = orderId;
    this.openEventSource();
  }

  disconnect(): void {
    this.clearReconnectTimer();
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('closed');
    this.currentOrderId = null;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.disconnect();
  }

  // === internals =========================================================

  private openEventSource(): void {
    if (this.currentOrderId == null) return;
    const token = this.readAuthToken();
    if (!token) {
      // Sin token no abrimos; el page deberia pedir login antes. Cerramos
      // silenciosamente para no spamear intentos.
      this.connectionState.set('idle');
      return;
    }
    this.connectionState.set('connecting');
    const url = `${this.apiUrl}${this.basePath}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
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
    let payload: {
      id?: number;
      type?: string;
      data?: { order_id?: number; kind?: OrderDetailEventKind } & Record<
        string,
        unknown
      >;
      created_at?: string;
    } | null = null;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return; // payload binario o mal formado — ignoramos
    }
    if (!payload || !payload.data || typeof payload.data !== 'object') return;

    const orderId = payload.data.order_id;
    const kind = payload.data.kind;
    if (typeof orderId !== 'number' || !kind) return;

    const evt: OrderDetailEvent = {
      id: payload.id ?? 0,
      kind,
      order_id: orderId,
      occurred_at: payload.created_at ?? new Date().toISOString(),
      raw: payload.data,
    };
    this.lastEvent.set(evt);

    // Filtro por la orden que esta mirando el detalle. El hub del backend
    // es por store_id y trae TODAS las ordenes del store; solo nos
    // importan las de `currentOrderId`.
    if (this.currentOrderId != null && orderId === this.currentOrderId) {
      this.lastRelevantEvent.set(evt);
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.currentOrderId == null) {
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
