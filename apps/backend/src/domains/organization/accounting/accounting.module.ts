import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Reuse the existing store-side accounting services without duplicating
// their logic. The store AccountingModule registers them as providers and
// we import the module here so Nest can resolve the dependencies.
import { AccountingModule as StoreAccountingModule } from '../../store/accounting/accounting.module';

import { OrgAccountingScopeService } from './org-accounting-scope.service';

import { OrgChartOfAccountsController } from './chart-of-accounts/chart-of-accounts.controller';
import { OrgChartOfAccountsService } from './chart-of-accounts/chart-of-accounts.service';

import { OrgJournalEntriesController } from './journal-entries/journal-entries.controller';
import { OrgJournalEntriesService } from './journal-entries/journal-entries.service';

import { OrgAccountMappingsController } from './account-mappings/account-mappings.controller';
import { OrgAccountMappingsService } from './account-mappings/account-mappings.service';

import { OrgFiscalPeriodsController } from './fiscal-periods/fiscal-periods.controller';
import { OrgFiscalPeriodsService } from './fiscal-periods/fiscal-periods.service';

// DefaultChartOfAccountsSeederService is provided & exported by StoreAccountingModule
// (imported above) — no additional registration needed for the org gemelo endpoint.

/**
 * Org-native accounting module. Exposes `/api/organization/accounting/*` for
 * ORG_ADMIN tokens (DomainScopeGuard rejects everyone else).
 *
 * The store AccountingModule is imported (not extended) so the org-side
 * services can delegate to the existing store-side services
 * (`ChartOfAccountsService`, `JournalEntriesService`, …) via
 * `runWithStoreContext`. This preserves the single source of truth for
 * accounting business rules without duplicating them.
 */
@Module({
  imports: [PrismaModule, ResponseModule, StoreAccountingModule],
  controllers: [
    OrgChartOfAccountsController,
    OrgJournalEntriesController,
    OrgAccountMappingsController,
    OrgFiscalPeriodsController,
  ],
  providers: [
    ModuleFlowGuard,
    OrgAccountingScopeService,
    OrgChartOfAccountsService,
    OrgJournalEntriesService,
    OrgAccountMappingsService,
    OrgFiscalPeriodsService,
  ],
  exports: [
    OrgAccountingScopeService,
    OrgChartOfAccountsService,
    OrgJournalEntriesService,
    OrgAccountMappingsService,
    OrgFiscalPeriodsService,
  ],
})
export class OrgAccountingModule {}
