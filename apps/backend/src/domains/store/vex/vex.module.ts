import { Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineModule } from '../../../ai-engine/ai-engine.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { VexiModule } from '../vexi/vexi.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VexiActivityService } from '../vexi/vexi-activity.service';
import { VexController } from './vex.controller';
import { AgentHistoryController } from './agent-history.controller';
import { AgentHistoryService } from './services/agent-history.service';
import { VexEnabledGuard } from './guards/vex-enabled.guard';
import { PlanApprovalService } from './services/plan-approval.service';
import { VexBlockService } from './services/vex-block.service';
import { VexActivityFeedService } from './services/vex-activity-feed.service';
import { VexSuggestionsService } from './services/vex-suggestions.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createComputeTools } from '../../../ai-engine/tools/domains/compute.tools';
import { createAnalysisTools } from '../../../ai-engine/tools/domains/code-execution.tools';
import { SandboxAnalysisBrokerService } from '../../../ai-engine/sandbox/sandbox-analysis-broker.service';
import { AIEntitlementsResolverService } from '../subscriptions/services/ai-entitlements-resolver.service';
import { createVexBlockTools } from '../../../ai-engine/tools/domains/vex-blocks.tools';
import { createWriteBatchTools } from '../../../ai-engine/tools/domains/write-batch.tools';
import { WriteBatchService } from './services/write-batch.service';
import { WriteBatchExecutorService } from './services/write-batch-executor.service';
import { WriteBatchCompensationService } from './services/write-batch-compensation.service';
import { VexiVoiceConfirmationService } from '../vexi/vexi-voice-confirmation.service';
import { SubscriptionAccessService } from '../subscriptions/services/subscription-access.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { randomUUID } from 'node:crypto';

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
    // `VexiActivityService` pushes applied actions over the notifications SSE.
    NotificationsModule,
  ],
  controllers: [VexController, AgentHistoryController],
  providers: [
    PlanApprovalService,
    VexBlockService,
    VexActivityFeedService,
    AgentHistoryService,
    VexSuggestionsService,
    WriteBatchService,
    WriteBatchExecutorService,
    WriteBatchCompensationService,
    VexEnabledGuard,
    VexiActivityService,
  ],
  exports: [PlanApprovalService, VexBlockService, VexActivityFeedService],
})
export class VexModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly blocks: VexBlockService,
    private readonly voiceConfirmations: VexiVoiceConfirmationService,
    private readonly planApproval: PlanApprovalService,
    private readonly access: SubscriptionAccessService,
    private readonly writeBatches: WriteBatchService,
    private readonly analysisRunner: SandboxAnalysisBrokerService,
    private readonly entitlements: AIEntitlementsResolverService,
  ) {}

  onModuleInit(): void {
    this.voiceConfirmations.registerVexReceiptSink(async (proposal, result) => {
      const context = RequestContextService.asyncLocalStorage.getStore()!;
      // Same post-success unit/dedupe convention as VexController.applyPlanStep.
      if (result.outcome === 'applied') {
        try {
          await this.access.consumeAIQuota(
            context.store_id!,
            'vex_agent',
            1,
            `${context.request_id ?? `internal-${randomUUID()}`}:tool:${proposal.planId ?? 'plan'}:${proposal.tool}`,
          );
        } catch {
          /* A metering outage must not hide an already-applied receipt. */
        }
      }
      if (proposal.planId)
        return this.planApproval.recordStepResult({
          planId: proposal.planId,
          conversationId: proposal.conversationId,
          tool: proposal.tool,
          args: proposal.arguments,
          outcome: result.outcome,
          error: result.error,
        });
      // A `single-` card has no server plan to persist. Its applied receipt says
      // so explicitly, as runSingleUseApply does for click; a non-applied one is
      // already folded fail-closed by VexiController.applyConfirmation.
      return result.outcome === 'applied'
        ? { step_status: 'applied' as const, plan_status: 'applied' as const }
        : null;
    });
    this.toolRegistry.registerMany(
      createVexBlockTools({ blocks: this.blocks }),
    );
    this.toolRegistry.registerMany(createComputeTools());
    // F9/T52: code analysis over this conversation's blocks, gated by plan.
    this.toolRegistry.registerMany(
      createAnalysisTools({
        runner: this.analysisRunner,
        blocks: this.blocks,
        entitlements: {
          codeAnalysisEnabled: async (storeId) => {
            try {
              const { rows } = await this.entitlements.resolveForStore(storeId);
              return rows.some(
                (r) =>
                  r.agent_key === 'vex' &&
                  r.capability_key === 'code_analysis' &&
                  r.enabled,
              );
            } catch {
              return false; // fail closed
            }
          },
        },
      }),
    );
    // F5/T34: the batch circuit's entry; it proposes, the card approves.
    this.toolRegistry.registerMany(
      createWriteBatchTools({ batches: this.writeBatches }),
    );
  }
}
