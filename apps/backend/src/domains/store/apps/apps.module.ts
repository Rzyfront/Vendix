import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { ProductPageAppController } from './product-page/product-page-app.controller';
import { ProductPageAppService } from './product-page/product-page-app.service';
import { ProductPagePublicController } from './product-page/product-page-public.controller';
import { ServicePageAppController } from './service-page/service-page-app.controller';
import { ServicePageAppService } from './service-page/service-page-app.service';
import { ServicePagePublicController } from './service-page/service-page-public.controller';
import { AppDomainService } from './shared/app-domain.service';
import { LodgingReservationsModule } from '../hospitality/reservations/reservations.module';
import { BookingAppController } from './booking/booking-app.controller';
import { BookingAppService } from './booking/booking-app.service';
import { BookingCheckinService } from './booking/booking-checkin.service';
import { BookingPublicController } from './booking/booking-public.controller';

/** Apps — catálogo de aplicaciones web por tienda (odd/tasks/apps-module.md). */
@Module({
  // Booking (Fase 4) opens the PMS online check-in link to the guest.
  imports: [ResponseModule, PrismaModule, LodgingReservationsModule],
  controllers: [
    ProductPageAppController,
    ProductPagePublicController,
    ServicePageAppController,
    ServicePagePublicController,
    BookingAppController,
    BookingPublicController,
    AppsController,
  ],
  providers: [
    AppsService,
    AppDomainService,
    ProductPageAppService,
    ServicePageAppService,
    BookingAppService,
    BookingCheckinService,
  ],
  exports: [AppsService],
})
export class AppsModule {}
