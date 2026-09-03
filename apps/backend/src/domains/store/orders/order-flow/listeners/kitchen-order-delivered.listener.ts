import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OrderFlowService } from '../order-flow.service';
import { OrderSseService } from '../../services/order-sse.service';

/**
 * Payload emitted by `KitchenFireService.markDelivered` once every kitchen
 * ticket of an order is in a terminal state (delivered/cancelled) and at
 * least one was delivered.
 */
interface KitchenOrderAllDeliveredEvent {
  orderId: number;
  storeId: number;
}

/**
 * Restaurant lifecycle bridge (KDS → order).
 *
 * `KitchenFireService` lives in `KitchenFireModule` and must not depend on the
 * orders/order-flow graph (that would introduce a cross-module dependency
 * cycle). Instead, when the kitchen finishes an order it emits
 * `kitchen.order_all_delivered`; this listener — registered inside
 * `OrderFlowModule`, where `OrderFlowService` already lives — consumes it and
 * transitions the order `processing -> delivered`.
 *
 * The emitting context is a normal store request, but event handlers run
 * outside the request's AsyncLocalStorage, so we re-establish the store tenant
 * context via `StoreContextRunner.runInStoreContext` before touching the
 * scoped Prisma services inside `OrderFlowService`.
 *
 * Tras el commit de la transición, emite un `order.status_changed` por SSE al
 * subject compartido por tienda. Esto refresca `/admin/orders/sales` sin F5.
 * El listener es el boundary correcto para "publicar al mundo exterior":
 * `OrderFlowService.updateOrderState` ya emite `order.status_changed` por
 * EventEmitter2 in-process — sacarlo al SSE desde el service provocaría
 * spam (cualquier cambio de estado, no solo KDS).
 *
 * Usamos `OrderSseService.pushOrderEvent` (no `NotificationsSseService.push`
 * directo) porque envuelve el payload en el shape `SseNotificationPayload`
 * canónico (`{id, type, title, body, data: {order_id, kind, ...}, created_at}`)
 * que ya consumen tanto `OrderDetailSseService` (frontend) como el controller
 * `@Sse('orders/stream')`. Emitir shape crudo obligaría a reescribir el
 * filtro del cliente y romper la consistencia entre emisores.
 *
 * La emisión SOLO ocurre si `markKitchenOrderDelivered` realmente transicionó
 * la orden (chequeo `updated?.state === 'delivered'`). El service es
 * idempotente: si la orden no estaba en `processing`, devuelve la fila tal
 * cual y NO se publica nada — evita ruido para órdenes ya finalizadas o
 * auto-finalizadas por el job de 4h.
 */
@Injectable()
export class KitchenOrderDeliveredListener {
  private readonly logger = new Logger(KitchenOrderDeliveredListener.name);

  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly storeContextRunner: StoreContextRunner,
    private readonly orderSseService: OrderSseService,
  ) {}

  @OnEvent('kitchen.order_all_delivered')
  async handleAllDelivered(
    event: KitchenOrderAllDeliveredEvent,
  ): Promise<void> {
    try {
      const updated = await this.storeContextRunner.runInStoreContext(
        event.storeId,
        () => this.orderFlowService.markKitchenOrderDelivered(event.orderId),
      );

      // Solo emitir si la transición realmente ocurrió. Idempotencia: el
      // service es no-op si la orden no estaba en `processing`, así que
      // evita spam para órdenes ya finalizadas / auto-finalizadas.
      if (updated?.state === 'delivered') {
        const orderNumber =
          (updated as { order_number?: string }).order_number ?? '';
        this.orderSseService.pushOrderEvent(
          event.storeId,
          event.orderId,
          'order.status_changed',
          {
            old_state: 'processing',
            new_state: 'delivered',
            order_number: orderNumber,
          },
        );
      }
    } catch (error) {
      // Best-effort bridge: the tickets are already delivered; surface failures
      // via logs / monitoring. The 4h auto-finish job is the safety net.
      this.logger.error(
        `[kitchen.order_all_delivered] Failed to deliver order #${event.orderId} (store #${event.storeId}): ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );
    }
  }
}
