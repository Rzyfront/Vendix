import { Module, forwardRef } from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import {
  OrderFlowController,
  OrderRefundsController,
} from './order-flow.controller';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { RefundCalculationService } from './services/refund-calculation.service';
import { RefundFlowService } from './services/refund-flow.service';
import { RefundMethodsService } from './services/refund-methods.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { InventoryTransactionsService } from '../../inventory/transactions/inventory-transactions.service';
import { CashRegistersModule } from '../../cash-registers/cash-registers.module';
import { SettingsModule } from '../../settings/settings.module';
import { OrderEtaService } from '../services/order-eta.service';
import { OrderAutoFulfillmentListener } from './listeners/order-auto-fulfillment.listener';
import { KitchenOrderDeliveredListener } from './listeners/kitchen-order-delivered.listener';
import { KitchenOrderDeliveryRevertedListener } from './listeners/kitchen-order-delivery-reverted.listener';
import { PaymentFromDispatchRouteListener } from './listeners/payment-from-dispatch-route.listener';
import { InventorySerialNumbersModule } from '../../inventory/serial-numbers/inventory-serial-numbers.module';
import { OrderStockCommitModule } from '../../inventory/shared/order-stock-commit.module';
import { WalletModule } from '../../wallet/wallet.module'; // QUI-457
import { PaymentsModule } from '../../payments/payments.module'; // refund-gateway-fix: W2-A needs PaymentGatewayService
import { OrdersModule } from '../orders.module'; // QUI-777: OrderSseService vive acá — el listener KDS lo usa para emitir `order.status_changed`

@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    CashRegistersModule,
    SettingsModule,
    InventorySerialNumbersModule,
    OrderStockCommitModule,
    WalletModule,
    // QUI-777: OrderSseService vive en OrdersModule y OrdersModule ya importa
    // OrderFlowModule (línea 54) — ciclo. `forwardRef` rompe el ciclo en DI.
    forwardRef(() => OrdersModule),
    // refund-gateway-fix: PaymentGatewayService.reversePaymentWithProcessor()
    // is called from RefundFlowService.dispatchRefundProcessor. Reverse the
    // forwardRef that PaymentsModule already declares against us (line 69 of
    // payments.module.ts) so DI resolves on both sides of the cycle.
    forwardRef(() => PaymentsModule),
  ],
  controllers: [OrderFlowController, OrderRefundsController],
  providers: [
    OrderFlowService,
    RefundCalculationService,
    RefundFlowService,
    RefundMethodsService,
    StockLevelManager,
    InventoryTransactionsService,
    OrderEtaService,
    // P3.4: ORG-scope auto-fulfillment of ecommerce orders.
    OrderAutoFulfillmentListener,
    // Restaurant: KDS delivered -> order processing->delivered bridge.
    KitchenOrderDeliveredListener,
    // Restaurant: KDS reversa -> order delivered->processing bridge.
    KitchenOrderDeliveryRevertedListener,
    // COD: dispatch route settlement -> COD order balance bridge (paso 7).
    PaymentFromDispatchRouteListener,
  ],
  exports: [OrderFlowService, RefundFlowService, OrderEtaService],
})
export class OrderFlowModule {}
