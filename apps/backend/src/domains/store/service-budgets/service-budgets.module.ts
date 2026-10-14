import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { ServiceBudgetsController } from './service-budgets.controller';
import { ServiceProposalDecisionController } from './service-proposal-decision.controller';
import { ServiceBudgetsService } from './service-budgets.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ResponseModule, NotificationsModule],
  controllers: [ServiceBudgetsController, ServiceProposalDecisionController],
  providers: [ServiceBudgetsService],
  exports: [ServiceBudgetsService],
})
export class ServiceBudgetsModule {}
