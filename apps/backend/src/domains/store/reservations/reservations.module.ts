import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { AvailabilityService } from './availability.service';
import { ScheduleService } from './schedule.service';
import { ReservationsController } from './reservations.controller';
import { ScheduleController } from './schedule.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [ResponseModule, PrismaModule, OrdersModule],
  controllers: [ReservationsController, ScheduleController],
  providers: [ReservationsService, AvailabilityService, ScheduleService],
  exports: [ReservationsService, AvailabilityService],
})
export class ReservationsModule {}
