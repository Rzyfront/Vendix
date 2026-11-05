import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  findStage,
} from '@common/workflows/contract';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowStageService } from './workflow-stage.service';
import {
  WorkflowActor,
  WorkflowInstanceRow,
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
    const exit = a.runExitHooks
      ? this.stages.applyActions(a.fromStage.on_exit, a.data, a.instance)
      : { data: a.data, notifies: [], vendix: [] };
    const enter = this.stages.applyActions(toStage.on_enter, exit.data, a.instance);
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
      notifies: [...exit.notifies, ...enter.notifies],
      vendix: [...exit.vendix, ...enter.vendix],
    });
    if (toStage.type === 'end') {
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
