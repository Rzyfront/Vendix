import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

// Store-domain modules reused for write delegation / shared services.
// AuditModule is global (see common/audit/audit.module.ts).
import { InventoryAdjustmentsModule } from '../../store/inventory/adjustments/inventory-adjustments.module';
import { InventoryTransactionsService } from '../../store/inventory/transactions/inventory-transactions.service';
import { StockLevelManager } from '../../store/inventory/shared/services/stock-level-manager.service';

import { OrgStockLevelsController } from './stock-levels/org-stock-levels.controller';
import { OrgStockLevelsService } from './stock-levels/org-stock-levels.service';

import { OrgLocationsController } from './locations/org-locations.controller';
import { OrgLocationsService } from './locations/org-locations.service';

import { OrgMovementsController } from './movements/org-movements.controller';
import { OrgMovementsService } from './movements/org-movements.service';

import { OrgSuppliersController } from './suppliers/org-suppliers.controller';
import { OrgSuppliersService } from './suppliers/org-suppliers.service';

import { OrgTransactionsController } from './transactions/org-transactions.controller';
import { OrgTransactionsService } from './transactions/org-transactions.service';

import { OrgAdjustmentsController } from './adjustments/org-adjustments.controller';
import { OrgAdjustmentsService } from './adjustments/org-adjustments.service';

import { OrgTransfersController } from './transfers/org-transfers.controller';
import { OrgTransfersService } from './transfers/org-transfers.service';

/**
 * `/api/organization/inventory/*` — org-native inventory module.
 *
 * Implements the Phase 2 plan: read-only consolidated views that respect
 * `operating_scope`:
 *   - ORGANIZATION → consolidated across every store of the org, with an
 *     optional `?store_id=X` breakdown filter.
 *   - STORE → per-store reads (the org groups but does not consolidate).
 *
 * P2 ROUND 2 — write parity: `OrgAdjustmentsController` and
 * `OrgTransfersController` (full lifecycle: create / approve / dispatch /
 * complete / cancel) are wired here. `OrgSuppliersController` and
 * `OrgLocationsController` already expose their write endpoints.
 *
 * Mutating flows for `OrgAdjustments` delegate to the proven
 * {@link InventoryAdjustmentsService} via `InventoryAdjustmentsModule` so
 * that StockLevelManager + costing snapshots + accounting events stay
 * consistent across store and org code paths.
 *
 * `OrgTransfersService` mutates stock directly through
 * {@link StockLevelManager}, which depends transitively on
 * {@link InventoryTransactionsService}. Both are declared as providers here
 * (mirroring `StockTransfersModule`) so the org module is self-sufficient
 * and does not pull in the store-side controllers.
 *
 * Dependencies (`OrganizationPrismaService`, `GlobalPrismaService`,
 * `OperatingScopeService`) are exported from `PrismaModule`. `AuditService`
 * is provided by the global `AuditModule`.
 */
@Module({
  imports: [PrismaModule, ResponseModule, InventoryAdjustmentsModule],
  controllers: [
    OrgStockLevelsController,
    OrgLocationsController,
    OrgMovementsController,
    OrgSuppliersController,
    OrgTransactionsController,
    OrgAdjustmentsController,
    OrgTransfersController,
  ],
  providers: [
    OrgStockLevelsService,
    OrgLocationsService,
    OrgMovementsService,
    OrgSuppliersService,
    OrgTransactionsService,
    OrgAdjustmentsService,
    OrgTransfersService,
    // Shared inventory infrastructure used by OrgTransfersService.
    StockLevelManager,
    InventoryTransactionsService,
  ],
  exports: [
    OrgStockLevelsService,
    OrgLocationsService,
    OrgMovementsService,
    OrgSuppliersService,
    OrgTransactionsService,
    OrgAdjustmentsService,
    OrgTransfersService,
  ],
})
export class OrgInventoryModule {}
