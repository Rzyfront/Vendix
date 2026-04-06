import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '../../../common/services/s3.module';
import { ModuleFlowGuard } from '../../../common/guards/module-flow.guard';

// Chart of Accounts
import { ChartOfAccountsController } from './chart-of-accounts/chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts/chart-of-accounts.service';

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

// Account Mappings
import { AccountMappingController } from './account-mappings/account-mapping.controller';
import { AccountMappingService } from './account-mappings/account-mapping.service';

// Auto Entries
import { AutoEntryService } from './auto-entries/auto-entry.service';
import { AccountingEventsListener } from './auto-entries/accounting-events.listener';

// Bank Reconciliation
import { BankAccountsController } from './bank-reconciliation/bank-accounts.controller';
import { BankAccountsService } from './bank-reconciliation/bank-accounts.service';
import { BankTransactionsController } from './bank-reconciliation/bank-transactions.controller';
import { BankTransactionsService } from './bank-reconciliation/bank-transactions.service';
import { ReconciliationController } from './bank-reconciliation/reconciliation.controller';
import { ReconciliationService } from './bank-reconciliation/reconciliation.service';
import { ReconciliationMatchingService } from './bank-reconciliation/reconciliation-matching.service';
import { DigitalPaymentMatcherService } from './bank-reconciliation/digital-payment-matcher.service';

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
  imports: [ResponseModule, PrismaModule, S3Module],
  controllers: [
    ChartOfAccountsController,
    JournalEntriesController,
    FiscalPeriodsController,
    AccountingReportsController,
    AccountMappingController,
    BankAccountsController,
    BankTransactionsController,
    ReconciliationController,
    BudgetsController,
    ConsolidationController,
    FixedAssetsController,
    FixedAssetCategoriesController,
  ],
  providers: [
    ModuleFlowGuard,
    ChartOfAccountsService,
    JournalEntriesService,
    JournalEntryFlowService,
    FiscalPeriodsService,
    AccountingReportsService,
    AccountMappingService,
    AutoEntryService,
    AccountingEventsListener,
    BankAccountsService,
    BankTransactionsService,
    ReconciliationService,
    ReconciliationMatchingService,
    DigitalPaymentMatcherService,
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
export class AccountingModule {}
