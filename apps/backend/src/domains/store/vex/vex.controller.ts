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
import { randomUUID } from 'node:crypto';
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
import { SubscriptionAccessService } from '../subscriptions/services/subscription-access.service';
import { UploadAttachmentDto } from '../vexi/dto/ui-result.dto';
import { VexiAttachmentsService } from '../vexi/vexi-attachments.service';
import { VexiConfirmationService } from '../vexi/vexi-confirmation.service';
import { VexiPlanStateService } from '../vexi/vexi-plan-state.service';
import { VexiActivityService } from '../vexi/vexi-activity.service';
import { VexEnabledGuard } from './guards/vex-enabled.guard';
import { ApprovePlanDto } from './dto/approve-plan.dto';
import { ApplyVexStepDto, PlanConversationDto } from './dto/plan-lifecycle.dto';
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
/**
 * TTL de los tokens de un solo uso de `VexiConfirmationService`
 * (`TOKEN_TTL_SECONDS`, 300 s, privado a ese archivo): lo que `expires_in`
 * de la confirmación por paso le dice al cliente.
 */
const CONFIRMATION_TOKEN_TTL_SECONDS = 300;

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
    private readonly subscriptionAccess: SubscriptionAccessService,
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
    const userId = RequestContextService.getContext()?.user_id;
    // Propiedad, estado del plan (`proposed`), `plan_id` y antigüedad de los
    // hashes se validan dentro del servicio, en ese orden y ANTES de leer
    // hashes — un 404 previo filtraría la existencia del plan frente al 403.
    // El servicio también mueve `metadata.plan.status` a `approved`.
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
   * Cancels a plan server-side. `pending` steps become `cancelled`, the plan
   * `rejected`, and the step hashes are deleted so a cancelled plan can never
   * be approved again. 403 when the caller does not own the thread; 409 when
   * the plan already ended (`applied`, `partially_applied`, `rejected`).
   * Same `AiAccessGuard` omission rationale as approve.
   */
  @Post('plans/:id/reject')
  async rejectPlan(
    @Param('id', ParseUUIDPipe) planId: string,
    @Body() dto: PlanConversationDto,
  ) {
    const userId = RequestContextService.getContext()?.user_id;
    const result = await this.planApproval.rejectPlan({
      planId,
      conversationId: dto.conversation_id,
      userId,
    });
    return this.responseService.success(result, 'Plan cancelado');
  }

  /**
   * Mints the single-use confirmation token of ONE irreversible step of an
   * approved plan — what lets a reloaded page (whose in-memory tokens are
   * gone) apply it. The token is minted over the tool+arguments the server
   * persisted for that step, never over client input. Only for the owner, plan
   * `approved`, step irreversible and `pending`.
   */
  @Post('plans/:id/steps/:step_id/confirmation')
  async stepConfirmation(
    @Param('id', ParseUUIDPipe) planId: string,
    @Param('step_id') stepId: string,
    @Body() dto: PlanConversationDto,
  ) {
    const userId = RequestContextService.getContext()?.user_id;
    const step = await this.planApproval.resolveStepForConfirmation({
      planId,
      stepId,
      conversationId: dto.conversation_id,
      userId,
    });
    const token = await this.confirmations.issue(
      step.tool,
      step.arguments,
      userId,
    );
    return this.responseService.success(
      {
        confirmation_token: token,
        expires_in: CONFIRMATION_TOKEN_TTL_SECONDS,
      },
      'Confirmación emitida',
    );
  }

  /**
   * Applies one step of an approved plan.
   *
   * Per-step path (`step_id` present): tool and arguments come from the plan
   * the server persisted, and exactly one of `plan_token` (plan token,
   * reversible steps) / `confirmation_token` (single-use token from
   * `plans/:id/steps/:step_id/confirmation`) authorizes it. Legacy path (no
   * `step_id`): the caller declares `tool` + `arguments` and sends the PLAN
   * token in `confirmation_token` — kept so the current client keeps working.
   *
   * On success the step is executed through the same choke point as every
   * other write (permissions re-checked, audit row), one `vex_agent` quota
   * unit is consumed, the step result is persisted and the plan status
   * recomputed (all steps terminal → `applied`, or `partially_applied` if any
   * failed). Any non-ok plan-token outcome answers `AI_AGENT_005` carrying a
   * FRESH single-use token, so the browser renders the step's own card.
   *
   * `plan_id` comes from the caller (the approve URL it just called), NOT
   * re-resolved from the thread: the internal task plan and the write plan
   * are different systems. Same `AiAccessGuard` omission rationale as the
   * approve handler above.
   */
  @Post('confirmations/apply')
  async applyPlanStep(@Body() dto: ApplyVexStepDto) {
    const userId = RequestContextService.getContext()?.user_id;
    const perStep = dto.step_id !== undefined;

    let tool: string;
    let args: Record<string, any>;
    let planId: string | undefined = dto.plan_id;
    let singleUseToken: string | undefined;
    const conversationId = dto.conversation_id;

    if (perStep) {
      if (
        conversationId === undefined ||
        !dto.plan_id ||
        (dto.plan_token ? 1 : 0) + (dto.confirmation_token ? 1 : 0) !== 1
      ) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Aplicar un paso requiere conversation_id, plan_id, step_id y exactamente uno de plan_token o confirmation_token.',
        );
      }
      const step = await this.planApproval.resolveStepForApply({
        planId: dto.plan_id,
        stepId: dto.step_id!,
        conversationId,
        userId,
      });
      tool = step.tool;
      args = step.arguments;
      if (dto.plan_token) {
        const outcome = await this.planApproval.redeemPlanStep(
          dto.plan_token,
          dto.plan_id,
          userId,
          tool,
          args,
        );
        if (outcome !== 'ok') {
          return this.singleStepFallback(tool, args, userId, outcome);
        }
        singleUseToken = await this.confirmations.issue(tool, args, userId);
      } else {
        // `executeTool` canjea el token y lanza `AI_AGENT_005` si venció, ya se
        // usó o no corresponde a este tool+args: ahí el paso NO se marca fallido.
        singleUseToken = dto.confirmation_token;
      }
    } else {
      if (!dto.tool || !dto.arguments || !dto.confirmation_token) {
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Se requieren tool, arguments y confirmation_token.',
        );
      }
      tool = dto.tool;
      args = dto.arguments as Record<string, any>;
      if (!dto.plan_id) {
        throw new VendixHttpException(
          ErrorCodes.AI_AGENT_005,
          'Esta aplicación necesita el plan aprobado.',
          { reason: 'missing' } as any,
        );
      }
      // Un plan cancelado conserva su token vivo hasta 15 min en Redis: el
      // estado persistido es lo que lo invalida.
      if (conversationId !== undefined) {
        await this.planApproval.assertConversationOwner(
          conversationId,
          userId,
        );
        const persisted = await this.planApproval.getPlan(
          conversationId,
          dto.plan_id,
        );
        if (persisted && persisted.status !== 'approved') {
          throw new VendixHttpException(
            ErrorCodes.SYS_CONFLICT_001,
            'El plan no está aprobado: no se pueden aplicar sus pasos.',
            { reason: 'plan_not_approved', plan_status: persisted.status },
          );
        }
      }
      const outcome = await this.planApproval.redeemPlanStep(
        dto.confirmation_token,
        dto.plan_id,
        userId,
        tool,
        args,
      );
      if (outcome !== 'ok') {
        return this.singleStepFallback(tool, args, userId, outcome);
      }
      singleUseToken = await this.confirmations.issue(tool, args, userId);
    }

    let output: string;
    try {
      output = await this.toolRegistry.executeTool(tool, args, {
        confirmationToken: singleUseToken,
      });
    } catch (err) {
      // Una propuesta/confirmación rechazada no ejecutó nada: el paso sigue
      // pendiente. Cualquier otro fallo sí lo consumió: queda `failed`.
      const isConfirmationRejection =
        err instanceof VendixHttpException &&
        err.errorCode === ErrorCodes.AI_AGENT_005.code;
      if (!isConfirmationRejection && planId && conversationId !== undefined) {
        await this.persistStepResult({
          planId,
          conversationId,
          stepId: dto.step_id,
          tool,
          args,
          outcome: 'failed',
          error: (err as Error)?.message,
        });
      }
      throw err;
    }

    // Cuota post-ejecución exitosa, mismo mecanismo que el loop por tool call.
    await this.consumeVexQuota(planId, dto.step_id ?? tool);

    await this.activity.recordApplied({
      conversationId,
      tool,
      args,
      output,
      agent_key: 'vex',
    });
    const summary = this.applySummary(output);
    await this.activity.recordAppliedNarration({
      conversationId,
      summary,
    });

    if (conversationId !== undefined) {
      try {
        await this.planState.markCurrentChangeStep(
          conversationId,
          'done',
          summary ? summary.slice(0, 300) : undefined,
        );
      } catch (err) {
        this.logger.warn(
          `No se pudo marcar el paso del plan (conversación ${conversationId}): ${(err as Error).message}`,
        );
      }
    }

    const state =
      planId && conversationId !== undefined
        ? await this.persistStepResult({
            planId,
            conversationId,
            stepId: dto.step_id,
            tool,
            args,
            outcome: 'applied',
          })
        : null;

    return this.responseService.success(
      {
        tool,
        output,
        summary,
        step_status: state?.step_status ?? 'applied',
        plan_status: state?.plan_status ?? 'approved',
      },
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
   * Persists a step result without hiding it behind a bookkeeping failure: the
   * write already happened (or already failed), so an error here is logged and
   * the caller answers with what it knows.
   */
  private async persistStepResult(input: {
    planId: string;
    conversationId: number;
    stepId?: string;
    tool: string;
    args: Record<string, any>;
    outcome: 'applied' | 'failed';
    error?: string;
  }) {
    try {
      return await this.planApproval.recordStepResult({
        planId: input.planId,
        conversationId: input.conversationId,
        stepId: input.stepId,
        tool: input.stepId === undefined ? input.tool : undefined,
        args: input.stepId === undefined ? input.args : undefined,
        outcome: input.outcome,
        error: input.error,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo persistir el estado del paso (plan ${input.planId}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * One `vex_agent` unit per executed step, post-success, with the same
   * dedup-keyed Lua counter the loop uses per tool call (`consumeAIQuota`).
   * The metering never breaks an apply that already landed.
   */
  private async consumeVexQuota(
    planId: string | undefined,
    callId: string,
  ): Promise<void> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return;
    try {
      const base =
        RequestContextService.getRequestId() ?? `internal-${randomUUID()}`;
      await this.subscriptionAccess.consumeAIQuota(
        storeId,
        'vex_agent',
        1,
        `${base}:tool:${planId ?? 'plan'}:${callId}`,
      );
    } catch (err) {
      this.logger.warn(
        `vex_agent quota not consumed (store ${storeId}): ${(err as Error).message}`,
      );
    }
  }

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
