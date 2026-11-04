import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { ProductPageAppController } from './product-page/product-page-app.controller';
import { ProductPageAppService } from './product-page/product-page-app.service';
import { ProductPagePublicController } from './product-page/product-page-public.controller';
import { ServicePageAppController } from './service-page/service-page-app.controller';
import { ServicePageAppService } from './service-page/service-page-app.service';
import { ServicePagePublicController } from './service-page/service-page-public.controller';
import { AppDomainService } from './shared/app-domain.service';
import { AppPageService } from './shared/app-page.service';
import { LodgingReservationsModule } from '../hospitality/reservations/reservations.module';
import { BookingAppController } from './booking/booking-app.controller';
import { BookingAppService } from './booking/booking-app.service';
import { BookingCheckinService } from './booking/booking-checkin.service';
import { BookingPublicController } from './booking/booking-public.controller';
import { StoreHomeAppController } from './store-home/store-home-app.controller';
import { StoreHomeAppService } from './store-home/store-home-app.service';
import { StoreHomePublicController } from './store-home/store-home-public.controller';
import { CrmModule } from '../crm/crm.module';
import { StoreBootstrapHelper } from '@common/helpers/store-bootstrap.helper';
import { LandingPageAppController } from './landing/landing-page-app.controller';
import { LandingPageAppService } from './landing/landing-page-app.service';
import { LandingPagePublicController } from './landing/landing-page-public.controller';
import { LandingLeadService } from './landing/landing-lead.service';

/** Apps — catálogo de aplicaciones web por tienda (odd/tasks/apps-module.md). */
@Module({
  // Booking (Fase 4) opens the PMS online check-in link to the guest; the
  // store home (Fase 5) signs the brand logo; the landing page (Fase 6)
  // reuses the CRM contact flow for its leads.
  imports: [
    ResponseModule,
    PrismaModule,
    LodgingReservationsModule,
    S3Module,
    CrmModule,
  ],
  controllers: [
    ProductPageAppController,
    ProductPagePublicController,
    ServicePageAppController,
    ServicePagePublicController,
    BookingAppController,
    BookingPublicController,
    StoreHomeAppController,
    StoreHomePublicController,
    LandingPageAppController,
    LandingPagePublicController,
    AppsController,
  ],
  providers: [
    AppsService,
    AppDomainService,
    AppPageService,
    ProductPageAppService,
    ServicePageAppService,
    BookingAppService,
    BookingCheckinService,
    StoreHomeAppService,
    LandingPageAppService,
    LandingLeadService,
    // Default CRM pipeline for the landing leads (same helper as the CRM).
    StoreBootstrapHelper,
  ],
  exports: [AppsService],
})
export class AppsModule {}
