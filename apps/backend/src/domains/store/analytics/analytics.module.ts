import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { SalesAnalyticsService } from './services/sales-analytics.service';
import { InventoryAnalyticsService } from './services/inventory-analytics.service';
import { ProductsAnalyticsService } from './services/products-analytics.service';
import { OverviewAnalyticsService } from './services/overview-analytics.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [AnalyticsController],
  providers: [SalesAnalyticsService, InventoryAnalyticsService, ProductsAnalyticsService, OverviewAnalyticsService],
  exports: [SalesAnalyticsService, InventoryAnalyticsService, ProductsAnalyticsService, OverviewAnalyticsService],
})
export class AnalyticsModule {}
