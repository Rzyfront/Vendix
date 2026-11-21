import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { AuditService } from '../../../../common/audit/audit.service';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import type { ToolExecutionContext } from '../../../../ai-engine/tools/interfaces/tool.interface';
import { USER_NOTICES } from '../../../../ai-engine/agent-execution.contract';
import { VexiConfirmationService } from '../../vexi/vexi-confirmation.service';
import { VexiPlanStateService } from '../../vexi/vexi-plan-state.service';
import { VexiActivityService } from '../../vexi/vexi-activity.service';
import { SubscriptionAccessService } from '../../subscriptions/services/subscription-access.service';
import { WriteBatchService, writeBatchArgsHash } from './write-batch.service';
import {
  WRITE_BATCH_COMPENSATION_OUTPUT_MAX,
  writeBatchOperationId,
  type WriteBatchStatus,
  type WriteBatchStepRecord,
  type WriteBatchSummary,
  type WriteBatchView,
} from './write-batch.types';

export interface WriteBatchApprovalResult {
  batch: WriteBatchView;
  /** True when this call lost the atomic claim (double click / second tab). */
  replayed: boolean;
}

/** Audit action of a finished batch (`audit_logs.action` is a free string). */
export const AI_WRITE_BATCH_EXECUTED = 'AI_WRITE_BATCH_EXECUTED';
export const AI_WRITE_BATCH_RESOURCE = 'ai_agent_write_batches';

export const BATCH_STEP_MESSAGES = {
  permission_lost: 'Tu rol ya no permite este cambio.',
  tool_missing: 'Este cambio ya no está disponible.',
  args_mismatch:
    'El cambio guardado no coincide con lo que aprobaste; no se aplicó.',
  confirmation: 'No se pudo autorizar este cambio. Propónlo de nuevo.',
  generic: 'No se pudo aplicar este cambio.',
} as const;

/**
 * Pure: the D2 sentence and counters of a batch, from its steps AFTER the run.
 * The message is chosen by what happened, never by what was planned:
 *  - an unknown step wins (nothing may be retried before it is reviewed);
 *  - a failure after at least one applied step reads "hasta el paso N";
 *  - a failure before any applied step reads "ningún cambio".
 */
export function summarizeWriteBatch(
  steps: Pick<
    WriteBatchStepRecord,
    'order' | 'status' | 'compensable'
  >[],
): WriteBatchSummary {
  const count = (status: WriteBatchStepRecord['status']) =>
    steps.filter((s) => s.status === status).length;
  const applied = steps.filter((s) => s.status === 'applied');
  const unknownStep = steps.find((s) => s.status === 'unknown');
  const failed = count('failed');
  const appliedThrough = applied.reduce((max, s) => Math.max(max, s.order), 0);

  let message: string;
  if (unknownStep) {
    message = `El paso ${unknownStep.order} quedó sin verificar; revisa antes de reintentar. El resto se omitió.`;
  } else if (failed > 0) {
    message =
      applied.length > 0
        ? `Se aplicó hasta el paso ${appliedThrough}, el resto se omitió.`
        : 'No se aplicó ningún cambio.';
  } else if (applied.length === 0) {
    message = 'No se aplicó ningún cambio.';
  } else if (applied.length === 1) {
    message = 'Se aplicó el cambio.';
  } else {
    message = `Se aplicaron los ${applied.length} cambios.`;
  }

  return {
    applied: applied.length,
    failed,
    unknown: count('unknown'),
    skipped: count('skipped'),
    unselected: count('unselected'),
    compensable: applied.filter((s) => s.compensable).length,
    applied_through_order: appliedThrough,
    message,
  };
}

/** Dedupe key of the batch's single metering unit (one turn, N4). */
export function writeBatchQuotaRequestId(batchId: string): string {
  return `vex-batch:${batchId}:turn`;
}

/** Terminal batch status from the post-run steps. */
export function writeBatchTerminalStatus(
  steps: Pick<WriteBatchStepRecord, 'status'>[],
): WriteBatchStatus {
  if (steps.some((s) => s.status === 'unknown')) return 'unknown_effect';
  const applied = steps.filter((s) => s.status === 'applied').length;
  if (steps.some((s) => s.status === 'failed')) {
    return applied > 0 ? 'partially_applied' : 'failed';
  }
  return applied > 0 ? 'applied' : 'failed';
}

type StepOutcome =
  | { outcome: 'applied'; summary: string; output: string }
  | { outcome: 'failed' | 'unknown'; error: string };

/**
 * T35 — single approval + sequential executor of a Vex write batch.
 *
 * Safety model:
 *  - ONE conditional update claims the batch (`proposed` → `executing`); only
 *    the winner executes, so a double click or a second tab can never repeat a
 *    write.
 *  - Only the server-stored steps and arguments run; `stepIds` merely selects.
 *  - Every step goes through the same circuit as `VexController.applyPlanStep`
 *    (single-use token → durable effect → registry), so permissions, the
 *    confirmation binding and the unknown-effect ledger are re-validated at
 *    execution time.
 *  - No step is ever left `pending` / `running`.
 *  - No action quota is consumed (N4): a batch costs messages/tokens like any
 *    turn. The count of applied steps is recorded in the summary/audit only.
 */
@Injectable()
export class WriteBatchExecutorService {
  private readonly logger = new Logger(WriteBatchExecutorService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly batches: WriteBatchService,
    private readonly toolRegistry: AIToolRegistry,
    private readonly confirmations: VexiConfirmationService,
    private readonly planState: VexiPlanStateService,
    private readonly activity: VexiActivityService,
    private readonly audit: AuditService,
    private readonly access: SubscriptionAccessService,
  ) {}

  async approve(input: {
    batchId: string;
    userId: number | undefined;
    stepIds: string[];
  }): Promise<WriteBatchApprovalResult> {
    const row = await this.batches.loadOwned(input.batchId, input.userId);
    const now = new Date();

    const claim = await this.prisma.ai_agent_write_batches.updateMany({
      where: {
        id: input.batchId,
        status: 'proposed',
        expires_at: { gt: now },
      },
      data: {
        status: 'executing',
        approved_at: now,
        approved_by_user_id: input.userId,
        started_at: now,
        version: { increment: 1 },
      },
    });
    if (claim.count === 0) {
      // Lost the claim: another approval is running or finished, or the batch
      // expired / was rejected. Nothing executes; the view says which.
      return {
        batch: await this.batches.getView(input.batchId, input.userId),
        replayed: true,
      };
    }

    const selected = new Set(
      (input.stepIds ?? []).filter((id) => typeof id === 'string'),
    );
    const steps: WriteBatchStepRecord[] = (
      (row.steps ?? []) as WriteBatchStepRecord[]
    )
      .map((s) => ({ ...s }))
      .sort((a, b) => a.order - b.order);
    for (const step of steps) {
      if (!selected.has(step.step_id)) step.status = 'unselected';
    }
    const runnable = steps.filter((s) => s.status === 'pending');

    if (runnable.length === 0) {
      // Nothing selected: the batch is rejected, not "executed with nothing".
      for (const step of steps) step.status = 'cancelled';
      await this.finalize(input.batchId, 'rejected', steps, {
        ...summarizeWriteBatch(steps),
        message: 'No se aplicó ningún cambio.',
      });
      return {
        batch: await this.batches.getView(input.batchId, input.userId),
        replayed: false,
      };
    }

    const state: { running?: WriteBatchStepRecord; dispatching: boolean } = {
      dispatching: false,
    };
    // Raw outputs of applied steps, for the activity receipts (never persisted
    // in the batch row beyond the compensation budget).
    const outputs = new Map<string, string>();
    try {
      await this.persistSteps(input.batchId, steps);
      let stopped = false;
      for (const step of runnable) {
        if (stopped) {
          step.status = 'skipped';
          continue;
        }
        step.status = 'running';
        step.started_at = new Date().toISOString();
        step.operation_id = writeBatchOperationId(input.batchId, step.step_id);
        state.running = step;
        await this.persistSteps(input.batchId, steps);

        const outcome = await this.runStep(row, step, input.userId, state);
        state.running = undefined;
        step.finished_at = new Date().toISOString();
        if (outcome.outcome === 'applied') {
          step.status = 'applied';
          step.result_summary = outcome.summary;
          outputs.set(step.step_id, outcome.output);
        } else {
          step.status = outcome.outcome;
          step.error = outcome.error;
          stopped = true;
        }
        await this.persistSteps(input.batchId, steps);
      }
    } catch (error) {
      // Unexpected failure (e.g. the ledger write): the in-memory state is the
      // truth. A step caught mid-dispatch is `unknown` — its write may have
      // landed — never silently failed or applied.
      this.logger.error(
        `Write batch ${input.batchId} aborted: ${(error as Error)?.message}`,
      );
      const running = state.running;
      if (running && running.status === 'running') {
        running.status = state.dispatching ? 'unknown' : 'failed';
        running.error = state.dispatching
          ? USER_NOTICES.unknown_effect
          : BATCH_STEP_MESSAGES.generic;
        running.finished_at = new Date().toISOString();
      }
    } finally {
      // Guarantee: no step leaves in `pending` / `running`.
      for (const step of steps) {
        if (step.status === 'running') {
          step.status = 'unknown';
          step.error = step.error ?? USER_NOTICES.unknown_effect;
        } else if (step.status === 'pending') {
          step.status = 'skipped';
        }
      }
    }

    const terminal = writeBatchTerminalStatus(steps);
    const summary = summarizeWriteBatch(steps);
    await this.finalize(input.batchId, terminal, steps, summary);
    await this.afterFinish(row, input.userId, terminal, steps, summary, outputs);

    return {
      batch: await this.batches.getView(input.batchId, input.userId),
      replayed: false,
    };
  }

  async reject(input: {
    batchId: string;
    userId: number | undefined;
  }): Promise<WriteBatchApprovalResult> {
    const row = await this.batches.loadOwned(input.batchId, input.userId);
    const steps = ((row.steps ?? []) as WriteBatchStepRecord[]).map((s) => ({
      ...s,
      status: 'cancelled' as const,
    }));
    const claim = await this.prisma.ai_agent_write_batches.updateMany({
      where: { id: input.batchId, status: 'proposed' },
      data: {
        status: 'rejected',
        steps: steps as any,
        finished_at: new Date(),
        version: { increment: 1 },
      },
    });
    return {
      batch: await this.batches.getView(input.batchId, input.userId),
      replayed: claim.count === 0,
    };
  }

  // ── one step ──────────────────────────────────────────────────────────

  private async runStep(
    row: { id: string; conversation_id: number | null },
    step: WriteBatchStepRecord,
    userId: number | undefined,
    state: { dispatching: boolean },
  ): Promise<StepOutcome> {
    const registered = this.toolRegistry.get(
      this.toolRegistry.canonicalName(step.tool),
    );
    if (!registered) {
      return { outcome: 'failed', error: BATCH_STEP_MESSAGES.tool_missing };
    }
    // Defensive: the row is server-written, but a corrupted/edited step must
    // never run with arguments other than the ones that were hashed.
    if (step.args_hash !== writeBatchArgsHash(step.tool, step.arguments)) {
      return { outcome: 'failed', error: BATCH_STEP_MESSAGES.args_mismatch };
    }

    step.compensable = false;
    step.compensation_snapshot = undefined;
    step.compensation_output = undefined;
    if (registered.compensate) {
      try {
        const snapshot = await registered.compensate.capture(
          step.arguments,
          this.executionContext(),
        );
        if (snapshot !== null && snapshot !== undefined) {
          step.compensation_snapshot = snapshot;
          step.compensable = true;
        }
      } catch (error) {
        // Capture failed: the write still runs, but undo is not offered.
        this.logger.warn(
          `Capture failed for ${step.tool} (${row.id}/${step.step_id}): ${(error as Error)?.message}`,
        );
      }
    }

    try {
      const token = await this.confirmations.issue(
        step.tool,
        step.arguments,
        userId,
      );
      state.dispatching = true;
      const execution = await this.planState.applyDurableEffect(
        {
          conversationId: row.conversation_id ?? undefined,
          stepId: writeBatchOperationId(row.id, step.step_id),
          batchId: row.id,
          tool: step.tool,
          args: step.arguments,
        },
        () =>
          this.toolRegistry.executeTool(step.tool, step.arguments, {
            confirmationToken: token,
          }),
      );
      state.dispatching = false;

      const result = execution.result;
      if (
        !result ||
        result.status !== 'ok' ||
        result.effect_status !== 'applied'
      ) {
        const uncertain =
          !result ||
          result.status === 'unknown_effect' ||
          result.effect_status !== 'not_applied';
        step.compensable = false;
        step.compensation_snapshot = undefined;
        return uncertain
          ? { outcome: 'unknown', error: USER_NOTICES.unknown_effect }
          : { outcome: 'failed', error: USER_NOTICES.apply_failed };
      }
      if (step.compensable) {
        step.compensation_output = String(execution.output ?? '').slice(
          0,
          WRITE_BATCH_COMPENSATION_OUTPUT_MAX,
        );
      }
      return {
        outcome: 'applied',
        summary: this.humanSummary(execution.output, step.label),
        output: String(execution.output ?? ''),
      };
    } catch (error) {
      state.dispatching = false;
      step.compensable = false;
      step.compensation_snapshot = undefined;
      return { outcome: 'failed', error: this.humanError(error) };
    }
  }

  private executionContext(): ToolExecutionContext {
    const ctx = RequestContextService.getContext();
    return {
      organization_id: ctx?.organization_id,
      store_id: ctx?.store_id,
      user_id: ctx?.user_id,
      roles: ctx?.roles,
    };
  }

  private humanError(error: unknown): string {
    if (error instanceof VendixHttpException) {
      if (error.errorCode === ErrorCodes.AI_AGENT_004.code) {
        return BATCH_STEP_MESSAGES.permission_lost;
      }
      if (error.errorCode === ErrorCodes.AI_AGENT_005.code) {
        return BATCH_STEP_MESSAGES.confirmation;
      }
    }
    return BATCH_STEP_MESSAGES.generic;
  }

  /** The tool's own `summary` line when short and textual; else the label. */
  private humanSummary(output: string, label: string): string {
    try {
      const parsed = JSON.parse(output) as { summary?: unknown };
      if (
        typeof parsed?.summary === 'string' &&
        parsed.summary.trim() &&
        parsed.summary.length <= 200
      ) {
        return parsed.summary.trim();
      }
    } catch {
      /* not JSON: fall through to the label */
    }
    return `${label}: aplicado.`;
  }

  // ── persistence ───────────────────────────────────────────────────────

  /** Single writer: only the claim winner updates, and only while executing. */
  private async persistSteps(
    batchId: string,
    steps: WriteBatchStepRecord[],
  ): Promise<void> {
    await this.prisma.ai_agent_write_batches.updateMany({
      where: { id: batchId, status: 'executing' },
      data: { steps: steps as any, version: { increment: 1 } },
    });
  }

  private async finalize(
    batchId: string,
    status: WriteBatchStatus,
    steps: WriteBatchStepRecord[],
    summary: WriteBatchSummary,
  ): Promise<void> {
    const data = {
      status,
      steps: steps as any,
      summary: summary as any,
      finished_at: new Date(),
      version: { increment: 1 },
    };
    // `rejected` (empty selection) finalizes from `executing` as well.
    const where = { id: batchId, status: 'executing' };
    try {
      await this.prisma.ai_agent_write_batches.updateMany({ where, data });
    } catch (first) {
      this.logger.error(
        `Finalizing batch ${batchId} failed, retrying: ${(first as Error)?.message}`,
      );
      await this.prisma.ai_agent_write_batches.updateMany({ where, data });
    }
  }

  // ── after a terminal status ───────────────────────────────────────────

  /**
   * Receipts + narration + metering + audit (T38). Best-effort: the writes
   * already landed, so none of these may turn an applied batch into an error.
   */
  private async afterFinish(
    row: { id: string; conversation_id: number | null; goal?: string },
    userId: number | undefined,
    status: WriteBatchStatus,
    steps: WriteBatchStepRecord[],
    summary: WriteBatchSummary,
    outputs: Map<string, string> = new Map(),
  ): Promise<void> {
    // One `role: 'tool'` receipt per applied step, attributed to Vex: the
    // business log and the store history (T18) rebuild applied actions from
    // these rows, exactly like a single approved write.
    for (const step of steps) {
      if (step.status !== 'applied') continue;
      try {
        await this.activity.recordApplied({
          conversationId: row.conversation_id ?? undefined,
          tool: step.tool,
          args: step.arguments,
          output: outputs.get(step.step_id) ?? '',
          agent_key: 'vex',
        });
      } catch (error) {
        this.logger.warn(
          `Batch receipt failed (${row.id}/${step.step_id}): ${(error as Error)?.message}`,
        );
      }
    }
    // Metering (N4): the batch counts as ONE turn of the `vex_agent` cap,
    // deduplicated by batch id; there is no per-action quota.
    if (summary.applied > 0) {
      const storeId = RequestContextService.getContext()?.store_id;
      if (storeId) {
        try {
          await this.access.consumeAIQuota(
            storeId,
            'vex_agent',
            1,
            writeBatchQuotaRequestId(row.id),
          );
        } catch (error) {
          this.logger.warn(
            `Batch metering failed (${row.id}): ${(error as Error)?.message}`,
          );
        }
      }
    }
    try {
      await this.activity.recordAppliedNarration({
        conversationId: row.conversation_id ?? undefined,
        summary: summary.message,
      });
    } catch (error) {
      this.logger.warn(
        `Batch narration failed (${row.id}): ${(error as Error)?.message}`,
      );
    }
    try {
      const ctx = RequestContextService.getContext();
      await this.audit.log({
        userId,
        storeId: ctx?.store_id,
        organizationId: ctx?.organization_id,
        action: AI_WRITE_BATCH_EXECUTED,
        resource: AI_WRITE_BATCH_RESOURCE,
        // `audit_logs.resource_id` is an Int; the batch id is a uuid, so it
        // travels in `metadata.batch_id`.
        newValues: { status, summary: summary.message },
        metadata: {
          source: 'ai_agent',
          agent_key: 'vex',
          batch_id: row.id,
          conversation_id: row.conversation_id,
          goal: row.goal,
          status,
          // Measurement only (N4): no action quota is consumed.
          applied_count: summary.applied,
          steps: steps.map((s) => ({
            order: s.order,
            tool: s.tool,
            label: s.label,
            status: s.status,
          })),
          summary,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Batch audit failed (${row.id}): ${(error as Error)?.message}`,
      );
    }
  }
}
