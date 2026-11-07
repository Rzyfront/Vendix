import { Injectable } from '@nestjs/common';
import {
  WorkflowActionDef,
  WorkflowDefinitionV1,
  WorkflowStageDef,
  isHumanStage,
} from '@common/workflows/contract';
import { AppliedVendixAction, applyActionList } from './workflow-rules';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowActor,
  WorkflowInstanceRow,
  WorkflowNotifyPayload,
  WorkflowTx,
} from './workflow-engine.types';

export interface InstanceStagePatch {
  current_stage_key: string;
  stage_entered_at: Date;
  stage_entry_seq: number;
  stage_due_at: Date | null;
  stage_last_reminded_at: null;
  stage_escalated_at: null;
  status?: string;
  completed_at?: Date;
}

/** Entering / leaving a stage: patches, hooks, task creation, outbox. */
@Injectable()
export class WorkflowStageService {
  constructor(
    private readonly assignment: WorkflowAssignmentService,
    private readonly events: WorkflowEventsService,
  ) {}

  /** `set_field` mutates a copy of `data`; `notify` becomes an outbox payload. */
  applyActions(
    actions: WorkflowActionDef[] | undefined,
    data: Record<string, unknown>,
    instance: Pick<WorkflowInstanceRow, 'reference' | 'title'> & {
      subject_id?: number | null;
    },
  ): {
    data: Record<string, unknown>;
    notifies: WorkflowNotifyPayload[];
    vendix: AppliedVendixAction[];
  } {
    const applied = applyActionList(actions, data, instance);
    return {
      data: applied.data,
      vendix: applied.vendix,
      notifies: applied.notifies.map((n) => ({
        title: `${instance.reference} · ${instance.title}`,
        message: n.message,
        def: n.to,
      })),
    };
  }

  stagePatch(
    stage: WorkflowStageDef,
    now: Date,
    previousEntrySeq: number,
  ): InstanceStagePatch {
    const patch: InstanceStagePatch = {
      current_stage_key: stage.key,
      stage_entered_at: now,
      stage_entry_seq: previousEntrySeq + 1,
      stage_due_at: stage.due
        ? new Date(now.getTime() + stage.due.hours * 3_600_000)
        : null,
      stage_last_reminded_at: null,
      stage_escalated_at: null,
    };
    if (stage.type === 'end') {
      patch.status = stage.outcome ?? 'completed';
      patch.completed_at = now;
      patch.stage_due_at = null;
    }
    return patch;
  }

  /**
   * `vendix.*` actions never run inside the transaction: each becomes an
   * `action` outbox row, executed by the dispatcher under the store context.
   */
  async enqueueVendixActions(
    tx: WorkflowTx,
    instance: Pick<WorkflowInstanceRow, 'id' | 'store_id'>,
    stageKey: string,
    actions: AppliedVendixAction[] | undefined,
  ): Promise<void> {
    for (const a of actions ?? []) {
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: 'action',
        payload: {
          action: a.action,
          map_resolved: a.map_resolved,
          stage_key: stageKey,
        },
      });
    }
  }

  /** Open|claimed tasks of the instance → cancelled (except the completed one). */
  async cancelOpenTasks(
    tx: WorkflowTx,
    storeId: number,
    instanceId: number,
    exceptTaskId?: number,
  ): Promise<number> {
    const res = await tx.workflow_tasks.updateMany({
      where: {
        store_id: storeId,
        instance_id: instanceId,
        status: { in: ['open', 'claimed'] },
        ...(exceptTaskId ? { id: { not: exceptTaskId } } : {}),
      },
      data: { status: 'cancelled' },
    });
    return res.count;
  }

  /**
   * Side effects of having entered `stage` (the instance row already holds the
   * new stage): outbox notifications, the stage task, or the `advance` row for
   * automatic stages. Never chains another transition inside the transaction.
   */
  async afterEnter(
    tx: WorkflowTx,
    args: {
      definition: WorkflowDefinitionV1;
      instance: WorkflowInstanceRow;
      stage: WorkflowStageDef;
      actor: WorkflowActor;
      notifies: WorkflowNotifyPayload[];
      vendix?: AppliedVendixAction[];
    },
  ): Promise<void> {
    const { instance, stage, actor } = args;
    for (const payload of args.notifies) {
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: 'notify',
        payload: payload as unknown as Record<string, unknown>,
      });
    }
    await this.enqueueVendixActions(tx, instance, stage.key, args.vendix);
    if (stage.type === 'automatic') {
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: 'advance',
        payload: {
          instance_id: instance.id,
          stage_key: stage.key,
          stage_entry_seq: instance.stage_entry_seq,
        },
      });
      return;
    }
    if (!isHumanStage(stage)) return;

    const assigned = await this.assignment.resolveForStage(tx, stage, instance);
    const task = await tx.workflow_tasks.create({
      data: {
        organization_id: instance.organization_id,
        store_id: instance.store_id,
        instance_id: instance.id,
        stage_key: stage.key,
        stage_entry_seq: instance.stage_entry_seq,
        kind: stage.type,
        status: 'open',
        ...assigned.fields,
        due_at: instance.stage_due_at,
      },
    });
    await this.events.emitWebhook(tx, instance, 'workflow.task.created', {
      task_id: task.id,
      stage_key: stage.key,
      kind: stage.type,
      due_at: instance.stage_due_at ? instance.stage_due_at.toISOString() : null,
    });
    if (assigned.unassigned) {
      await this.events.append(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        type: 'unassigned',
        to_stage_key: stage.key,
        actor: { type: 'system', id: null },
        payload: {
          task_id: task.id,
          reason: assigned.reason ?? null,
          fallback: assigned.fallback ?? null,
        },
      });
    }
    // Do not ping the person who just acted when the task lands on them.
    if (
      !(
        assigned.fields.assignee_user_id !== null &&
        assigned.fields.assignee_user_id === actor.id
      )
    ) {
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: 'notify',
        payload: {
          title: `${instance.reference} · ${instance.title}`,
          message: `Tienes una tarea pendiente: ${stage.name}`,
          task_ids: [task.id],
        } satisfies WorkflowNotifyPayload as unknown as Record<string, unknown>,
      });
    }
  }
}
