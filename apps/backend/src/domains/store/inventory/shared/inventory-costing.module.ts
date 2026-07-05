import { Global, Module } from '@nestjs/common';
import { CostingService } from './services/costing.service';
import { CostingMethodResolverService } from './services/costing-method-resolver.service';
import { PrismaModule } from '../../../../prisma/prisma.module';

/**
 * QUI-425 Parte B: `StockLevelManager` now requires `CostingService` and
 * `CostingMethodResolverService`. The manager is re-declared as a local
 * provider in several feature modules (stock-transfers, payments,
 * kitchen-fire, production, orders, order-flow, etc.) that historically
 * did NOT import `InventoryModule`, so DI broke at boot.
 *
 * Marking this module `@Global()` makes the two costing services
 * available app-wide after a single import in `AppModule`, avoiding a
 * multi-module refactor of the consumers.
 *
 * `PrismaModule` is imported (not marked global) so `CostingService` can
 * resolve `StorePrismaService`. `InventoryModule` is configured to NOT
 * redeclare these two services (they come from this global module) to
 * avoid duplicate provider errors.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [CostingService, CostingMethodResolverService],
  exports: [CostingService, CostingMethodResolverService],
})
export class InventoryCostingModule {}