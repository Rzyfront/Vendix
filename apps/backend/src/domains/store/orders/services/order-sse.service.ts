import { Injectable, Logger } from '@nestjs/common';
import { NotificationsSseService } from '../../notifications/notifications-sse.service';
import { SseNotificationPayload } from '../../notifications/interfaces/notification-events.interface';

/**
 * Carril B - B3: hub tipado para empujar eventos del dominio `orders` al SSE
 * compartido por tienda (`NotificationsSseService`).
 *
 * El hub es broadcast por `store_id`; el cliente del detalle de orden
 * (`order-detail-sse.service.ts` en frontend) discrimina por
 * `data.order_id`. NO discriminamos en backend porque el subject es
 * compartido con notificaciones y otros consumidores que quieren ver el
 * broadcast.
 *
 * Eventos que esta clase empuja hoy (alineados con los que ya emite
 * `OrdersService` por `EventEmitter2`):
 *   - `order.created`         — tambien lo emite `payments.service.ts:1413`
 *   - `order.items.updated`   — emitido directo por `updateOrderFromEditor`
 *   - `order.status_changed`  — emitido por `notifications-events.listener`
 *   - `order.shipping_assigned` — emitido por `OrdersService:3094`
 *
 * Eventos futuros (encargados a otros carriles, no se agregan aquí):
 *   - `order.paid`            — vivirá en `payments.service.ts` (carril lina)
 *   - `data.order_id` dentro del payload de mesa — vivirá en `tables.service.ts`
 *     (carril lina). El SSE actual se diseña para tolerar que NO lleguen.
 */
export type OrderSseKind =
  | 'order.created'
  | 'order.items.updated'
  | 'order.status_changed'
  | 'order.shipping_assigned';

@Injectable()
export class OrderSseService {
  private readonly logger = new Logger(OrderSseService.name);
  // `SseNotificationPayload.id` exige un numero monotónico por proceso.
  // No se persiste ni se coordina con otras fuentes — solo evita colisiones
  // dentro del stream. Empezamos arriba de 0 para distinguir de payloads
  // legacy si los hubiera.
  private seq = 0;

  constructor(private readonly sse: NotificationsSseService) {}

  /**
   * Empuja un evento del dominio `orders` al bus SSE del store.
   * Si nadie esta suscrito, `NotificationsSseService.push` es no-op
   * (no crashea, no acumula). Emitir a un canal vacio es inofensivo.
   */
  pushOrderEvent(
    store_id: number,
    order_id: number,
    kind: OrderSseKind,
    extra: Record<string, unknown> = {},
  ): void {
    if (!store_id || !order_id) {
      // El subject se indexa por store_id; emitir con store_id=0
      // contaminaria un canal ajeno o se perderia. Cortamos antes.
      return;
    }
    const payload: SseNotificationPayload = {
      id: ++this.seq,
      type: kind,
      title: kind,
      body: kind,
      data: { order_id, kind, ...extra },
      created_at: new Date().toISOString(),
    };
    this.sse.push(store_id, payload);
  }
}
