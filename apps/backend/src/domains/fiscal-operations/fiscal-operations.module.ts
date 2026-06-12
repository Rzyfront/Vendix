import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { ExogenousModule } from '../store/exogenous/exogenous.module';
import { StoreFiscalController } from './store-fiscal.controller';
import { OrganizationFiscalController } from './organization-fiscal.controller';
import { FiscalContextResolverService } from './services/fiscal-context-resolver.service';
import { FiscalFlowStateService } from './services/fiscal-flow-state.service';
import { FiscalObligationService } from './services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from './services/tax-declaration-draft.service';
import { FiscalCloseService } from './services/fiscal-close.service';
import { FiscalEvidenceService } from './services/fiscal-evidence.service';
import { FiscalRulesService } from './services/fiscal-rules.service';
import { FiscalAuditService } from './services/fiscal-audit.service';
import { FiscalConfigChecklistService } from './services/fiscal-config-checklist.service';
import { FiscalStatusService } from '@common/services/fiscal-status.service';

@Module({
  imports: [PrismaModule, ResponseModule, ExogenousModule],
  controllers: [StoreFiscalController, OrganizationFiscalController],
  providers: [
    FiscalContextResolverService,
    FiscalFlowStateService,
    FiscalObligationService,
    TaxDeclarationDraftService,
    FiscalCloseService,
    FiscalEvidenceService,
    FiscalRulesService,
    FiscalAuditService,
    FiscalStatusService,
    FiscalConfigChecklistService,
  ],
  exports: [
    FiscalContextResolverService,
    FiscalFlowStateService,
    FiscalObligationService,
    TaxDeclarationDraftService,
    FiscalCloseService,
    FiscalEvidenceService,
    FiscalRulesService,
    FiscalAuditService,
    FiscalConfigChecklistService,
  ],
})
export class FiscalOperationsModule {}
