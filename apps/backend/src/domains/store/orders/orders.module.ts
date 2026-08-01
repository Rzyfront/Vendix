import { Module, forwardRef } from '@nestjs/common';
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
import { InventoryTransactionsService } from '../inventory/transactions/inventory-transactions.service';
import { OrderEtaService } from './services/order-eta.service';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';

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
  ],
  controllers: [OrdersController, OrdersBulkController],
  providers: [
    OrdersService,
    OrdersBulkService,
    StockLevelManager,
    InventoryTransactionsService,
    OrderEtaService,
  ],
  exports: [OrdersService, OrderFlowModule, OrderEtaService],
})
export class OrdersModule {}
