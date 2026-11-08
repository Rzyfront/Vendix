import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmailModule } from '../../../email/email.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { WorkflowsOpsController } from './workflows-ops.controller';
import { WorkflowsOpsAlertsService } from './workflows-ops-alerts.service';
import { WorkflowsOpsMetricsService } from './workflows-ops-metrics.service';

@Module({
  imports: [ConfigModule, EmailModule, PrismaModule, ResponseModule],
  controllers: [WorkflowsOpsController],
  providers: [WorkflowsOpsMetricsService, WorkflowsOpsAlertsService],
})
export class WorkflowsOpsModule {}
