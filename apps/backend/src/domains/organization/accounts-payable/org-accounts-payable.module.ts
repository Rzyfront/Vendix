import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Reuse the existing store-side cartera (accounts-payable) logic without
// duplicating it. `AccountsPayableModule` registers & exports
// `AccountsPayableService`, which is injected directly. Its sibling helper
// services (`ApAgingService`, `ApSchedulingService`, `ApBankExportService`)
// are NOT exported by that module, so we re-register them here as providers
// (importing the exact same classes — no logic is duplicated). They are
// stateless and depend only on `StorePrismaService` (from the global-scoped
// `PrismaModule`), so a fresh instance behaves identically when a store
// context is pinned via `runWithStoreContext`.
import { AccountsPayableModule as StoreAccountsPayableModule } from '../../store/accounts-payable/accounts-payable.module';
import { ApAgingService } from '../../store/accounts-payable/services/ap-aging.service';
import { ApSchedulingService } from '../../store/accounts-payable/services/ap-scheduling.service';
import { ApBankExportService } from '../../store/accounts-payable/services/ap-bank-export.service';

// `OrgAccountingModule` provides & exports `OrgAccountingScopeService`, the
// shared org-delegation helper (resolveEffectiveFiscalScope /
// runWithStoreContext / getStoreIdsForOrg) used to pin per-store context and
// resolve consolidated vs. per-store reads.
import { OrgAccountingModule } from '../accounting/accounting.module';

import { OrgAccountsPayableController } from './org-accounts-payable.controller';
import { OrgAccountsPayableService } from './org-accounts-payable.service';

/**
 * Org-native accounts-payable (cartera CxP) module. Exposes
 * `/api/organization/accounts-payable/*` for ORG_ADMIN tokens.
 *
 * `StoreAccountsPayableModule` and `OrgAccountingModule` are imported (not
 * extended) so the org-side service delegates to the single source of truth
 * for cartera business rules and reuses the proven org scope helpers
 * (`OrgAccountingScopeService`) without any duplication.
 *
 * NOTE: this module must be registered in
 * `apps/backend/src/domains/organization/organization.module.ts` (imports
 * array) for the routes to be served, mirroring `OrgIcaModule` /
 * `OrgAccountsReceivableModule`.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    StoreAccountsPayableModule,
    OrgAccountingModule,
  ],
  controllers: [OrgAccountsPayableController],
  providers: [
    ModuleFlowGuard,
    OrgAccountsPayableService,
    ApAgingService,
    ApSchedulingService,
    ApBankExportService,
  ],
  exports: [OrgAccountsPayableService],
})
export class OrgAccountsPayableModule {}
