import { Module } from '@nestjs/common';
import { AccountsPayableController } from './accounts-payable.controller';
import { AccountsPayableService } from './accounts-payable.service';
import { ApAgingService } from './services/ap-aging.service';
import { ApSchedulingService } from './services/ap-scheduling.service';
import { ApBankExportService } from './services/ap-bank-export.service';
import { ApEventsListener } from './listeners/ap-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AccountsPayableController],
  providers: [
    AccountsPayableService,
    ApAgingService,
    ApSchedulingService,
    ApBankExportService,
    ApEventsListener,
  ],
  exports: [AccountsPayableService],
})
export class AccountsPayableModule {}
