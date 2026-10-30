import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ScheduledOrdersService } from '../scheduled-orders.service';

/**
 * Al cancelarse una orden, su agendamiento se cancela y libera la franja.
 * Si ya estaba en producción, el consumo queda como merma (no se revierte).
 */
@Injectable()
export class ScheduledOrderCancelledListener {
  private readonly logger = new Logger(ScheduledOrderCancelledListener.name);

  constructor(private readonly scheduledOrders: ScheduledOrdersService) {}

  @OnEvent('order.status_changed', { async: true })
  async handle(event: { order_id?: number; new_state?: string }) {
    if (event?.new_state !== 'cancelled' || !event.order_id) return;
    try {
      await this.scheduledOrders.cancelForOrder(event.order_id);
    } catch (error) {
      this.logger.warn(
        `No se pudo cancelar el agendamiento de la orden ${event.order_id}: ${(error as Error).message}`,
      );
    }
  }
}
