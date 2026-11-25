import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsExportService } from './reservations-export.service';
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
import { StationAvailabilityController } from './station-availability.controller';
import { ProvidersService } from './providers/providers.service';
import { ProvidersController } from './providers/providers.controller';
import { ProviderScheduleService } from './providers/provider-schedule.service';
import { ProviderAvailabilityService } from './providers/provider-availability.service';
import { AutoNoShowJob } from './jobs/auto-no-show.job';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { BookingChargesService } from './booking-charges.service';
import { S3Module } from '@common/services/s3.module';
import { ProductsModule } from '../products/products.module';
import { TablesModule } from '../tables/tables.module';
import { OrderHistoryModule } from '../orders/order-history/order-history.module';
import { ServiceAllocationModule } from './service-allocation.module';
import { ServiceDepositsModule } from '../service-deposits/service-deposits.module';
import { PaymentRequestsModule } from '../payment-requests/payment-requests.module';
import { ReservationDepositsService } from './reservation-deposits.service';
import { ServiceStationsModule } from '../service-stations/service-stations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServicePlanTasksService } from './service-plans/service-plan-tasks.service';
import { ServicePlanTasksListener } from './service-plans/service-plan-tasks.listener';
import { RentalPrepayService } from './rental-prepay/rental-prepay.service';
import { RentalPrepayPaidListener } from './rental-prepay/rental-prepay-paid.listener';
import { RentalPrepayHoldExpiryJob } from './rental-prepay/rental-prepay-hold-expiry.job';
import { ServiceDepositPaidListener } from './listeners/service-deposit-paid.listener';
import { ServiceDepositHoldExpiryJob } from './jobs/service-deposit-hold-expiry.job';
import { BookingSeriesController } from './recurrence/booking-series.controller';
import { BookingSeriesService } from './recurrence/booking-series.service';
import { ServicePlansController } from './service-plans/service-plans.controller';
import { ServicePlansService } from './service-plans/service-plans.service';

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
    ServiceAllocationModule,
    ServiceDepositsModule,
    PaymentRequestsModule,
    // RentalQuoteService: the rental price of a booking (T15).
    ServiceStationsModule,
    // QUI-1060 F3: recordatorios y aviso de asignación de las tareas del plan.
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    ProvidersController,
    BookingSeriesController,
    ReservationsController,
    StationAvailabilityController,
    BusinessHoursController,
    ServicePlansController,
  ],
  providers: [
    ReservationsService,
    BookingChargesService,
    ReservationsExportService,
    AvailabilityService,
    BookingConfirmationService,
    BusinessHoursService,
    ProvidersService,
    ProviderScheduleService,
    ProviderAvailabilityService,
    AutoNoShowJob,
    ReservationDepositsService,
    BookingSeriesService,
    ServiceDepositPaidListener,
    ServiceDepositHoldExpiryJob,
    RentalPrepayService,
    RentalPrepayPaidListener,
    RentalPrepayHoldExpiryJob,
    ServicePlansService,
    ServicePlanTasksService,
    ServicePlanTasksListener,
  ],
  exports: [
    ReservationsService,
    ReservationDepositsService,
    RentalPrepayService,
    // Re-exported so the ecommerce checkout (imports this module) can inject RentalQuoteService.
    ServiceStationsModule,
    AvailabilityService,
    BookingConfirmationService,
    BusinessHoursService,
    ProvidersService,
    ProviderAvailabilityService,
    ServicePlansService,
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
