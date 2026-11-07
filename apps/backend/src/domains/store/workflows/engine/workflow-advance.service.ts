import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  applyComputedFields,
  findStage,
} from '@common/workflows/contract';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowStageService } from './workflow-stage.service';
import {
  gateOutcomeOf,
  resolveInstanceGates,
} from '../gates/gate-resolution';
import {
  WorkflowActor,
  WorkflowInstanceRow,
  WorkflowInstanceRuntime,
  WorkflowTx,
} from './workflow-engine.types';

export interface AdvanceArgs {
  tx: WorkflowTx;
  instance: WorkflowInstanceRow;
  definition: WorkflowDefinitionV1;
  fromStage: WorkflowStageDef;
  toStageKey: string;
  /** Instance data after merging the submitted form values. */
  data: Record<string, unknown>;
  actor: WorkflowActor;
  expectedRowVersion: number;
  /** Forced transitions skip the `on_exit` hooks of the stage left. */
  runExitHooks: boolean;
  /**
   * P2.6: the stage resolved with an outcome (not a forced move): its
   * `on_complete` hooks run, preceded by `on_submit` when a person submitted.
   */
  resolved?: { submitted: boolean };
  /** P2.4: engine state written together with the move (loop counters). */
  runtime?: WorkflowInstanceRuntime;
  event: {
    type: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string | null;
  };
  /** Task that triggered the move: stays `done`, not cancelled. */
  doneTaskId?: number;
  /** Runs right after the CAS succeeded and before any other write. */
  onCas?: () => Promise<void>;
}

/**
 * The single place where an instance changes stage (steps 7–11 of the
 * algorithm): CAS on `row_version`, close the old stage's tasks, history
 * event, then the new stage's tasks and outbox rows.
 */
@Injectable()
export class WorkflowAdvanceService {
  constructor(
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
  ) {}

  async advance(a: AdvanceArgs): Promise<WorkflowInstanceRow> {
    const toStage = findStage(a.definition, a.toStageKey);
    if (!toStage) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_STAGE_NOT_FOUND);
    }
    const now = new Date();
    // P2.6: on_submit → on_complete → on_exit → on_enter, data threaded through.
    const hooks = this.stages.applyHooks(
      [
        a.resolved?.submitted ? a.fromStage.on_submit : undefined,
        a.resolved ? a.fromStage.on_complete : undefined,
        a.runExitHooks ? a.fromStage.on_exit : undefined,
        toStage.on_enter,
      ],
      a.data,
      a.instance,
    );
    // P2.9: calculated fields follow every write.
    const enter = { ...hooks, data: applyComputedFields(a.definition, hooks.data) };
    const patch = this.stages.stagePatch(toStage, now, a.instance.stage_entry_seq);

    // 7. CAS. Nothing else is written before it succeeds.
    const cas = await a.tx.workflow_instances.updateMany({
      where: {
        id: a.instance.id,
        store_id: a.instance.store_id,
        row_version: a.expectedRowVersion,
        status: 'active',
        current_stage_key: a.fromStage.key,
      },
      data: {
        ...patch,
        data: enter.data,
        ...(a.runtime ? { runtime: a.runtime } : {}),
        row_version: { increment: 1 },
      },
    });
    if (cas.count === 0) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
    }
    const updated: WorkflowInstanceRow = {
      ...a.instance,
      ...(patch as unknown as Partial<WorkflowInstanceRow>),
      data: enter.data,
      ...(a.runtime ? { runtime: a.runtime } : {}),
      row_version: a.expectedRowVersion + 1,
    };
    if (a.onCas) await a.onCas();

    // 9. Close the leaving stage's tasks.
    await this.stages.cancelOpenTasks(
      a.tx,
      a.instance.store_id,
      a.instance.id,
      a.doneTaskId,
    );

    // 8. History (seq + idempotency key).
    await this.events.append(a.tx, {
      store_id: a.instance.store_id,
      instance_id: a.instance.id,
      type: a.event.type,
      from_stage_key: a.fromStage.key,
      to_stage_key: toStage.key,
      actor: a.actor,
      payload: a.event.payload,
      idempotencyKey: a.event.idempotencyKey ?? null,
    });

    // 9–11. New stage: notifications, task, automatic `advance` row.
    await this.events.emitWebhook(a.tx, updated, 'workflow.instance.transitioned', {
      from_stage_key: a.fromStage.key,
      to_stage_key: toStage.key,
      status: updated.status,
    });
    await this.stages.afterEnter(a.tx, {
      definition: a.definition,
      instance: updated,
      stage: toStage,
      actor: a.actor,
      notifies: enter.notifies,
      vendix: enter.vendix,
    });
    if (toStage.type === 'end') {
      // P1.3: the gates this request decides close with it, atomically.
      const comment = a.event.payload?.['comment'];
      await resolveInstanceGates(
        a.tx,
        updated,
        gateOutcomeOf(toStage.outcome),
        typeof comment === 'string' && comment.trim() !== '' ? comment.trim() : null,
      );
      const finished =
        toStage.outcome === 'rejected'
          ? 'workflow.instance.rejected'
          : toStage.outcome === 'completed' || toStage.outcome === undefined
            ? 'workflow.instance.completed'
            : null;
      if (finished) {
        await this.events.emitWebhook(a.tx, updated, finished, {
          stage_key: toStage.key,
          outcome: toStage.outcome ?? 'completed',
        });
      }
    }
    return updated;
  }
}
