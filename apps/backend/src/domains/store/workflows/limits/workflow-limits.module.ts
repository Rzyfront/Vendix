import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { WorkflowLimitsService } from './workflow-limits.service';

/**
 * Plan limits of Flows (P7.1), as its own module so the documents domain
 * (storage on upload) can enforce them without importing `WorkflowsModule`.
 * `SubscriptionResolverService` comes from the global `SubscriptionsModule`.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [WorkflowLimitsService],
  exports: [WorkflowLimitsService],
})
export class WorkflowLimitsModule {}
