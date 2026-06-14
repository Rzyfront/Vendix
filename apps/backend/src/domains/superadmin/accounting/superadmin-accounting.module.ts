import { Module } from '@nestjs/common';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PlatformOrgService } from '../../../common/services/platform-org.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

import { ChartOfAccountsController } from './chart-of-accounts/chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts/chart-of-accounts.service';

import { FiscalPeriodsController } from './fiscal-periods/fiscal-periods.controller';
import { FiscalPeriodsService } from './fiscal-periods/fiscal-periods.service';

import { AccountMappingsController } from './account-mappings/account-mappings.controller';
import { AccountMappingsService } from './account-mappings/account-mappings.service';

import { JournalEntriesController } from './journal-entries/journal-entries.controller';
import { JournalEntriesService } from './journal-entries/journal-entries.service';

import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [
    ChartOfAccountsController,
    FiscalPeriodsController,
    AccountMappingsController,
    JournalEntriesController,
    ReportsController,
  ],
  providers: [
    ChartOfAccountsService,
    FiscalPeriodsService,
    AccountMappingsService,
    JournalEntriesService,
    ReportsService,
    PlatformOrgService,
    GlobalPrismaService,
  ],
  exports: [
    ChartOfAccountsService,
    FiscalPeriodsService,
    AccountMappingsService,
    JournalEntriesService,
    ReportsService,
  ],
})
export class SuperadminAccountingModule {}
