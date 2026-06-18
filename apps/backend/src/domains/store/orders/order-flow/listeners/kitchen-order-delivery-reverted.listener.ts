import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { OrderFlowService } from '../order-flow.service';

/**
 * Payload emitido por `KitchenFireService.revertTicket` cuando un ticket
 * terminal (delivered/cancelled) se revierte "un paso atrás" desde el KDS.
 * La orden asociada, que pudo haber sido movida a `delivered` por el puente
 * de entrega, debe reabrirse a `processing`.
 */
interface KitchenOrderDeliveryRevertedEvent {
  orderId: number;
  storeId: number;
}

/**
 * Restaurant lifecycle bridge (KDS reversa → order). Espejo de
 * {@link KitchenOrderDeliveredListener}.
 *
 * `KitchenFireService` vive en `KitchenFireModule` y no debe depender del
 * grafo orders/order-flow (introduciría un ciclo entre módulos). Por eso,
 * cuando un ticket terminal se revierte, emite
 * `kitchen.order_delivery_reverted`; este listener — registrado dentro de
 * `OrderFlowModule`, donde ya vive `OrderFlowService` — lo consume y
 * transiciona la orden `delivered -> processing`.
 *
 * El contexto emisor es un request de tienda normal, pero los handlers de
 * eventos corren fuera del AsyncLocalStorage del request, así que
 * reestablecemos el contexto de tienda vía `StoreContextRunner.runInStoreContext`
 * antes de tocar los servicios Prisma scopeados dentro de `OrderFlowService`.
 */
@Injectable()
export class KitchenOrderDeliveryRevertedListener {
  private readonly logger = new Logger(
    KitchenOrderDeliveryRevertedListener.name,
  );

  constructor(
    private readonly orderFlowService: OrderFlowService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @OnEvent('kitchen.order_delivery_reverted')
  async handleDeliveryReverted(
    event: KitchenOrderDeliveryRevertedEvent,
  ): Promise<void> {
    try {
      await this.storeContextRunner.runInStoreContext(event.storeId, () =>
        this.orderFlowService.revertKitchenOrderDelivery(event.orderId),
      );
    } catch (error) {
      // Best-effort: el ticket ya fue revertido; surfaceamos fallos vía logs /
      // monitoreo. revertKitchenOrderDelivery es idempotente, así que un
      // reintento manual es seguro.
      this.logger.error(
        `[kitchen.order_delivery_reverted] Failed to revert order #${event.orderId} (store #${event.storeId}): ${
          (error as Error).message
        }`,
        (error as Error).stack,
      );
    }
  }
}
