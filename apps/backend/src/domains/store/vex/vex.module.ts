import { Module, OnModuleInit } from '@nestjs/common';
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
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createVexBlockTools } from '../../../ai-engine/tools/domains/vex-blocks.tools';

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
 * Owns the `vex_blocks` tool family: no other domain holds `VexBlockService`,
 * so this is the only module that can register it without a cross-import.
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
export class VexModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly blocks: VexBlockService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(createVexBlockTools({ blocks: this.blocks }));
  }
}
