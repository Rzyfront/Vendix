import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { ProviderCommissionDailySummaryController } from './provider-commission-daily-summary.controller';
import { UserCommissionsController } from './user-commissions.controller';
import { CommissionsService } from './commissions.service';
import { CommissionCalculatorService } from './services/commission-calculator.service';
import { CommissionEventsListener } from './services/commission-events.listener';
import { ProviderCommissionsService } from './services/provider-commissions.service';
import { ProviderCommissionEventsListener } from './services/provider-commission-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [
    CommissionsController,
    ProviderCommissionDailySummaryController,
    UserCommissionsController,
  ],
  providers: [
    CommissionsService,
    CommissionCalculatorService,
    CommissionEventsListener,
    ProviderCommissionsService,
    ProviderCommissionEventsListener,
  ],
  exports: [
    CommissionsService,
    CommissionCalculatorService,
    ProviderCommissionsService,
  ],
})
export class CommissionsModule {}
