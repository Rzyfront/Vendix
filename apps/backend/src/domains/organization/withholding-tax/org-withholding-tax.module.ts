import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Reuse the existing store-side withholding service without duplicating its
// logic. `WithholdingTaxModule` registers and exports `WithholdingTaxService`,
// which already resolves the correct fiscal accounting entity from
// `RequestContext`.
import { WithholdingTaxModule as StoreWithholdingTaxModule } from '../../store/withholding-tax/withholding-tax.module';

// `OrgAccountingModule` exports `OrgAccountingScopeService`, the shared
// fiscal-scope resolver + `runWithStoreContext` helper used by all
// `/api/organization/accounting/*` and `/api/organization/withholding-tax/*`
// org-twin endpoints.
import { OrgAccountingModule } from '../accounting/accounting.module';

import { OrgWithholdingTaxController } from './org-withholding-tax.controller';
import { OrgWithholdingTaxService } from './org-withholding-tax.service';

/**
 * Org-native withholding-tax module. Exposes
 * `/api/organization/withholding-tax/*` for ORG_ADMIN tokens.
 *
 * Imports the store `WithholdingTaxModule` (not extended) so the org-side
 * service can delegate to the existing `WithholdingTaxService` via
 * `runWithStoreContext`, preserving the single source of truth for
 * withholding business rules without duplicating them.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    StoreWithholdingTaxModule,
    OrgAccountingModule,
  ],
  controllers: [OrgWithholdingTaxController],
  providers: [ModuleFlowGuard, OrgWithholdingTaxService],
  exports: [OrgWithholdingTaxService],
})
export class OrgWithholdingTaxModule {}
