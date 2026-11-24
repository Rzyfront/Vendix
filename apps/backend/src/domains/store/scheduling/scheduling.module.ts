import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { BookingSchedulingSource } from './sources/booking-scheduling.source';
import { ScheduledOrderSchedulingSource } from './sources/scheduled-order-scheduling.source';
import { BusinessHoursService } from '../reservations/business-hours/business-hours.service';

/**
 * Órdenes → Programación y Agenda (agenda-unificada F1): lectura agregada de
 * reservas de servicio y pedidos programados. No importa los módulos dueños:
 * los adaptadores leen con el Prisma de tienda y reutilizan funciones puras.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [SchedulingController],
  // BusinessHoursService solo depende del Prisma de tienda: el mismo horario
  // maestro que recorta las franjas de reserva recorta la Agenda.
  providers: [
    SchedulingService,
    BookingSchedulingSource,
    ScheduledOrderSchedulingSource,
    BusinessHoursService,
  ],
})
export class SchedulingModule {}
