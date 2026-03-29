import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { AvailabilityService } from './availability.service';
import { ReservationsController } from './reservations.controller';
import { ProvidersService } from './providers/providers.service';
import { ProvidersController } from './providers/providers.controller';
import { ProviderScheduleService } from './providers/provider-schedule.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [ResponseModule, PrismaModule, OrdersModule],
  controllers: [ProvidersController, ReservationsController],
  providers: [ReservationsService, AvailabilityService, ProvidersService, ProviderScheduleService],
  exports: [ReservationsService, AvailabilityService, ProvidersService],
})
export class ReservationsModule {}
