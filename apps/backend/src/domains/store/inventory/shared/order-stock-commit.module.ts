import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { InventoryTransactionsModule } from '../transactions/inventory-transactions.module';
import { InventorySerialNumbersModule } from '../serial-numbers/inventory-serial-numbers.module';
import { StockLevelManager } from './services/stock-level-manager.service';
import { StockValidatorService } from './services/stock-validator.service';
import { OrderStockCommitService } from './services/order-stock-commit.service';

/**
 * Canonical order-delivery stock deduction.
 *
 * Provides {@link OrderStockCommitService} — the single path every delivery
 * caller (order-flow finished, POS payment, credit close-out, dispatch-note
 * delivered) routes through. It re-declares the `StockLevelManager` /
 * `StockValidatorService` primitives locally (the established per-module
 * pattern — see order-flow / payments / stock-levels modules) and imports the
 * modules that own the transaction + serial-number services those primitives
 * depend on. The two costing services are supplied app-wide by the `@Global`
 * `InventoryCostingModule`; `EventEmitter2` by the global event-emitter module.
 *
 * Consumers import THIS module and inject `OrderStockCommitService`.
 */
@Module({
  imports: [
    PrismaModule,
    InventoryTransactionsModule,
    InventorySerialNumbersModule,
  ],
  providers: [
    OrderStockCommitService,
    StockLevelManager,
    StockValidatorService,
  ],
  exports: [OrderStockCommitService],
})
export class OrderStockCommitModule {}
