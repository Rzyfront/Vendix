import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Reuse the existing store-side cartera (accounts-receivable) logic without
// duplicating it. `AccountsReceivableModule` registers & exports
// `AccountsReceivableService`, which is injected directly. Its sibling helper
// services (`ArAgingService`, `ArCollectionService`, `PaymentAgreementService`)
// are NOT exported by that module, so we re-register them here as providers
// (importing the exact same classes — no logic is duplicated). They are
// stateless and depend only on `StorePrismaService` (from the global-scoped
// `PrismaModule`), so a fresh instance behaves identically when a store
// context is pinned via `runWithStoreContext`.
import { AccountsReceivableModule as StoreAccountsReceivableModule } from '../../store/accounts-receivable/accounts-receivable.module';
import { ArAgingService } from '../../store/accounts-receivable/services/ar-aging.service';
import { ArCollectionService } from '../../store/accounts-receivable/services/ar-collection.service';
import { PaymentAgreementService } from '../../store/accounts-receivable/services/payment-agreement.service';

// `OrgAccountingModule` provides & exports `OrgAccountingScopeService`, the
// shared org-delegation helper (resolveEffectiveFiscalScope /
// runWithStoreContext / getStoreIdsForOrg) used to pin per-store context and
// aggregate consolidated reads.
import { OrgAccountingModule } from '../accounting/accounting.module';

import { OrgAccountsReceivableController } from './org-accounts-receivable.controller';
import { OrgAccountsReceivableService } from './org-accounts-receivable.service';

/**
 * Org-native accounts-receivable (cartera CxC) module. Exposes
 * `/api/organization/accounts-receivable/*` for ORG_ADMIN tokens.
 *
 * `StoreAccountsReceivableModule` and `OrgAccountingModule` are imported (not
 * extended) so the org-side service delegates to the single source of truth
 * for cartera business rules and reuses the proven org scope helpers
 * (`OrgAccountingScopeService`) without any duplication.
 *
 * NOTE: this module must be registered in
 * `apps/backend/src/domains/organization/organization.module.ts` (imports
 * array) for the routes to be served, mirroring `OrgIcaModule` /
 * `OrgWithholdingTaxModule`.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    StoreAccountsReceivableModule,
    OrgAccountingModule,
  ],
  controllers: [OrgAccountsReceivableController],
  providers: [
    ModuleFlowGuard,
    OrgAccountsReceivableService,
    ArAgingService,
    ArCollectionService,
    PaymentAgreementService,
  ],
  exports: [OrgAccountsReceivableService],
})
export class OrgAccountsReceivableModule {}
