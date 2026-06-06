import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Reuse the org accounting scope helpers (resolveEffectiveFiscalScope,
// runWithStoreContext, …) and the store-side exogenous service without
// duplicating their logic. Both modules export the providers we depend on.
import { OrgAccountingModule } from '../accounting/accounting.module';
import { ExogenousModule } from '../../store/exogenous/exogenous.module';

import { OrgExogenousController } from './org-exogenous.controller';
import { OrgExogenousService } from './org-exogenous.service';

/**
 * Org-native DIAN exogenous module. Exposes `/api/organization/exogenous/*`
 * for ORG_ADMIN tokens.
 *
 * `OrgAccountingModule` is imported to reuse `OrgAccountingScopeService`
 * (fiscal-scope resolution + store-context pinning) and `ExogenousModule`
 * to reuse the store-side `ExogenousService`. This preserves a single source
 * of truth for exogenous business rules without duplicating them.
 */
@Module({
  imports: [PrismaModule, ResponseModule, OrgAccountingModule, ExogenousModule],
  controllers: [OrgExogenousController],
  providers: [ModuleFlowGuard, OrgExogenousService],
  exports: [OrgExogenousService],
})
export class OrgExogenousModule {}
