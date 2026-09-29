import { Module, OnModuleInit } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { AvailabilityService } from './availability.service';
// Vexi tool family owned by this domain (O-46..O-52). AIToolRegistry comes
// from the @Global() AIEngineModule, so it is injectable WITHOUT importing
// that module here — importing it would risk a DI cycle.
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createReservationsTools } from '../../../ai-engine/tools/domains/reservations.tools';
import { BookingConfirmationService } from './booking-confirmation.service';
import { AppointmentQueueModule } from './appointment-queue/appointment-queue.module';
import { BusinessHoursService } from './business-hours/business-hours.service';
import { BusinessHoursController } from './business-hours/business-hours.controller';
import { ReservationsController } from './reservations.controller';
import { ProvidersService } from './providers/providers.service';
import { ProvidersController } from './providers/providers.controller';
import { ProviderScheduleService } from './providers/provider-schedule.service';
import { ProviderAvailabilityService } from './providers/provider-availability.service';
import { AutoNoShowJob } from './jobs/auto-no-show.job';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { S3Module } from '@common/services/s3.module';
import { ProductsModule } from '../products/products.module';
import { TablesModule } from '../tables/tables.module';
import { OrderHistoryModule } from '../orders/order-history/order-history.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    OrdersModule,
    S3Module,
    ProductsModule,
    TablesModule,
    AppointmentQueueModule,
    OrderHistoryModule,
  ],
  controllers: [
    ProvidersController,
    ReservationsController,
    BusinessHoursController,
  ],
  providers: [
    ReservationsService,
    AvailabilityService,
    BookingConfirmationService,
    BusinessHoursService,
    ProvidersService,
    ProviderScheduleService,
    ProviderAvailabilityService,
    AutoNoShowJob,
  ],
  exports: [
    ReservationsService,
    AvailabilityService,
    BookingConfirmationService,
    BusinessHoursService,
    ProvidersService,
    ProviderAvailabilityService,
  ],
})
export class ReservationsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly reservationsService: ReservationsService,
    private readonly availabilityService: AvailabilityService,
    // Dueños de proveedores/horarios/excepciones (O-52) y del calendario
    // maestro (O-52). Providers locales de este módulo: cero imports nuevos.
    private readonly providersService: ProvidersService,
    private readonly providerScheduleService: ProviderScheduleService,
    private readonly businessHoursService: BusinessHoursService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createReservationsTools({
        reservationsService: this.reservationsService,
        availabilityService: this.availabilityService,
        providersService: this.providersService,
        providerScheduleService: this.providerScheduleService,
        businessHoursService: this.businessHoursService,
      }),
    );
  }
}
