import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { StoreFiscalController } from './store-fiscal.controller';
import { OrganizationFiscalController } from './organization-fiscal.controller';
import { FiscalContextResolverService } from './services/fiscal-context-resolver.service';
import { FiscalObligationService } from './services/fiscal-obligation.service';
import { TaxDeclarationDraftService } from './services/tax-declaration-draft.service';
import { FiscalCloseService } from './services/fiscal-close.service';
import { FiscalEvidenceService } from './services/fiscal-evidence.service';
import { FiscalRulesService } from './services/fiscal-rules.service';
import { FiscalAuditService } from './services/fiscal-audit.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [StoreFiscalController, OrganizationFiscalController],
  providers: [
    FiscalContextResolverService,
    FiscalObligationService,
    TaxDeclarationDraftService,
    FiscalCloseService,
    FiscalEvidenceService,
    FiscalRulesService,
    FiscalAuditService,
  ],
  exports: [
    FiscalContextResolverService,
    FiscalObligationService,
    TaxDeclarationDraftService,
    FiscalCloseService,
    FiscalEvidenceService,
    FiscalRulesService,
    FiscalAuditService,
  ],
})
export class FiscalOperationsModule {}
