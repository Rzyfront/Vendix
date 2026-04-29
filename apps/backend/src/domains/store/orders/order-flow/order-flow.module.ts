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
  ],
  exports: [OrderFlowService, RefundFlowService, OrderEtaService],
})
export class OrderFlowModule {}
