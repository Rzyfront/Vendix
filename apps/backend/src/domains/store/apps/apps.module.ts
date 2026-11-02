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

/** Apps — catálogo de aplicaciones web por tienda (odd/tasks/apps-module.md). */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [
    ProductPageAppController,
    ProductPagePublicController,
    ServicePageAppController,
    ServicePagePublicController,
    AppsController,
  ],
  providers: [
    AppsService,
    AppDomainService,
    ProductPageAppService,
    ServicePageAppService,
  ],
  exports: [AppsService],
})
export class AppsModule {}
