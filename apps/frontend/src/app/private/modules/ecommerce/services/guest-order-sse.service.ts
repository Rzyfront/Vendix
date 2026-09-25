import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../../../environments/environment';

/**
 * Connection state for the guest order stream. Exposed as a signal so the
 * zoneless guest template can render a "Reconectando…" hint without RxJS.
 */
export type GuestSseConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'error'
  | 'closed';

/** Kitchen lifecycle events emitted by the guest stream (allowlist subset). */
export type GuestKitchenEventType =
  | 'kitchen.fired'
  | 'kitchen.preparing'
  | 'kitchen.ready'
  | 'kitchen.delivered';

/** Live payment row carried by the `snapshot` event (whitelist-projected). */
export interface GuestSsePayment {
  payment_id: number | null;
  state: string;
  has_receipt: boolean;
}

/** Live ETA fields carried by the `snapshot` event. */
export interface GuestSseEta {
  estimated_ready_at: string | null;
  estimated_delivered_at: string | null;
  prep_minutes_max: number | null;
}

/** Loose shape of the SSE payloads (only `type` is guaranteed). */
interface GuestSseEvent {
  type: string;
  [key: string]: unknown;
}

interface GuestSseTicketItem {
  product_name?: unknown;
  quantity?: unknown;
  status?: unknown;
}

/**
 * Backoff schedule: 1s, 2s, 4s, 8s, 16s, capped at 30s. Same visible-backoff
 * approach as `TableSessionSseService` / `KdsSseService`.
 */
const MAX_BACKOFF_MS = 30_000;

/** Kitchen statuses the guest UI understands (5-state KDS vocabulary). */
const KNOWN_KITCHEN_STATUSES = new Set([
  'pending',
  'in_preparation',
  'ready',
  'delivered',
  'cancelled',
]);

/**
 * Fallback status per kitchen event type, used when a ticket item arrives
 * without a usable `status` (the projection usually carries it).
 */
const KITCHEN_EVENT_STATUS: Record<GuestKitchenEventType, string> = {
  'kitchen.fired': 'pending',
  'kitchen.preparing': 'in_preparation',
  'kitchen.ready': 'ready',
  'kitchen.delivered': 'delivered',
};

/**
 * Mapeo defensivo de una fila cruda de pago al shape vivo
 * (`GuestSsePayment`). Compartido por `applySnapshot` y
 * `applyPaymentUpdated`: `null` si no hay `state` usable; `payment_id`
 * sólo cuando es número (`null` en otro caso) y `has_receipt` sólo con
 * `true` estricto. Cada llamador decide qué hacer con un `payment_id`
 * nulo (el snapshot lo conserva, el evento en vivo descarta la fila).
 */
function toGuestPayment(
  raw: Record<string, unknown>,
): GuestSsePayment | null {
  if (typeof raw?.['state'] !== 'string') return null;
  return {
    payment_id:
      typeof raw['payment_id'] === 'number'
        ? (raw['payment_id'] as number)
        : null,
    state: raw['state'] as string,
    has_receipt: raw['has_receipt'] === true,
  };
}

/**
 * Anonymous SSE client for the public guest order page (`/pedido/:token`).
 *
 * Clon de `TableSessionSseService` sin dispositivos ni sesiones: el guest es
 * ANÓNIMO y el token uuid en el path es la única credencial (nunca JWT en
 * query). El servidor re-resuelve el binding `{order_id, store_id}` en CADA
 * conexión desde el token, así que cada reconnect re-valida el vínculo y
 * re-emite un `snapshot` fresco — no hay que "re-resolver" nada en cliente
 * más allá de reabrir el `EventSource`.
 *
 * Seguridad: el token es la capability guest — jamás se loguea (F3). Sin
 * token válido no hay suscripción (`connect` exige token no vacío).
 *
 * Diseño zoneless (`vendix-zoneless-signals`):
 *  - Todo estado vivo es SIGNAL; el componente fusiona estos signals en su
 *    `summary` vía `effect(..., { untracked writes })`. Sin NgZone.
 *  - `EventSource` + timers se limpian en `disconnect()` y `onDestroy`.
 *  - `prefersReducedMotion` expone `prefers-reduced-motion` como signal para
 *    que la vista apague el pulso de "plato actualizado" y cualquier
 *    animación atada a eventos en vivo.
 */
@Injectable({ providedIn: 'root' })
export class GuestOrderSseService {
  private readonly apiUrl = environment.apiUrl;
  private readonly destroyRef = inject(DestroyRef);

  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private currentToken: string | null = null;
  private currentStoreId: number | null = null;
  private destroyed = false;
  private mediaQuery: MediaQueryList | null = null;
  private readonly onMediaChange = (e: MediaQueryListEvent): void => {
    this.prefersReducedMotion.set(e.matches);
  };

  readonly connectionState = signal<GuestSseConnectionState>('idle');
  /** Wall-clock tick of the last parsed event (drives "live" affordances). */
  readonly lastEventAt = signal<number>(0);

  // ── Fused live state (written by events, read by the guest page) ──────
  /** Order `state` from `snapshot` + `order.status_changed`. */
  readonly orderState = signal<string | null>(null);
  /** `delivery_type` from `snapshot` + `order.shipping_assigned`. */
  readonly deliveryType = signal<string | null>(null);
  /** Per-dish kitchen status keyed by `product_name` (immutable writes). */
  readonly kitchenByProduct = signal<Readonly<Record<string, string>>>({});
  /** Payment rows from `snapshot` + `order.payment_updated`. */
  readonly paymentsLive = signal<GuestSsePayment[]>([]);
  /** ETA fields from `snapshot`. */
  readonly eta = signal<GuestSseEta | null>(null);

  /** `prefers-reduced-motion: reduce` as a live signal (default false SSR). */
  readonly prefersReducedMotion = signal<boolean>(false);

  constructor() {
    if (typeof window !== 'undefined' && 'matchMedia' in window) {
      this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.prefersReducedMotion.set(this.mediaQuery.matches);
      this.mediaQuery.addEventListener('change', this.onMediaChange);
    }

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.mediaQuery?.removeEventListener('change', this.onMediaChange);
      this.mediaQuery = null;
      this.disconnect();
    });
  }

  /**
   * Open the stream for `token`. Idempotent while already streaming the same
   * token; switching tokens tears the old stream down first. No-op sin token
   * válido: sin capability no hay suscripción.
   *
   * `storeId` viaja como query param porque `EventSource` NO puede enviar el
   * header `x-store-id` (`DomainResolverMiddleware` lee `req.query.store_id`;
   * sin tienda el stream responde 403 — mismo patrón que mesa).
   */
  connect(token: string, storeId: number | null | undefined): void {
    if (this.destroyed) return;
    if (!token) return;
    if (
      this.currentToken === token &&
      this.eventSource &&
      (this.connectionState() === 'open' ||
        this.connectionState() === 'connecting' ||
        this.connectionState() === 'reconnecting')
    ) {
      return;
    }
    this.teardownSource();
    this.clearReconnectTimer();
    this.currentToken = token;
    this.currentStoreId = typeof storeId === 'number' ? storeId : null;
    this.reconnectAttempt = 0;
    this.openEventSource(token, this.currentStoreId);
  }

  /** Close the stream, cancel reconnects and clear the fused live state. */
  disconnect(): void {
    this.clearReconnectTimer();
    this.teardownSource();
    this.currentToken = null;
    this.currentStoreId = null;
    this.orderState.set(null);
    this.deliveryType.set(null);
    this.kitchenByProduct.set({});
    this.paymentsLive.set([]);
    this.eta.set(null);
    this.lastEventAt.set(0);
    this.connectionState.set('closed');
  }

  // ─── private ─────────────────────────────────────────────────────────

  private openEventSource(token: string, storeId: number | null): void {
    if (this.destroyed) return;
    if (typeof EventSource === 'undefined') {
      this.connectionState.set('error');
      return;
    }

    const query = storeId != null ? `?store_id=${storeId}` : '';
    const url = `${this.apiUrl}/ecommerce/invoice-data/${encodeURIComponent(token)}/stream${query}`;

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
      this.connectionState.set('open');
    };

    es.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    es.onerror = () => {
      // Reconexión propia con backoff visible en vez del retry fijo interno
      // de EventSource. Cada reapertura re-resuelve el binding server-side y
      // re-emite `snapshot`, así que el estado se re-calienta solo.
      this.connectionState.set('error');
      this.teardownSource();
      this.scheduleReconnect();
    };
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') return;
    // Heartbeats (`: heartbeat`) — ignorar.
    if (event.data.startsWith(':')) return;

    let parsed: GuestSseEvent;
    try {
      parsed = JSON.parse(event.data) as GuestSseEvent;
    } catch {
      return;
    }
    if (typeof parsed.type !== 'string' || !parsed.type) return;
    this.lastEventAt.set(Date.now());

    // `parsed` es `Record`-ish: `noPropertyAccessFromIndexSignature`
    // obliga corchetes en todo lo que no sea el `type` declarado.
    switch (parsed.type) {
      case 'snapshot': {
        this.applySnapshot(
          parsed['order'] as Record<string, unknown> | undefined,
        );
        return;
      }

      case 'kitchen.fired':
      case 'kitchen.preparing':
      case 'kitchen.ready':
      case 'kitchen.delivered': {
        this.applyKitchenEvent(
          parsed.type as GuestKitchenEventType,
          parsed['ticket'] as Record<string, unknown> | undefined,
        );
        return;
      }

      case 'order.status_changed': {
        const next = parsed['new_state'];
        if (typeof next === 'string' && next) {
          this.orderState.set(next);
        }
        return;
      }

      case 'order.shipping_assigned': {
        const deliveryType = parsed['delivery_type'];
        if (typeof deliveryType === 'string' && deliveryType) {
          this.deliveryType.set(deliveryType);
        }
        return;
      }

      case 'order.payment_updated': {
        this.applyPaymentUpdated(parsed['payments'] as unknown);
        return;
      }

      case 'link_expired': {
        // Tipo de cierre RESERVADO (dependencia F2 del plan — hoy el token
        // guest no expira, así que nunca se emite). Si algún día llega, el
        // vínculo murió: corte limpio SIN reconnect (reintentar rebotaría el
        // deny en un loop de backoff contra un token muerto).
        this.clearReconnectTimer();
        this.teardownSource();
        this.currentToken = null;
        this.connectionState.set('closed');
        return;
      }

      default:
        // Tipo desconocido — ya quedó el tick en `lastEventAt` para debug.
        return;
    }
  }

  /**
   * Funde el `snapshot` inicial (mismo shape vivo del summary, proyectado
   * con whitelist) en los signals. Llega en cada (re)conexión, así que
   * también es el re-calientamiento tras un corte.
   */
  private applySnapshot(order: Record<string, unknown> | undefined): void {
    if (!order || typeof order !== 'object') return;

    if (typeof order['state'] === 'string' && order['state']) {
      this.orderState.set(order['state'] as string);
    }
    if (
      typeof order['delivery_type'] === 'string' &&
      order['delivery_type']
    ) {
      this.deliveryType.set(order['delivery_type'] as string);
    }

    const eta: GuestSseEta = {
      estimated_ready_at:
        typeof order['estimated_ready_at'] === 'string'
          ? (order['estimated_ready_at'] as string)
          : null,
      estimated_delivered_at:
        typeof order['estimated_delivered_at'] === 'string'
          ? (order['estimated_delivered_at'] as string)
          : null,
      prep_minutes_max:
        typeof order['prep_minutes_max'] === 'number'
          ? (order['prep_minutes_max'] as number)
          : null,
    };
    this.eta.set(eta);

    if (Array.isArray(order['items'])) {
      const next: Record<string, string> = {};
      for (const raw of order['items'] as Array<Record<string, unknown>>) {
        const name = raw?.['product_name'];
        const status = raw?.['kitchen_status'];
        if (
          typeof name === 'string' &&
          name &&
          typeof status === 'string' &&
          KNOWN_KITCHEN_STATUSES.has(status)
        ) {
          next[name] = status;
        }
      }
      this.kitchenByProduct.set(next);
    }

    if (Array.isArray(order['payments'])) {
      const payments: GuestSsePayment[] = [];
      for (const raw of order['payments'] as Array<Record<string, unknown>>) {
        const mapped = toGuestPayment(raw);
        if (mapped) payments.push(mapped);
      }
      this.paymentsLive.set(payments);
    }
  }

  /**
   * Funde un evento `order.payment_updated` en `paymentsLive` por
   * `payment_id` (mismo shape por pago que el snapshot: `payment_id`,
   * `state`, `has_receipt`). Escritura inmutable para que zoneless
   * reaccione; sin cambios no hay `set`.
   */
  private applyPaymentUpdated(rawPayments: unknown): void {
    if (!Array.isArray(rawPayments) || rawPayments.length === 0) return;
    const next: GuestSsePayment[] = this.paymentsLive().map((p) => ({ ...p }));
    let changed = false;
    for (const raw of rawPayments as Array<Record<string, unknown>>) {
      const incoming = toGuestPayment(raw);
      // Sin `payment_id` numérico no hay clave de fusión: se descarta la
      // fila en vez de duplicarla con push (el idx -1 forzado de antes).
      if (!incoming || incoming.payment_id == null) continue;
      const idx = next.findIndex(
        (p) => p.payment_id === incoming.payment_id,
      );
      if (idx < 0) {
        next.push(incoming);
        changed = true;
      } else if (
        next[idx].state !== incoming.state ||
        next[idx].has_receipt !== incoming.has_receipt
      ) {
        next[idx] = incoming;
        changed = true;
      }
    }
    if (changed) {
      this.paymentsLive.set(next);
    }
  }

  /**
   * Funde un evento `kitchen.*` en `kitchenByProduct` por `product_name`
   * (misma fuente que el summary: `products.name`). Cada ítem trae su propio
   * `status`; si falta o no es vocabulario conocido, se usa el estado que
   * implica el tipo de evento. Escritura inmutable para que zoneless
   * reaccione.
   */
  private applyKitchenEvent(
    type: GuestKitchenEventType,
    ticket: Record<string, unknown> | undefined,
  ): void {
    const rawItems = ticket?.['items'];
    if (!Array.isArray(rawItems) || rawItems.length === 0) return;
    const fallback = KITCHEN_EVENT_STATUS[type];
    const next: Record<string, string> = { ...this.kitchenByProduct() };
    let changed = false;
    for (const raw of rawItems as GuestSseTicketItem[]) {
      const name = raw?.product_name;
      if (typeof name !== 'string' || !name) continue;
      const itemStatus = raw?.status;
      const status =
        typeof itemStatus === 'string' &&
        KNOWN_KITCHEN_STATUSES.has(itemStatus)
          ? itemStatus
          : fallback;
      if (next[name] !== status) {
        next[name] = status;
        changed = true;
      }
    }
    if (changed) {
      this.kitchenByProduct.set(next);
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const token = this.currentToken;
    if (!token) return;

    this.reconnectAttempt += 1;
    const delay = Math.min(
      1_000 * 2 ** (this.reconnectAttempt - 1),
      MAX_BACKOFF_MS,
    );
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Reapertura = re-resolución server-side del binding + `snapshot`
      // fresco; el backoff se resetea en `onopen`.
      this.openEventSource(token, this.currentStoreId);
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
