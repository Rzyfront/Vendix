import { Injectable } from '@nestjs/common';
import {
  WORKFLOW_VENDIX_ACTIONS,
  WorkflowActionDef,
  WorkflowBranchDef,
  WorkflowDefinitionV1,
  applyComputedFields,
  WorkflowStageDef,
  computeWaitUntil,
  isHumanStage,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { OUTBOX_MAX_ATTEMPTS } from './workflow-outbox.dispatcher.constants';
import { AppliedVendixAction, applyActionList } from './workflow-rules';
import { resolveHttpRequestMap } from './actions/http-request-map';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowActor,
  WorkflowInstanceRow,
  WorkflowNotifyPayload,
  WorkflowTx,
} from './workflow-engine.types';

/** Outbox kinds of the P2 engine. */
export const SUBFLOW_START_OUTBOX_KIND = 'subflow_start';
export const SUBFLOW_CLOSED_OUTBOX_KIND = 'subflow_closed';
export const AI_STEP_OUTBOX_KIND = 'ai_step';
export const DEFAULT_STORE_TIMEZONE = 'America/Bogota';

/** P3.2: a staged `vendix.*` action; the HTTP node also carries its `output` map. */
export type StagedVendixAction = AppliedVendixAction & {
  output?: Record<string, string>;
};

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
    private readonly prisma: StorePrismaService,
  ) {}

  /** Runs several hook lists in order, threading the data through them. */
  applyHooks(
    lists: (WorkflowActionDef[] | undefined)[],
    data: Record<string, unknown>,
    instance: Pick<WorkflowInstanceRow, 'reference' | 'title'> & {
      subject_id?: number | null;
    },
  ): {
    data: Record<string, unknown>;
    notifies: WorkflowNotifyPayload[];
    vendix: AppliedVendixAction[];
  } {
    let acc = { data, notifies: [] as WorkflowNotifyPayload[], vendix: [] as AppliedVendixAction[] };
    for (const list of lists) {
      if (!list?.length) continue;
      const r = this.applyActions(list, acc.data, instance);
      acc = {
        data: r.data,
        notifies: [...acc.notifies, ...r.notifies],
        vendix: [...acc.vendix, ...r.vendix],
      };
    }
    return acc;
  }

  /**
   * P2.9: calculated fields recomputed with `today()` on the store's calendar.
   * The store is only read when the definition declares a formula.
   */
  async computeFields(
    definition: Pick<WorkflowDefinitionV1, 'fields'>,
    data: Record<string, unknown>,
    storeId: number,
  ): Promise<Record<string, unknown>> {
    if (!(definition.fields ?? []).some((f) => f.compute)) return data;
    return applyComputedFields(definition, data, {
      timeZone: await this.storeTimezone(storeId),
    });
  }

  /** Store time zone for wall-clock waits and schedules. */
  async storeTimezone(storeId: number): Promise<string> {
    const store = await this.prisma
      .withoutScope()
      .stores.findFirst({ where: { id: storeId }, select: { timezone: true } });
    return store?.timezone || DEFAULT_STORE_TIMEZONE;
  }

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
      vendix: this.stageHttpActions(actions, data, instance, applied.vendix),
      notifies: applied.notifies.map((n) => ({
        title: `${instance.reference} · ${instance.title}`,
        message: n.message,
        def: n.to,
      })),
    };
  }

  /**
   * P3.2: `vendix.http.request` keeps `{{secrets.NAME}}` in its map (the
   * generic resolver would blank it) and carries its `output` mapping. Every
   * other action is untouched.
   */
  private stageHttpActions(
    actions: WorkflowActionDef[] | undefined,
    data: Record<string, unknown>,
    instance: Pick<WorkflowInstanceRow, 'reference' | 'title'> & {
      subject_id?: number | null;
    },
    vendix: AppliedVendixAction[],
  ): StagedVendixAction[] {
    const out: StagedVendixAction[] = [...vendix];
    const current = { ...data };
    let index = 0;
    for (const a of actions ?? []) {
      if (a.action === 'set_field') {
        current[a.field] = a.value;
      } else if ((WORKFLOW_VENDIX_ACTIONS as readonly string[]).includes(a.action)) {
        const at = index++;
        if (a.action !== 'vendix.http.request') continue;
        const v = a as Extract<WorkflowActionDef, { map: unknown }>;
        out[at] = {
          ...out[at],
          map_resolved: resolveHttpRequestMap(v.map, { fields: current, instance }),
          ...(v.output ? { output: v.output } : {}),
        };
      }
    }
    return out;
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
      // An `ai` stage starts its review clock when the review task opens.
      stage_due_at: stage.due && stage.type !== 'ai'
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
      const retries = a.on_error?.retries;
      const output = (a as StagedVendixAction).output;
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: 'action',
        payload: {
          action: a.action,
          map_resolved: a.map_resolved,
          stage_key: stageKey,
          // P2.7: attempts before the error policy applies (dead-letter).
          max_attempts:
            retries === undefined ? OUTBOX_MAX_ATTEMPTS : Math.min(retries + 1, OUTBOX_MAX_ATTEMPTS),
          ...(a.on_error ? { on_error: a.on_error } : {}),
          ...(output ? { output } : {}),
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
    await this.enqueueVendixActions(tx, instance, stage.key, [
      ...(args.vendix ?? []),
      ...this.autoIssueActions(stage),
    ]);
    if (stage.type === 'end') {
      await this.notifyParent(tx, instance);
      return;
    }
    if (stage.type === 'wait' && stage.wait) {
      await this.enterWait(tx, instance, stage);
      return;
    }
    if (stage.type === 'subflow' && stage.subflow) {
      await this.enterSubflow(tx, instance, stage);
      return;
    }
    if (stage.type === 'parallel' && stage.parallel) {
      for (const branch of stage.parallel.branches) {
        await this.createTask(tx, args, branch);
      }
      return;
    }
    if (stage.type === 'ai' && stage.ai) {
      await this.enqueueAiStep(tx, instance, stage);
      return;
    }
    if (stage.type === 'automatic' || stage.type === 'loop') {
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
    await this.createTask(tx, args, null);
  }

  /**
   * P6.1: the AI call never runs inside the entering transaction. One outbox
   * row per entry; its attempts follow `ai.on_error.retries` like an action.
   */
  private async enqueueAiStep(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    stage: WorkflowStageDef,
  ): Promise<void> {
    const retries = stage.ai?.on_error?.retries;
    await this.events.enqueue(tx, {
      store_id: instance.store_id,
      instance_id: instance.id,
      kind: AI_STEP_OUTBOX_KIND,
      payload: {
        instance_id: instance.id,
        stage_key: stage.key,
        stage_entry_seq: instance.stage_entry_seq,
        max_attempts:
          retries === undefined ? OUTBOX_MAX_ATTEMPTS : Math.min(retries + 1, OUTBOX_MAX_ATTEMPTS),
      },
    });
  }

  /**
   * P6.1: the review task of an `ai` stage, opened once the AI wrote its
   * outputs (or could not): its due date counts from now.
   */
  async openAiReviewTask(
    tx: WorkflowTx,
    args: { instance: WorkflowInstanceRow; stage: WorkflowStageDef },
  ): Promise<WorkflowInstanceRow> {
    const { instance, stage } = args;
    const due = stage.due ? new Date(Date.now() + stage.due.hours * 3_600_000) : null;
    if (due) {
      await tx.workflow_instances.updateMany({
        where: { id: instance.id, store_id: instance.store_id },
        data: { stage_due_at: due },
      });
    }
    const opened = { ...instance, stage_due_at: due };
    await this.createTask(tx, { instance: opened, stage, actor: { type: 'system', id: null } }, null);
    return opened;
  }

  /**
   * P4.1: an `issued_document` requirement with `auto_issue_on_enter` issues its
   * document when the stage is entered, through the same `vendix.document.issue`
   * action (outbox row, publisher's permission, timeline entry on failure).
   */
  private autoIssueActions(stage: WorkflowStageDef): AppliedVendixAction[] {
    return (stage.requirements ?? []).flatMap((r) =>
      r.kind === 'issued_document' && r.auto_issue_on_enter
        ? [
            {
              action: 'vendix.document.issue' as const,
              map_resolved: { template_key: r.template_key, requirement_key: r.key },
            },
          ]
        : [],
    );
  }

  /** One task for a human stage, or one per branch of a parallel stage (P2.1). */
  private async createTask(
    tx: WorkflowTx,
    args: {
      instance: WorkflowInstanceRow;
      stage: WorkflowStageDef;
      actor: WorkflowActor;
    },
    branch: WorkflowBranchDef | null,
  ): Promise<void> {
    const { instance, stage, actor } = args;
    const assignable: WorkflowStageDef = branch
      ? { key: stage.key, name: branch.name, type: 'form', assignee: branch.assignee }
      : stage;
    const kind = branch ? 'form' : stage.type === 'ai' ? 'review' : stage.type;
    const assigned = await this.assignment.resolveForStage(tx, assignable, instance);
    const task = await tx.workflow_tasks.create({
      data: {
        organization_id: instance.organization_id,
        store_id: instance.store_id,
        instance_id: instance.id,
        stage_key: stage.key,
        stage_entry_seq: instance.stage_entry_seq,
        ...(branch ? { branch_key: branch.key } : {}),
        kind,
        status: 'open',
        ...assigned.fields,
        due_at: instance.stage_due_at,
      },
    });
    await this.events.emitWebhook(tx, instance, 'workflow.task.created', {
      task_id: task.id,
      stage_key: stage.key,
      kind,
      ...(branch ? { branch_key: branch.key } : {}),
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
          message: branch
            ? `Tienes una tarea pendiente: ${stage.name} · ${branch.name}`
            : `Tienes una tarea pendiente: ${stage.name}`,
          task_ids: [task.id],
        } satisfies WorkflowNotifyPayload as unknown as Record<string, unknown>,
      });
    }
  }

  /**
   * P2.3: the resume instant goes to `stage_due_at`; the timers cron ticks the
   * instance when it passes and the tick resolves `elapsed`.
   */
  private async enterWait(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    stage: WorkflowStageDef,
  ): Promise<void> {
    const until = computeWaitUntil(stage.wait!, {
      now: new Date(),
      timeZone: await this.storeTimezone(instance.store_id),
      data: instance.data ?? {},
    });
    await tx.workflow_instances.updateMany({
      where: {
        id: instance.id,
        store_id: instance.store_id,
        current_stage_key: stage.key,
        stage_entry_seq: instance.stage_entry_seq,
      },
      data: { stage_due_at: until },
    });
    instance.stage_due_at = until;
    await this.events.append(tx, {
      store_id: instance.store_id,
      instance_id: instance.id,
      type: 'waiting',
      to_stage_key: stage.key,
      actor: { type: 'system', id: null },
      payload: { until: until.toISOString(), kind: stage.wait!.kind },
    });
  }

  /**
   * P2.2: each child starts from its own outbox row (its own transaction and
   * idempotency key). A stage that does not wait resolves `completed` at once.
   */
  private async enterSubflow(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    stage: WorkflowStageDef,
  ): Promise<void> {
    const flows = stage.subflow!.flows;
    for (let index = 0; index < flows.length; index++) {
      await this.events.enqueue(tx, {
        store_id: instance.store_id,
        instance_id: instance.id,
        kind: SUBFLOW_START_OUTBOX_KIND,
        payload: {
          parent_id: instance.id,
          stage_key: stage.key,
          stage_entry_seq: instance.stage_entry_seq,
          index,
        },
      });
    }
    if (stage.subflow!.wait === false) {
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
    }
  }

  /** P2.2: a child that closed (any outcome) wakes its waiting parent. */
  async notifyParent(
    tx: WorkflowTx,
    instance: Pick<
      WorkflowInstanceRow,
      'id' | 'store_id' | 'parent_instance_id' | 'parent_entry_seq'
    >,
  ): Promise<void> {
    if (!instance.parent_instance_id) return;
    await this.events.enqueue(tx, {
      store_id: instance.store_id,
      instance_id: instance.parent_instance_id,
      kind: SUBFLOW_CLOSED_OUTBOX_KIND,
      payload: {
        parent_id: instance.parent_instance_id,
        child_id: instance.id,
        stage_entry_seq: instance.parent_entry_seq ?? null,
      },
    });
  }
}
