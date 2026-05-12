import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { StockTransfersModule } from './stock-transfers/stock-transfers.module';
import { ReturnOrdersModule } from './return-orders/return-orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderFlowModule } from './order-flow/order-flow.module';
import { SettingsModule } from '../settings/settings.module';
import { ShippingModule } from '../shipping/shipping.module';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { InventoryTransactionsService } from '../inventory/transactions/inventory-transactions.service';
import { OrderEtaService } from './services/order-eta.service';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    SalesOrdersModule,
    StockTransfersModule,
    ReturnOrdersModule,
    forwardRef(() => PaymentsModule),
    OrderFlowModule,
    SettingsModule,
    ShippingModule,
    PurchaseOrdersModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    StockLevelManager,
    InventoryTransactionsService,
    OrderEtaService,
  ],
  exports: [OrdersService, OrderFlowModule, OrderEtaService],
})
export class OrdersModule {}
