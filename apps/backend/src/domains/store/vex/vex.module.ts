import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineModule } from '../../../ai-engine/ai-engine.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { VexiModule } from '../vexi/vexi.module';
import { VexiActivityService } from '../vexi/vexi-activity.service';
import { VexController } from './vex.controller';
import { VexEnabledGuard } from './guards/vex-enabled.guard';
import { PlanApprovalService } from './services/plan-approval.service';
import { VexBlockService } from './services/vex-block.service';
import { VexActivityFeedService } from './services/vex-activity-feed.service';

/**
 * Vex: whole-plan approval, UI blocks and the business log.
 *
 * `VexiModule` is imported for `VexiPlanStateService` (plan identity at
 * approve/apply time); `VexiConfirmationService` and `VexiAttachmentsService`
 * come from the global `AIEngineModule`. `VexiActivityService` is provided
 * here as its own instance — it is stateless (Prisma + logger) and
 * `VexiModule` does not export it, so sharing the instance would require
 * editing that module.
 *
 * Deliberately NO `onModuleInit` tool registration: wiring (registry,
 * agent-loop hooks, module mount) is owned by wave 2. The `vex-blocks`
 * factory declares only.
 */
@Module({
  imports: [
    PrismaModule,
    ResponseModule,
    AIEngineModule,
    SubscriptionsModule,
    VexiModule,
  ],
  controllers: [VexController],
  providers: [
    PlanApprovalService,
    VexBlockService,
    VexActivityFeedService,
    VexEnabledGuard,
    VexiActivityService,
  ],
  exports: [PlanApprovalService, VexBlockService, VexActivityFeedService],
})
export class VexModule {}
