import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersBulkController } from './orders-bulk.controller';
import { OrdersBulkService } from './orders-bulk.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '@common/services/s3.module';
import { StockTransfersModule } from './stock-transfers/stock-transfers.module';
import { ReturnOrdersModule } from './return-orders/return-orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderFlowModule } from './order-flow/order-flow.module';
import { SettingsModule } from '../settings/settings.module';
import { ShippingModule } from '../shipping/shipping.module';
import { DispatchNotesModule } from '../dispatch-notes/dispatch-notes.module';
import { DispatchRoutesModule } from '../dispatch-routes/dispatch-routes.module';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { SellableStockAllocator } from '../inventory/shared/services/sellable-stock-allocator.service';
import { InventoryTransactionsService } from '../inventory/transactions/inventory-transactions.service';
import { OrderEtaService } from './services/order-eta.service';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { CouponsModule } from '../coupons/coupons.module';
// Vexi tool families owned by this domain. AIToolRegistry comes from the
// @Global() AIEngineModule, so it is injectable WITHOUT importing that module
// here — importing it would risk a cycle, since it is global and this domain
// is one of its data sources.
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createOrdersTools } from '../../../ai-engine/tools/domains/orders.tools';
import { createSalesTools } from '../../../ai-engine/tools/domains/sales.tools';
import { createOrderWriteTools } from '../../../ai-engine/tools/domains/writes.tools';
import { OrderFlowService } from './order-flow/order-flow.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';
import { SalesAnalyticsService } from '../analytics/services/sales-analytics.service';
import { ProductsAnalyticsService } from '../analytics/services/products-analytics.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { DispatchNotesService } from '../dispatch-notes/dispatch-notes.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
// Carril B - B3: NotificationsSseService es el hub compartido por tienda que
// el endpoint `@Sse('orders/stream')` consume. OrderSseService lo envuelve
// con un payload tipado para el dominio `orders`.
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderSseService } from './services/order-sse.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    StockTransfersModule,
    ReturnOrdersModule,
    forwardRef(() => PaymentsModule),
    OrderFlowModule,
    SettingsModule,
    ShippingModule,
    DispatchNotesModule,
    DispatchRoutesModule,
    PurchaseOrdersModule,
    // Sources for the `sales` and `orders` Vexi tool families. Both modules
    // only import ResponseModule + PrismaModule, so neither introduces a cycle.
    AnalyticsModule,
    CashRegistersModule,
    PromotionsModule,
    CouponsModule,
    // Carril B - B3: necesario para inyectar NotificationsSseService.
    NotificationsModule,
  ],
  controllers: [OrdersController, OrdersBulkController],
  providers: [
    OrdersService,
    OrdersBulkService,
    StockLevelManager,
    SellableStockAllocator,
    InventoryTransactionsService,
    OrderEtaService,
    // Carril B - B3: hub tipado de eventos de orden para SSE.
    OrderSseService,
  ],
  exports: [OrdersService, OrderFlowModule, OrderEtaService],
})
export class OrdersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly ordersService: OrdersService,
    private readonly dispatchNotesService: DispatchNotesService,
    private readonly sessionsService: SessionsService,
    private readonly salesAnalyticsService: SalesAnalyticsService,
    private readonly productsAnalyticsService: ProductsAnalyticsService,
    private readonly prisma: StorePrismaService,
    // Único escritor legítimo de `orders.state` (QUI-557). Viene de
    // `OrderFlowModule`, que este módulo ya importa y reexporta.
    private readonly orderFlowService: OrderFlowService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createSalesTools({
        salesAnalyticsService: this.salesAnalyticsService,
        productsAnalyticsService: this.productsAnalyticsService,
      }),
    );

    this.toolRegistry.registerMany(
      createOrdersTools({
        ordersService: this.ordersService,
        dispatchNotesService: this.dispatchNotesService,
        sessionsService: this.sessionsService,
        prisma: this.prisma,
      }),
    );

    // `update_order_status` y `create_dispatch_note`. Se registran aquí porque
    // este módulo ya inyecta `OrderFlowService` y `DispatchNotesService`; que
    // Productos o Inventario las registraran obligaría a importar este dominio.
    this.toolRegistry.registerMany(
      createOrderWriteTools({
        orderFlowService: this.orderFlowService,
        dispatchNotesService: this.dispatchNotesService,
        prisma: this.prisma,
      }),
    );
  }
}
