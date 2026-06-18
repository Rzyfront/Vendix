import { Module } from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import {
  OrderFlowController,
  OrderRefundsController,
} from './order-flow.controller';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { RefundCalculationService } from './services/refund-calculation.service';
import { RefundFlowService } from './services/refund-flow.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { InventoryTransactionsService } from '../../inventory/transactions/inventory-transactions.service';
import { CashRegistersModule } from '../../cash-registers/cash-registers.module';
import { SettingsModule } from '../../settings/settings.module';
import { OrderEtaService } from '../services/order-eta.service';
import { OrderAutoFulfillmentListener } from './listeners/order-auto-fulfillment.listener';
import { KitchenOrderDeliveredListener } from './listeners/kitchen-order-delivered.listener';
import { KitchenOrderDeliveryRevertedListener } from './listeners/kitchen-order-delivery-reverted.listener';

@Module({
  imports: [PrismaModule, ResponseModule, CashRegistersModule, SettingsModule],
  controllers: [OrderFlowController, OrderRefundsController],
  providers: [
    OrderFlowService,
    RefundCalculationService,
    RefundFlowService,
    StockLevelManager,
    InventoryTransactionsService,
    OrderEtaService,
    // P3.4: ORG-scope auto-fulfillment of ecommerce orders.
    OrderAutoFulfillmentListener,
    // Restaurant: KDS delivered -> order processing->delivered bridge.
    KitchenOrderDeliveredListener,
    // Restaurant: KDS reversa -> order delivered->processing bridge.
    KitchenOrderDeliveryRevertedListener,
  ],
  exports: [OrderFlowService, RefundFlowService, OrderEtaService],
})
export class OrderFlowModule {}
