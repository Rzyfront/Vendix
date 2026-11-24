import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { ServicePlanTasksService } from './service-plan-tasks.service';

interface BookingEvent {
  store_id: number;
  booking_id: number;
}

/**
 * QUI-1060 F3: único enganche de las tareas del plan. Todas las vías que confirman,
 * cancelan o cambian de fecha una reserva (staff, enlace del cliente, depósitos,
 * reagendar) emiten estos eventos después de su commit; `syncBooking` decide por el
 * estado real y es idempotente. Una falla se registra y nunca tumba la reserva.
 */
@Injectable()
export class ServicePlanTasksListener {
  private readonly logger = new Logger(ServicePlanTasksListener.name);

  constructor(
    private readonly planTasks: ServicePlanTasksService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @OnEvent('booking.confirmed')
  onConfirmed(event: BookingEvent): Promise<void> {
    return this.sync(event, 'booking.confirmed');
  }

  @OnEvent('booking.cancelled')
  onCancelled(event: BookingEvent): Promise<void> {
    return this.sync(event, 'booking.cancelled');
  }

  @OnEvent('booking.rescheduled')
  onRescheduled(event: BookingEvent): Promise<void> {
    return this.sync(event, 'booking.rescheduled');
  }

  private async sync(event: BookingEvent, name: string): Promise<void> {
    if (!event?.store_id || !event?.booking_id) return;
    // Quien confirmó: el usuario del panel que emitió el evento (no un cliente del ecommerce).
    const ctx = RequestContextService.getContext();
    const actorUserId =
      ctx?.user_id && ctx.store_id === event.store_id && ctx.app_type !== 'STORE_ECOMMERCE' ? ctx.user_id : null;
    try {
      await this.storeContextRunner.runInStoreContext(event.store_id, () =>
        this.planTasks.syncBooking(event.booking_id, actorUserId),
      );
    } catch (err: unknown) {
      this.logger.error(
        `Plan tasks of booking ${event.booking_id} not synced after ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
