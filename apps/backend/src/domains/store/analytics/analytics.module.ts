import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { SalesAnalyticsService } from './services/sales-analytics.service';
import { InventoryAnalyticsService } from './services/inventory-analytics.service';
import { ProductsAnalyticsService } from './services/products-analytics.service';
import { OverviewAnalyticsService } from './services/overview-analytics.service';
import { CustomersAnalyticsService } from './services/customers-analytics.service';
import { FinancialAnalyticsService } from './services/financial-analytics.service';
import { PurchasesAnalyticsService } from './services/purchases-analytics.service';
import { ReviewsAnalyticsService } from './services/reviews-analytics.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [AnalyticsController],
  providers: [SalesAnalyticsService, InventoryAnalyticsService, ProductsAnalyticsService, OverviewAnalyticsService, CustomersAnalyticsService, FinancialAnalyticsService, PurchasesAnalyticsService, ReviewsAnalyticsService],
  exports: [SalesAnalyticsService, InventoryAnalyticsService, ProductsAnalyticsService, OverviewAnalyticsService, CustomersAnalyticsService, FinancialAnalyticsService, PurchasesAnalyticsService, ReviewsAnalyticsService],
})
export class AnalyticsModule {}
