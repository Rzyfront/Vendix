import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createReportingTools } from '../../../ai-engine/tools/domains/reporting.tools';
import { AnalyticsController } from './analytics.controller';
import { SalesAnalyticsService } from './services/sales-analytics.service';
import { InventoryAnalyticsService } from './services/inventory-analytics.service';
import { ProductsAnalyticsService } from './services/products-analytics.service';
import { OverviewAnalyticsService } from './services/overview-analytics.service';
import { CustomersAnalyticsService } from './services/customers-analytics.service';
import { FinancialAnalyticsService } from './services/financial-analytics.service';
import { PurchasesAnalyticsService } from './services/purchases-analytics.service';
import { ReviewsAnalyticsService } from './services/reviews-analytics.service';
import { DispatchAnalyticsService } from './services/dispatch-analytics.service';
import { SalesDimensionAnalyticsService } from './services/sales-dimension-analytics.service';
import { PaymentsAnalyticsService } from './services/payments-analytics.service';
import { PaymentsAnalyticsController } from './payments-analytics.controller';
import { FinancialAnalyticsCacheInvalidationListener } from './listeners/financial-analytics-cache-invalidation.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { S3Service } from '@common/services/s3.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule, S3Module],
  controllers: [AnalyticsController, PaymentsAnalyticsController],
  providers: [
    SalesAnalyticsService,
    InventoryAnalyticsService,
    ProductsAnalyticsService,
    OverviewAnalyticsService,
    CustomersAnalyticsService,
    FinancialAnalyticsService,
    PurchasesAnalyticsService,
    ReviewsAnalyticsService,
    DispatchAnalyticsService,
    PaymentsAnalyticsService,
    SalesDimensionAnalyticsService,
    FinancialAnalyticsCacheInvalidationListener,
  ],
  exports: [
    SalesAnalyticsService,
    InventoryAnalyticsService,
    ProductsAnalyticsService,
    OverviewAnalyticsService,
    CustomersAnalyticsService,
    FinancialAnalyticsService,
    PurchasesAnalyticsService,
    ReviewsAnalyticsService,
    DispatchAnalyticsService,
    FinancialAnalyticsCacheInvalidationListener,
  ],
})
export class AnalyticsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly s3: S3Service,
  ) {}

  /**
   * A-1/A-2 — reporting tools. Registro descentralizado en el módulo dueño
   * (no en `AIEngineModule`, para no reintroducir el ciclo DI).
   * `AIToolRegistry` viene del módulo global, así que no cuesta ningún import.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(createReportingTools({ s3: this.s3 }));
  }
}
