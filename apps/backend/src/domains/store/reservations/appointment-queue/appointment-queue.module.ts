import { Module } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PrismaModule } from '../../../../prisma/prisma.module';

/**
 * AppointmentQueueModule
 *
 * Owns the AppointmentQueueService (smart queue ranker for the appointment
 * redesign) and exposes it to:
 *   - ReservationsModule (GET /store/reservations/queue, PATCH /:id/check-in)
 *   - NotificationsModule (listener of 'booking.arrival_recorded' which
 *     triggers queue refresh + broadcast)
 *
 * Lives in its own module to avoid a circular dependency between
 * ReservationsModule and NotificationsModule (both need AppointmentQueueService,
 * and NotificationsEventsListener needs both).
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [AppointmentQueueService],
  exports: [AppointmentQueueService],
})
export class AppointmentQueueModule {}
