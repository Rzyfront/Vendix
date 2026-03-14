import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

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

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [
    ChartOfAccountsController,
    JournalEntriesController,
    FiscalPeriodsController,
    AccountingReportsController,
    AccountMappingController,
  ],
  providers: [
    ChartOfAccountsService,
    JournalEntriesService,
    JournalEntryFlowService,
    FiscalPeriodsService,
    AccountingReportsService,
    AccountMappingService,
    AutoEntryService,
    AccountingEventsListener,
  ],
  exports: [
    ChartOfAccountsService,
    JournalEntriesService,
    JournalEntryFlowService,
    FiscalPeriodsService,
    AccountingReportsService,
    AccountMappingService,
    AutoEntryService,
  ],
})
export class AccountingModule {}
