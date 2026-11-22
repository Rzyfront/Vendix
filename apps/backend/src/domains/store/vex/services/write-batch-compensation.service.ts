import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { AuditService } from '../../../../common/audit/audit.service';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import type { ToolExecutionContext } from '../../../../ai-engine/tools/interfaces/tool.interface';
import { WriteBatchService } from './write-batch.service';
import {
  WRITE_BATCH_UNDO_WINDOW_MS,
  type WriteBatchStepRecord,
  type WriteBatchView,
} from './write-batch.types';

/** Audit action of one undo attempt (`audit_logs.action` is a free string). */
export const AI_WRITE_BATCH_STEP_UNDONE = 'AI_WRITE_BATCH_STEP_UNDONE';
const AI_WRITE_BATCH_RESOURCE = 'ai_agent_write_batches';

export const UNDO_MESSAGES = {
  not_undoable: 'Este cambio ya no se puede deshacer desde Vex.',
  window_closed:
    'Pasó el tiempo para deshacer este cambio; ya no se puede deshacer desde Vex.',
  batch_not_finished: 'El lote todavía no terminó; no se puede deshacer aún.',
  step_missing: 'No encontré ese paso en el lote.',
  tool_missing: 'Este cambio ya no está disponible para deshacerse.',
  generic: 'No se pudo deshacer este cambio. El cambio sigue aplicado.',
} as const;

const UNDOABLE_BATCH_STATUSES = new Set([
  'applied',
  'partially_applied',
  'unknown_effect',
]);

/**
 * T36 — "Deshacer" of ONE step of a finished Vex write batch.
 *
 * Safety model:
 *  - Owner only (`loadOwned`: 404 other store, 403 other user).
 *  - Only a step that is `applied`, `compensable`, has a captured snapshot and
 *    sits inside the undo window can be undone; everything else is refused with
 *    a clear 409 and nothing runs.
 *  - The T13 role gate is re-checked BEFORE claiming.
 *  - The step is claimed with ONE conditional update on the batch `version`
 *    (`applied` → `compensating`). A double click or a concurrent approval
 *    loses the claim, runs nothing and gets the current view back.
 *  - The tool's own `undo` decides whether the inverse is still honest (it
 *    throws when the value moved after the batch); a failed undo leaves the
 *    change applied and marks the step `compensation_failed`.
 *  - A step never stays `compensating`.
 */
@Injectable()
export class WriteBatchCompensationService {
  private readonly logger = new Logger(WriteBatchCompensationService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly batches: WriteBatchService,
    private readonly registry: AIToolRegistry,
    private readonly audit: AuditService,
  ) {}

  async undoStep(input: {
    batchId: string;
    stepId: string;
    userId: number | undefined;
  }): Promise<WriteBatchView> {
    const row = await this.batches.loadOwned(input.batchId, input.userId);

    if (!UNDOABLE_BATCH_STATUSES.has(row.status)) {
      throw this.conflict(UNDO_MESSAGES.batch_not_finished);
    }
    const steps = (row.steps ?? []) as WriteBatchStepRecord[];
    const step = steps.find((s) => s.step_id === input.stepId);
    if (!step) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        UNDO_MESSAGES.step_missing,
      );
    }
    const snapshot = step.compensation_snapshot;
    if (
      step.status !== 'applied' ||
      step.compensable !== true ||
      snapshot === undefined ||
      snapshot === null
    ) {
      throw this.conflict(UNDO_MESSAGES.not_undoable);
    }
    const finishedAt = row.finished_at ? new Date(row.finished_at) : null;
    if (
      !finishedAt ||
      Date.now() >= finishedAt.getTime() + WRITE_BATCH_UNDO_WINDOW_MS
    ) {
      throw this.conflict(UNDO_MESSAGES.window_closed);
    }

    // Role gate (T13), BEFORE claiming: a lost role must not burn the step.
    this.registry.assertPermitted(step.tool);
    const registered = this.registry.get(this.registry.canonicalName(step.tool));
    const compensate = registered?.compensate;
    if (!compensate) {
      throw this.conflict(UNDO_MESSAGES.tool_missing);
    }

    // Atomic claim on the batch version: only one undo / approval wins. A
    // concurrent undo of ANOTHER step only bumps the version, so re-read once
    // and retry while THIS step is still `applied`; a double click on the same
    // step sees it `compensating`/`compensated` and runs nothing.
    let current = row;
    let claimedOk = false;
    for (let attempt = 0; attempt < 2 && !claimedOk; attempt += 1) {
      const fresh = ((current.steps ?? []) as WriteBatchStepRecord[]).map(
        (s) =>
          s.step_id === step.step_id
            ? { ...s, status: 'compensating' as const }
            : { ...s },
      );
      const claim = await this.prisma.ai_agent_write_batches.updateMany({
        where: {
          id: input.batchId,
          store_id: row.store_id,
          version: current.version,
        },
        data: { steps: fresh as any, version: { increment: 1 } },
      });
      if (claim.count > 0) {
        claimedOk = true;
        break;
      }
      current = await this.batches.loadOwned(input.batchId, input.userId);
      const latestStep = ((current.steps ?? []) as WriteBatchStepRecord[]).find(
        (s) => s.step_id === step.step_id,
      );
      if (latestStep?.status !== 'applied') break;
    }
    if (!claimedOk) {
      return this.batches.getView(input.batchId, input.userId);
    }

    let outcome: 'compensated' | 'compensation_failed' = 'compensation_failed';
    let resultSummary: string | undefined;
    let errorLine: string | undefined;
    try {
      resultSummary = await compensate.undo({
        args: step.arguments,
        snapshot,
        handlerOutput: step.compensation_output ?? '',
        context: this.executionContext(),
      });
      outcome = 'compensated';
    } catch (error) {
      errorLine = this.humanError(error);
      this.logger.warn(
        `Undo failed for ${step.tool} (${input.batchId}/${step.step_id}): ${(error as Error)?.message}`,
      );
    } finally {
      // Never leave the step `compensating`, even on an unexpected throw.
      const now = new Date().toISOString();
      const finalStep: Partial<WriteBatchStepRecord> =
        outcome === 'compensated'
          ? {
              status: 'compensated',
              compensated_at: now,
              result_summary: this.oneLine(resultSummary) ?? step.result_summary,
              error: undefined,
            }
          : {
              status: 'compensation_failed',
              error: errorLine ?? UNDO_MESSAGES.generic,
            };
      await this.persist(input, step.step_id, finalStep);
    }

    await this.auditAttempt(input, step.tool, outcome);
    return this.batches.getView(input.batchId, input.userId);
  }

  /**
   * Writes the final state of the claimed step. Conditional on the batch
   * version; when a concurrent undo of ANOTHER step bumped it meanwhile, the
   * latest row is re-read and only this step is patched, so neither writer
   * overwrites the other and this step never stays `compensating`.
   */
  private async persist(
    input: { batchId: string; userId: number | undefined },
    stepId: string,
    patch: Partial<WriteBatchStepRecord>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const latest = await this.batches.loadOwned(
          input.batchId,
          input.userId,
        );
        const steps = ((latest.steps ?? []) as WriteBatchStepRecord[]).map(
          (s) => (s.step_id === stepId ? { ...s, ...patch } : { ...s }),
        );
        const done = await this.prisma.ai_agent_write_batches.updateMany({
          where: {
            id: input.batchId,
            store_id: latest.store_id,
            version: latest.version,
          },
          data: { steps: steps as any, version: { increment: 1 } },
        });
        if (done.count > 0) return;
      } catch (error) {
        this.logger.error(
          `Persisting undo outcome failed (${input.batchId}/${stepId}): ${(error as Error)?.message}`,
        );
      }
    }
    this.logger.error(
      `Undo outcome of ${input.batchId}/${stepId} could not be persisted.`,
    );
  }

  private async auditAttempt(
    input: { batchId: string; stepId: string; userId: number | undefined },
    tool: string,
    outcome: 'compensated' | 'compensation_failed',
  ): Promise<void> {
    try {
      const ctx = RequestContextService.getContext();
      await this.audit.log({
        userId: input.userId,
        storeId: ctx?.store_id,
        organizationId: ctx?.organization_id,
        action: AI_WRITE_BATCH_STEP_UNDONE,
        resource: AI_WRITE_BATCH_RESOURCE,
        newValues: { outcome },
        metadata: {
          source: 'ai_agent',
          agent_key: 'vex',
          batch_id: input.batchId,
          step_id: input.stepId,
          tool,
          outcome,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Undo audit failed (${input.batchId}/${input.stepId}): ${(error as Error)?.message}`,
      );
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

  /**
   * Only messages the undo itself wrote for people (a `VendixHttpException`
   * with a Spanish detail) reach the card; anything else is the generic line,
   * never a stack trace or a driver message.
   */
  private humanError(error: unknown): string {
    if (error instanceof VendixHttpException) {
      const response = error.getResponse() as { message?: unknown };
      const message =
        typeof response?.message === 'string' ? response.message.trim() : '';
      if (message) return `${message} El cambio sigue aplicado.`;
    }
    return UNDO_MESSAGES.generic;
  }

  private oneLine(value: string | undefined): string | undefined {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 200) : undefined;
  }

  private conflict(message: string): VendixHttpException {
    return new VendixHttpException(ErrorCodes.SYS_CONFLICT_001, message);
  }
}
