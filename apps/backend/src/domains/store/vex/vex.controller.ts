import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ResponseService } from '../../../common/responses/response.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import {
  AiAccessGuard,
  RequireAIFeature,
} from '../subscriptions/guards/ai-access.guard';
import { AIFeatureKey } from '../subscriptions/types/access.types';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { ApplyConfirmationDto } from '../vexi/dto/apply-confirmation.dto';
import { UploadAttachmentDto } from '../vexi/dto/ui-result.dto';
import { VexiAttachmentsService } from '../vexi/vexi-attachments.service';
import { VexiConfirmationService } from '../vexi/vexi-confirmation.service';
import { VexiPlanStateService } from '../vexi/vexi-plan-state.service';
import { VexiActivityService } from '../vexi/vexi-activity.service';
import { VexEnabledGuard } from './guards/vex-enabled.guard';
import { ApprovePlanDto } from './dto/approve-plan.dto';
import {
  BlockInteractionDto,
} from './dto/block-interaction.dto';
import {
  PLAN_TOKEN_TTL_SECONDS,
  PlanApprovalService,
} from './services/plan-approval.service';
import { VexBlockService } from './services/vex-block.service';
import { VexActivityFeedService } from './services/vex-activity-feed.service';

/**
 * Vex's surface: whole-plan approval, plan-token applies, UI blocks, the
 * business log and attachments.
 *
 * Restricted to owner and admin behind the store's own `vex.enabled` switch —
 * same shape as `VexiController`, different agent. Each handler documents its
 * own gating decision so a later reader does not "fix" the omissions.
 */
@Controller('store/vex')
@UseGuards(RolesGuard, VexEnabledGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class VexController {
  private readonly logger = new Logger(VexController.name);

  constructor(
    private readonly responseService: ResponseService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly planApproval: PlanApprovalService,
    private readonly confirmations: VexiConfirmationService,
    private readonly planState: VexiPlanStateService,
    private readonly activity: VexiActivityService,
    private readonly blocks: VexBlockService,
    private readonly feed: VexActivityFeedService,
    private readonly attachments: VexiAttachmentsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Approves a whole plan with one click and mints its single-use token.
   *
   * The pre-check only proves the thread holds a proposed write plan (server
   * step hashes exist); the rest is owned by `PlanApprovalService.approvePlan`,
   * which verifies the caller owns the thread (403 otherwise) and each client
   * step against the hashes the proposing turn persisted server-side — the
   * body only SELECTS the subset, it never declares the approved content. The
   * step hashes are written by the loop at proposal time, deliberately NOT
   * here: persisting client steps at approve time would let altered arguments
   * bind their own token. Deliberately NOT behind `AiAccessGuard`: the token
   * was proposed inside an already-gated turn, no provider call happens here,
   * and re-asking the plan question could strand an approval the person
   * already reviewed. Terminal-state subscriptions are still enforced on this
   * POST by the global `StoreOperationsGuard`.
   *
   * NOT gated on `agent_plan`: the internal task list and the write plan are
   * different systems — a Vex turn proposes writes without one (the loop does
   * not even receive `params.plan`), so requiring it 404s every approval.
   * Hallazgo live E2E-1 (2026-10-01).
   */
  @Post('plans/:id/approve')
  async approvePlan(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: ApprovePlanDto,
  ) {
    const hashes = await this.planState.getStepHashes(dto.conversation_id);
    if (hashes.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Ese plan ya no está activo en esta conversación.',
      );
    }

    const userId = RequestContextService.getContext()?.user_id;
    const approved = await this.planApproval.approvePlan({
      planId,
      conversationId: dto.conversation_id,
      userId,
      clientSteps: dto.steps.map((s) => ({
        order: s.order,
        tool: s.tool,
        args: s.arguments as Record<string, any>,
      })),
    });

    // Evento y no llamada directa: `AIChatModule` importa `VexModule`, así
    // que importar al revés sería circular. `AIChatService` mueve
    // `metadata.plan.status` a `approved` para que recargar muestre la
    // tarjeta con su estado (remediación paso 6, cableado E2E-1).
    this.eventEmitter.emit('ai.vex.plan_approved', {
      conversation_id: dto.conversation_id,
      plan_id: planId,
      user_id: userId,
    });

    return this.responseService.success(
      {
        plan_id: planId,
        plan_token: approved.plan_token,
        expires_in_seconds: PLAN_TOKEN_TTL_SECONDS,
        covered_steps: approved.covered_steps,
        reconfirm_steps: approved.reconfirm_steps,
        ignored_steps: approved.ignored_steps,
      },
      approved.reconfirm_steps.length > 0
        ? 'Plan aprobado. Los pasos irreversibles pedirán su propia confirmación.'
        : 'Plan aprobado.',
    );
  }

  /**
   * Applies one step of an approved plan. `confirmation_token` carries the
   * PLAN token, not a single-use one.
   *
   * On `ok` the step is consumed (it can never run twice under this token)
   * and executed through the same choke point as every other write: a
   * single-use token is minted internally for exactly this tool+args and
   * redeemed immediately, so permissions are re-checked on the way through
   * and the handler re-verifies its preconditions. The plan token proves the
   * person approved the bundle; the inner token proves this exact step.
   *
   * Any other outcome answers `AI_AGENT_005` carrying a FRESH single-use
   * token in the same details shape the registry uses — the browser renders
   * the step's own card and the person confirms it individually, through the
   * Vexi apply endpoint. Same `AiAccessGuard` omission rationale as the
   * approve handler above.
   *
   * `plan_id` comes from the caller (the approve URL it just called), NOT
   * re-resolved from the thread: the internal task plan and the write plan
   * are different systems. Hallazgo live E2E-1 (2026-10-01).
   */
  @Post('confirmations/apply')
  async applyPlanStep(@Body() dto: ApplyConfirmationDto) {
    const userId = RequestContextService.getContext()?.user_id;
    const args = dto.arguments as Record<string, any>;
    if (!dto.plan_id) {
      throw new VendixHttpException(
        ErrorCodes.AI_AGENT_005,
        'Esta aplicación necesita el plan aprobado.',
        { reason: 'missing' } as any,
      );
    }

    const outcome = await this.planApproval.redeemPlanStep(
      dto.confirmation_token,
      dto.plan_id,
      userId,
      dto.tool,
      args,
    );

    if (outcome !== 'ok') {
      return this.singleStepFallback(dto.tool, args, userId, outcome);
    }

    const singleUse = await this.confirmations.issue(dto.tool, args, userId);
    const output = await this.toolRegistry.executeTool(dto.tool, args, {
      confirmationToken: singleUse,
    });

    await this.activity.recordApplied({
      conversationId: dto.conversation_id,
      tool: dto.tool,
      args: dto.arguments,
      output,
      agent_key: 'vex',
    });
    const summary = this.applySummary(output);
    await this.activity.recordAppliedNarration({
      conversationId: dto.conversation_id,
      summary,
    });

    if (dto.conversation_id) {
      try {
        await this.planState.markCurrentChangeStep(
          dto.conversation_id,
          'done',
          summary ? summary.slice(0, 300) : undefined,
        );
      } catch (err) {
        this.logger.warn(
          `No se pudo marcar el paso del plan (conversación ${dto.conversation_id}): ${(err as Error).message}`,
        );
      }
    }

    return this.responseService.success(
      { tool: dto.tool, output, summary },
      'Paso del plan aplicado',
    );
  }

  /**
   * One UI block. Signed URLs for image/file kinds are minted fresh per read
   * and never persisted — see `VexBlockService`.
   */
  @Get('blocks/:id')
  async getBlock(@Param('id', ParseUUIDPipe) id: string) {
    const block = await this.blocks.getUiBlock(id);
    return this.responseService.success(block, 'Bloque');
  }

  /**
   * Stores what the person did on a block (row selection, chart point) so the
   * next turn receives it as context. Deliberately NOT behind `AiAccessGuard`:
   * rejecting it saves no provider spend and would only blind the next turn.
   */
  @Post('blocks/:id/interaction')
  async blockInteraction(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BlockInteractionDto,
  ) {
    // The panel sends the payload under kind-specific keys; `payload` stays
    // the canonical stored shape.
    const payload =
      dto.payload ??
      (dto.selection !== undefined
        ? { selection: dto.selection }
        : dto.point !== undefined
          ? { point: dto.point }
          : dto.filter !== undefined
            ? { filter: dto.filter }
            : {});
    const block = await this.blocks.recordInteraction(id, {
      type: dto.type,
      payload,
    });
    return this.responseService.success(block, 'Interacción registrada');
  }

  /**
   * The business log: domain notifications plus applied Vex/Vexi actions.
   * Pure read of this store's own state — no AI gate.
   */
  @Get('activity-feed')
  async activityFeed(@Query('limit') limit?: string) {
    const entries = await this.feed.list(limit ? Number(limit) : undefined);
    return this.responseService.success(entries, 'Bitácora empresarial');
  }

  /**
   * Stages a document so a later Vex turn can hand it to a vision application.
   * Same contract as the Vexi twin: the response is a handle, never a URL.
   *
   * Gated on `vex_agent`, the feature whose caps budget Vex's consumption.
   * Until the sibling step registers that key in `access.types.ts` the guard
   * no-ops (unknown keys pass) and only roles + the store toggle protect this
   * — the cast below is removed with that step, not before. The guard stays
   * declared before the interceptor so a blocked request is rejected before
   * Multer buffers the file.
   */
  @Post('attachments')
  @UseGuards(AiAccessGuard)
  @RequireAIFeature('vex_agent' as AIFeatureKey)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
  ) {
    const stored = await this.attachments.store(file, dto.conversation_id);
    return this.responseService.created(stored, 'Documento recibido');
  }

  // ── internals ─────────────────────────────────────────────────────────

  /**
   * Every non-ok plan outcome becomes the step's own confirmation proposal,
   * in the exact details shape `executeTool()` uses — so the browser renders
   * one card component for both paths and the person confirms the step alone.
   */
  private async singleStepFallback(
    tool: string,
    args: Record<string, any>,
    userId: number | undefined,
    outcome: string,
  ): Promise<never> {
    const token = await this.confirmations.issue(tool, args, userId);
    const message =
      outcome === 'irreversible'
        ? `El paso "${tool}" es irreversible y necesita su propia confirmación aunque el plan esté aprobado.`
        : outcome === 'unknown_step'
          ? `Los argumentos de "${tool}" cambiaron después de aprobar el plan. Revísalos y confirma este paso por separado.`
          : outcome === 'replayed'
            ? `El paso "${tool}" ya se ejecutó con esta aprobación.`
            : `La aprobación del plan expiró o ya se usó. Vuelve a aprobar el plan.`;
    throw new VendixHttpException(
      ErrorCodes.AI_AGENT_005,
      message,
      { tool, arguments: args, confirmation_token: token } as any,
    );
  }

  /**
   * The human sentence inside a tool's applied output — same extraction as
   * `VexiController.applySummary`, so spoken and shown acknowledgements stay
   * one string by construction.
   */
  private applySummary(output: string): string | null {
    try {
      const parsed = JSON.parse(output) as { summary?: unknown };
      return typeof parsed?.summary === 'string' && parsed.summary.trim()
        ? parsed.summary.trim()
        : null;
    } catch {
      const text = output?.trim();
      return text && text.length <= 400 ? text : null;
    }
  }
}
