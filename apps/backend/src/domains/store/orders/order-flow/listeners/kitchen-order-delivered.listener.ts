import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OrderFlowService } from '../order-flow.service';

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
 */
@Injectable()
export class KitchenOrderDeliveredListener {
  private readonly logger = new Logger(KitchenOrderDeliveredListener.name);

  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @OnEvent('kitchen.order_all_delivered')
  async handleAllDelivered(
    event: KitchenOrderAllDeliveredEvent,
  ): Promise<void> {
    try {
      await this.storeContextRunner.runInStoreContext(event.storeId, () =>
        this.orderFlowService.markKitchenOrderDelivered(event.orderId),
      );
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
