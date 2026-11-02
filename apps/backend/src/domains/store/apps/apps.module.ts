import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { ProductPageAppController } from './product-page/product-page-app.controller';
import { ProductPageAppService } from './product-page/product-page-app.service';
import { ProductPagePublicController } from './product-page/product-page-public.controller';

/** Apps — catálogo de aplicaciones web por tienda (odd/tasks/apps-module.md). */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [
    ProductPageAppController,
    ProductPagePublicController,
    AppsController,
  ],
  providers: [AppsService, ProductPageAppService],
  exports: [AppsService],
})
export class AppsModule {}
