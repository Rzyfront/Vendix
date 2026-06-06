import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Reuse the existing store-side ICA service without duplicating its logic.
// The store `TaxesModule` registers and exports `IcaService`; we import the
// module here so Nest can resolve it as a dependency of `OrgIcaService`.
import { TaxesModule as StoreTaxesModule } from '../../store/taxes/taxes.module';

// `OrgAccountingModule` provides & exports `OrgAccountingScopeService`, the
// shared org-delegation helper (resolveEffectiveFiscalScope /
// runWithStoreContext / getStoreIdsForOrg) used to pin per-store context and
// aggregate consolidated reads.
import { OrgAccountingModule } from '../accounting/accounting.module';

import { OrgIcaController } from './org-ica.controller';
import { OrgIcaService } from './org-ica.service';

/**
 * Org-native ICA municipal module. Exposes `/api/organization/taxes/ica/*`
 * for ORG_ADMIN tokens.
 *
 * Both `StoreTaxesModule` and `OrgAccountingModule` are imported (not
 * extended) so `OrgIcaService` delegates to the single source of truth for
 * ICA logic (`IcaService`) and reuses the proven org scope helpers
 * (`OrgAccountingScopeService`) without any duplication.
 */
@Module({
  imports: [PrismaModule, ResponseModule, StoreTaxesModule, OrgAccountingModule],
  controllers: [OrgIcaController],
  providers: [ModuleFlowGuard, OrgIcaService],
  exports: [OrgIcaService],
})
export class OrgIcaModule {}
