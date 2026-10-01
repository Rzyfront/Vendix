import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

// Vexi (AI agent) — familia fiscal: 7 reads + 7 writes (F-14..F-27).
import { AIToolRegistry } from '../../ai-engine/tools/ai-tool-registry';
import { createFiscalTools } from '../../ai-engine/tools/domains/fiscal.tools';
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
import { FiscalTaxCalendarService } from './services/fiscal-tax-calendar.service';
import { InvoicingModule } from '../store/invoicing/invoicing.module';
import { InvoicingService } from '../store/invoicing/invoicing.service';

@Module({
  // InvoicingModule solo por `InvoicingService` (F-27 `list_invoices`): el
  // árbol de invoicing no importa este módulo, así que no hay ciclo DI.
  imports: [PrismaModule, ResponseModule, ExogenousModule, InvoicingModule],
  controllers: [StoreFiscalController, OrganizationFiscalController],
  providers: [
    FiscalContextResolverService,
    FiscalFlowStateService,
    FiscalObligationService,
    FiscalTaxCalendarService,
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
export class FiscalOperationsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly contextResolver: FiscalContextResolverService,
    private readonly obligations: FiscalObligationService,
    private readonly declarations: TaxDeclarationDraftService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly flowState: FiscalFlowStateService,
    private readonly closeService: FiscalCloseService,
    private readonly checklist: FiscalConfigChecklistService,
    private readonly invoicing: InvoicingService,
  ) {}

  /**
   * Registra la familia fiscal de Vexi desde el dominio que posee los datos.
   * `AIToolRegistry` se exporta desde el `@Global() AIEngineModule`, así que
   * la dependencia apunta dominio → motor y no al revés. `FiscalScopeService`
   * llega vía `PrismaModule` (ya importado): las tools lo usan para la doble
   * resolución fail-closed del NIT (`accounting_entity_id`).
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createFiscalTools({
        contextResolver: this.contextResolver,
        obligationsService: this.obligations,
        declarationsService: this.declarations,
        fiscalScopeService: this.fiscalScope,
        flowStateService: this.flowState,
        closeService: this.closeService,
        checklistService: this.checklist,
        invoicesService: this.invoicing,
      }),
    );
  }
}
