import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { AvailabilityService } from './availability.service';
import { BookingConfirmationService } from './booking-confirmation.service';
import { AppointmentQueueService } from './appointment-queue.service';
import { ReservationsController } from './reservations.controller';
import { ProvidersService } from './providers/providers.service';
import { ProvidersController } from './providers/providers.controller';
import { ProviderScheduleService } from './providers/provider-schedule.service';
import { ProviderAvailabilityService } from './providers/provider-availability.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { S3Module } from '@common/services/s3.module';
import { ProductsModule } from '../products/products.module';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [ResponseModule, PrismaModule, OrdersModule, S3Module, ProductsModule, TablesModule],
  controllers: [ProvidersController, ReservationsController],
  providers: [
    ReservationsService,
    AvailabilityService,
    BookingConfirmationService,
    AppointmentQueueService,
    ProvidersService,
    ProviderScheduleService,
    ProviderAvailabilityService,
  ],
  exports: [
    ReservationsService,
    AvailabilityService,
    BookingConfirmationService,
    AppointmentQueueService,
    ProvidersService,
    ProviderAvailabilityService,
  ],
})
export class ReservationsModule {}
