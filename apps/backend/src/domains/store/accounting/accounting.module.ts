import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { S3Module } from '../../../common/services/s3.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Vexi (AI agent) — familia de herramientas contables de sólo lectura.
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createAccountingTools } from '../../../ai-engine/tools/domains/accounting.tools';

// Chart of Accounts
import { ChartOfAccountsController } from './chart-of-accounts/chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts/chart-of-accounts.service';
import { DefaultChartOfAccountsSeederService } from '../../../common/services/default-chart-of-accounts-seeder.service';

// Journal Entries
import { JournalEntriesController } from './journal-entries/journal-entries.controller';
import { JournalEntriesService } from './journal-entries/journal-entries.service';
import { JournalEntryFlowService } from './journal-entries/journal-entry-flow.service';

// Fiscal Periods
import { FiscalPeriodsController } from './fiscal-periods/fiscal-periods.controller';
import { FiscalPeriodsService } from './fiscal-periods/fiscal-periods.service';

// Reports
import { AccountingReportsController } from './reports/accounting-reports.controller';
import { AccountingReportsService } from './reports/accounting-reports.service';
import { InventoryReconciliationService } from './reports/inventory-reconciliation.service';

// Account Mappings
import { AccountMappingController } from './account-mappings/account-mapping.controller';
import { AccountMappingService } from './account-mappings/account-mapping.service';

// Auto Entries
import { AutoEntryService } from './auto-entries/auto-entry.service';
import { AccountingEventsListener } from './auto-entries/accounting-events.listener';
// Plan Despacho Economía — FASE 5 paso 17. Listener de liquidación de ruta.
import { DispatchSettlementListener } from './listeners/dispatch-settlement.listener';
// AccountsPayableService lo consume DispatchSettlementListener (CxP transportador).
import { AccountsPayableModule } from '../accounts-payable/accounts-payable.module';
import {
  AccountingEntryFailureService,
  ACCOUNTING_ENTRY_RETRY_QUEUE,
} from './auto-entries/accounting-entry-failure.service';
import { AccountingEntryRetryProcessor } from './auto-entries/processors/accounting-entry-retry.processor';
import { EntryFailuresController } from './auto-entries/entry-failures.controller';
import { PlatformOrgService } from '../../../common/services/platform-org.service';

// Bank Reconciliation
import { BankAccountsController } from './bank-reconciliation/bank-accounts.controller';
import { BankAccountsService } from './bank-reconciliation/bank-accounts.service';
import { BankTransactionsController } from './bank-reconciliation/bank-transactions.controller';
import { BankTransactionsService } from './bank-reconciliation/bank-transactions.service';
import { ReconciliationController } from './bank-reconciliation/reconciliation.controller';
import { ReconciliationService } from './bank-reconciliation/reconciliation.service';
import { ReconciliationMatchingService } from './bank-reconciliation/reconciliation-matching.service';
import { DigitalPaymentMatcherService } from './bank-reconciliation/digital-payment-matcher.service';
import { UnassignedPaymentsController } from './bank-reconciliation/unassigned-payments.controller';
import { UnassignedPaymentsService } from './bank-reconciliation/unassigned-payments.service';

// Bank Reconciliation Parsers
import { StatementParserFactory } from './bank-reconciliation/parsers/statement-parser.factory';
import { CsvStatementParser } from './bank-reconciliation/parsers/csv-statement.parser';
import { OfxStatementParser } from './bank-reconciliation/parsers/ofx-statement.parser';
import { Mt940StatementParser } from './bank-reconciliation/parsers/mt940-statement.parser';

// Budgets
import { BudgetsController } from './budgets/budgets.controller';
import { BudgetsService } from './budgets/budgets.service';
import { BudgetVarianceService } from './budgets/budget-variance.service';

// Consolidation
import { ConsolidationController } from './consolidation/consolidation.controller';
import { ConsolidationService } from './consolidation/consolidation.service';
import { IntercompanyDetectionService } from './consolidation/intercompany-detection.service';
import { ConsolidatedReportsService } from './consolidation/consolidated-reports.service';

// Fixed Assets
import { FixedAssetsController } from './fixed-assets/fixed-assets.controller';
import { FixedAssetCategoriesController } from './fixed-assets/fixed-asset-categories.controller';
import { FixedAssetsService } from './fixed-assets/fixed-assets.service';
import { FixedAssetCategoriesService } from './fixed-assets/fixed-asset-categories.service';
import { DepreciationCalculatorService } from './fixed-assets/depreciation-calculator.service';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    S3Module,
    AccountsPayableModule,
    BullModule.registerQueue({ name: ACCOUNTING_ENTRY_RETRY_QUEUE }),
  ],
  controllers: [
    ChartOfAccountsController,
    EntryFailuresController,
    JournalEntriesController,
    FiscalPeriodsController,
    AccountingReportsController,
    AccountMappingController,
    BankAccountsController,
    BankTransactionsController,
    ReconciliationController,
    UnassignedPaymentsController,
    BudgetsController,
    ConsolidationController,
    FixedAssetsController,
    FixedAssetCategoriesController,
  ],
  providers: [
    ModuleFlowGuard,
    ChartOfAccountsService,
    DefaultChartOfAccountsSeederService,
    JournalEntriesService,
    JournalEntryFlowService,
    FiscalPeriodsService,
    AccountingReportsService,
    InventoryReconciliationService,
    AccountMappingService,
    AutoEntryService,
    AccountingEventsListener,
    AccountingEntryFailureService,
    DispatchSettlementListener,
    AccountingEntryRetryProcessor,
    PlatformOrgService,
    BankAccountsService,
    BankTransactionsService,
    ReconciliationService,
    ReconciliationMatchingService,
    DigitalPaymentMatcherService,
    UnassignedPaymentsService,
    StatementParserFactory,
    CsvStatementParser,
    OfxStatementParser,
    Mt940StatementParser,
    BudgetsService,
    BudgetVarianceService,
    ConsolidationService,
    IntercompanyDetectionService,
    ConsolidatedReportsService,
    FixedAssetsService,
    FixedAssetCategoriesService,
    DepreciationCalculatorService,
  ],
  exports: [
    ChartOfAccountsService,
    DefaultChartOfAccountsSeederService,
    JournalEntriesService,
    JournalEntryFlowService,
    FiscalPeriodsService,
    AccountingReportsService,
    AccountMappingService,
    AutoEntryService,
    BankAccountsService,
    BankTransactionsService,
    ReconciliationService,
    ReconciliationMatchingService,
    DigitalPaymentMatcherService,
    UnassignedPaymentsService,
    BudgetsService,
    BudgetVarianceService,
    ConsolidationService,
    IntercompanyDetectionService,
    ConsolidatedReportsService,
    FixedAssetsService,
    FixedAssetCategoriesService,
    DepreciationCalculatorService,
  ],
})
export class AccountingModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly reportsService: AccountingReportsService,
    private readonly fiscalPeriodsService: FiscalPeriodsService,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly fiscalScopeService: FiscalScopeService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * Registra la familia contable de Vexi desde el dominio que posee los datos.
   * `AIToolRegistry` se exporta desde el `@Global() AIEngineModule`, así que la
   * dependencia apunta dominio → motor y no al revés: importar AccountingModule
   * dentro de un módulo global sería un generador de ciclos.
   *
   * Se inyectan los servicios del dominio (no Prisma crudo) porque son ellos
   * los que resuelven la entidad contable / `fiscal_scope` correcta. La única
   * excepción es `StorePrismaService`, usado exclusivamente para leer la fila
   * de `accounting_entities` con la que se etiqueta cada respuesta — y aun así
   * pasa por el scoping multi-tenant.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createAccountingTools({
        reportsService: this.reportsService,
        fiscalPeriodsService: this.fiscalPeriodsService,
        journalEntriesService: this.journalEntriesService,
        chartOfAccountsService: this.chartOfAccountsService,
        fiscalScopeService: this.fiscalScopeService,
        prisma: this.prisma,
      }),
    );
  }
}
