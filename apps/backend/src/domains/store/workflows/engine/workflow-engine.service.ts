import { Injectable } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WORKFLOW_ACTION_CATALOG,
  WORKFLOW_LIMITS,
  WorkflowActionErrorPolicy,
  WorkflowStageDef,
  WorkflowVendixActionName,
  findStage,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  CompleteTaskInput,
  StartPublicWorkflowInput,
  StartSystemWorkflowInput,
  StartWorkflowInput,
  WorkflowActor,
  WorkflowCommandResult,
  WorkflowIdempotencyConflict,
  WorkflowInstanceRow,
  WorkflowTaskRow,
  WorkflowTx,
} from './workflow-engine.types';
import {
  COMPLETE_EVENT_TYPES,
  START_EVENT_TYPES,
  publicIdempotencyKey,
  systemIdempotencyKey,
  userIdempotencyKey,
} from './workflow-idempotency';
import { WorkflowEventsService } from './workflow-events.service';
import {
  WorkflowCallContext,
  WorkflowLoaderService,
} from './workflow-loader.service';
import { WorkflowCompleteService } from './workflow-complete.service';
import { WorkflowStartService } from './workflow-start.service';
import { SUBFLOW_CLOSED_OUTBOX_KIND, WorkflowStageService } from './workflow-stage.service';
import { WorkflowTickService } from './workflow-tick.service';
import { resolveInstanceGates } from '../gates/gate-resolution';

const CLOSED_TASK = ['done', 'cancelled', 'expired'];

/**
 * The ONLY write commands of Flujos. Each runs in one `$transaction` on the
 * scoped client; the actor always comes from `RequestContextService`.
 */

@Injectable()
export class WorkflowEngineService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly loader: WorkflowLoaderService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly starter: WorkflowStartService,
    private readonly completer: WorkflowCompleteService,
    private readonly advancer: WorkflowAdvanceService,
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
    private readonly ticker: WorkflowTickService,
  ) {}

  // ---- start -------------------------------------------------------------

  async start(raw: StartWorkflowInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const actor = this.userActor(ctx);
    const input = {
      ...raw,
      idempotencyKey: raw.idempotencyKey
        ? userIdempotencyKey(ctx.user_id, raw.idempotencyKey)
        : undefined,
    };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.execute(tx, ctx, actor, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: actor,
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }


  /**
   * Public form submission (actor `public`). Only `WorkflowPublicFormService`
   * calls it, after resolving the link; the start service re-checks the link.
   */
  async startPublic(raw: StartPublicWorkflowInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const input = { ...raw, idempotencyKey: publicIdempotencyKey(raw.idempotencyKey) };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.executePublic(tx, ctx, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: { type: 'public', id: null },
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }

  /**
   * Start from a business event (actor `system`). Only the outbox dispatcher
   * calls it, inside the store context of the `start_instance` row.
   */
  async startSystem(raw: StartSystemWorkflowInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const input = { ...raw, idempotencyKey: systemIdempotencyKey(raw.idempotencyKey) };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.executeSystem(tx, ctx, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: { type: 'system', id: null },
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }

  /**
   * Starts the request of a pending approval gate (P1.3) as actor `system`.
   * Returns null when the gate no longer needs one (already started, resolved,
   * or its definition stopped governing the operation).
   */
  async startGate(gateId: number): Promise<WorkflowCommandResult | null> {
    const ctx = this.loader.context();
    const idempotencyKey = systemIdempotencyKey(`gate:${gateId}`);
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.executeGate(tx, ctx, { gateId, idempotencyKey }),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: { type: 'system', id: null },
          types: START_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }

  // ---- P2: schedules, subflows, error policy -----------------------------

  /** P2.10: one fire of a cron trigger (the schedule cron calls it). */
  async startScheduled(input: {
    definitionId: number;
    cron: string;
    fireAt: string;
  }): Promise<WorkflowCommandResult | null> {
    const ctx = this.loader.context();
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.starter.executeSchedule(tx, ctx, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        return this.events.replay(this.prisma, e.idempotencyKey, {
          actor: { type: 'system', id: null },
          types: START_EVENT_TYPES,
        });
      }
      throw e;
    }
  }

  /**
   * P2.2: starts one child of a subflow stage (outbox `subflow_start`) and
   * records it in the parent's timeline. When the child cannot start, the
   * parent's stage is marked failed for this entry and resolves `rejected`.
   */
  async startSubflow(input: {
    parentId: number;
    stageKey: string;
    entrySeq: number;
    index: number;
  }): Promise<void> {
    const ctx = this.loader.context();
    let outcome: Awaited<ReturnType<WorkflowStartService['executeChild']>>;
    try {
      outcome = await this.prisma.$transaction(async (tx: WorkflowTx) => {
        const res = await this.starter.executeChild(tx, ctx, input);
        if (!res) return res;
        await this.events.lockInstance(tx, ctx.store_id, input.parentId);
        if ('started' in res) {
          if (!res.started.replayed) {
            await this.events.append(tx, {
              store_id: ctx.store_id,
              instance_id: input.parentId,
              type: 'subflow_started',
              from_stage_key: input.stageKey,
              to_stage_key: input.stageKey,
              actor: { type: 'system', id: null },
              payload: {
                child_id: res.started.instance.id,
                child_reference: res.started.instance.reference,
                flow_key: res.flowKey,
                index: input.index,
              },
            });
          }
          return res;
        }
        await this.recordSubflowFailure(tx, ctx.store_id, input, res.flowKey, res.error);
        return res;
      });
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) return; // already started
      throw e;
    }
    if (outcome && 'error' in outcome) {
      await this.ticker.tick(input.parentId, { expectStageEntrySeq: input.entrySeq });
    }
  }

  /** P2.2: marks this entry of the parent's subflow stage as failed (it resolves `rejected`). */
  private async recordSubflowFailure(
    tx: WorkflowTx,
    storeId: number,
    input: { parentId: number; stageKey: string; entrySeq: number; index: number },
    flowKey: string,
    error: string,
  ): Promise<WorkflowInstanceRow> {
    const parent = await this.loader.loadInstance(tx, input.parentId);
    const failedKey = `${input.stageKey}:${input.entrySeq}`;
    await tx.workflow_instances.updateMany({
      where: { id: parent.id, store_id: storeId, stage_entry_seq: input.entrySeq },
      data: {
        runtime: {
          ...(parent.runtime ?? {}),
          subflow_failed: { ...(parent.runtime?.subflow_failed ?? {}), [failedKey]: error },
        },
      },
    });
    await this.events.append(tx, {
      store_id: storeId,
      instance_id: parent.id,
      type: 'subflow_failed',
      from_stage_key: input.stageKey,
      to_stage_key: input.stageKey,
      actor: { type: 'system', id: null },
      payload: { flow_key: flowKey, error, index: input.index },
    });
    return parent;
  }

  /**
   * P2.2/P2.7: a `subflow_start` or `subflow_closed` row exhausted its retries.
   * Nothing may stay stuck in silence: a dead start marks the stage failed (a
   * waiting parent resolves `rejected`) and alerts the flow owner; a dead
   * "child closed" still wakes the parent, which re-reads its children.
   */
  async onSubflowDead(
    row: { id: number; kind: string; instance_id: number | null; payload: Record<string, unknown> },
    message: string,
  ): Promise<void> {
    const ctx = this.loader.context();
    const parentId = Number(row.payload.parent_id ?? row.instance_id);
    if (!parentId) return;
    if (row.kind === SUBFLOW_CLOSED_OUTBOX_KIND) {
      const seq = row.payload.stage_entry_seq;
      await this.ticker.tick(parentId, {
        ...(seq !== null && seq !== undefined ? { expectStageEntrySeq: Number(seq) } : {}),
      });
      return;
    }
    const input = {
      parentId,
      stageKey: String(row.payload.stage_key),
      entrySeq: Number(row.payload.stage_entry_seq),
      index: Number(row.payload.index),
    };
    const error = `No se pudo iniciar el subflujo: ${message.slice(0, 200)}`;
    await this.prisma.$transaction(async (tx: WorkflowTx) => {
      await this.events.lockInstance(tx, ctx.store_id, parentId);
      const parent = await this.recordSubflowFailure(tx, ctx.store_id, input, '', error);
      const owners = await this.flowOwners(tx, parent);
      if (owners.length > 0) {
        await this.events.enqueue(tx, {
          store_id: ctx.store_id,
          instance_id: parent.id,
          kind: 'notify',
          payload: {
            title: `${parent.reference} · ${parent.title}`,
            message: `Subflujo fallido en la etapa "${input.stageKey}": ${message.slice(0, 200).replace(/[.\s]+$/, '')}.`,
            user_ids: owners,
          },
        });
      }
    });
    await this.ticker.tick(parentId, { expectStageEntrySeq: input.entrySeq });
  }

  /** P2.2: a child closed; the parent records it and re-evaluates its stage. */
  async subflowClosed(input: {
    parentId: number;
    childId: number;
    entrySeq: number | null;
  }): Promise<void> {
    const ctx = this.loader.context();
    await this.prisma.$transaction(async (tx: WorkflowTx) => {
      const child = (await tx.workflow_instances.findFirst({
        where: { id: input.childId, store_id: ctx.store_id, parent_instance_id: input.parentId },
      })) as WorkflowInstanceRow | null;
      if (!child) return;
      const key = systemIdempotencyKey(`subflow_closed:${input.parentId}:${child.id}`);
      const seen = await tx.workflow_instance_events.findFirst({
        where: { store_id: ctx.store_id, idempotency_key: key },
        select: { id: true },
      });
      if (seen) return;
      await this.events.lockInstance(tx, ctx.store_id, input.parentId);
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: input.parentId,
        type: 'subflow_closed',
        from_stage_key: child.parent_stage_key ?? null,
        to_stage_key: child.parent_stage_key ?? null,
        actor: { type: 'system', id: null },
        payload: { child_id: child.id, child_reference: child.reference, outcome: child.status },
        idempotencyKey: key,
      });
    });
    await this.ticker.tick(input.parentId, {
      ...(input.entrySeq !== null ? { expectStageEntrySeq: input.entrySeq } : {}),
    });
  }

  /**
   * P2.7: a `vendix.*` action exhausted its retries (dead-letter). The flow
   * owner is alerted, and the action's policy decides: `continue` (nothing
   * else), `route` (the request goes to the error stage from wherever it is)
   * or `fail` (the request ends as failed). Closed requests are left alone.
   */
  async onActionDead(row: {
    id: number;
    instance_id: number | null;
    payload: Record<string, unknown>;
  }, message: string): Promise<void> {
    if (!row.instance_id) return;
    const ctx = this.loader.context();
    const action = String(row.payload.action ?? '');
    const policy = (row.payload.on_error ?? {}) as WorkflowActionErrorPolicy;
    const label =
      WORKFLOW_ACTION_CATALOG[action as WorkflowVendixActionName]?.label ?? action;
    await this.prisma.$transaction(async (tx: WorkflowTx) => {
      const instance = (await tx.workflow_instances.findFirst({
        where: { id: row.instance_id, store_id: ctx.store_id },
      })) as WorkflowInstanceRow | null;
      if (!instance) return;
      const owners = await this.flowOwners(tx, instance);
      if (owners.length > 0) {
        await this.events.enqueue(tx, {
          store_id: ctx.store_id,
          instance_id: instance.id,
          kind: 'notify',
          payload: {
            title: `${instance.reference} · ${instance.title}`,
            message: `Acción fallida: ${label}. ${message.slice(0, 200).replace(/[.\s]+$/, '')}. Puedes reintentarla desde la solicitud.`,
            user_ids: owners,
          },
        });
      }
      if (instance.status !== 'active') return;
      if (policy.then === 'route' && policy.route_to) {
        const definition = await this.loader.loadDefinition(tx, instance.version_id);
        const from = this.loader.currentStage(definition, instance);
        if (from.key === policy.route_to || !findStage(definition, policy.route_to)) return;
        await this.advancer.advance({
          tx,
          instance,
          definition,
          fromStage: from,
          toStageKey: policy.route_to,
          data: instance.data ?? {},
          actor: { type: 'system', id: null },
          expectedRowVersion: instance.row_version,
          runExitHooks: false,
          event: {
            type: 'error_routed',
            payload: { action, label, outbox_id: row.id, to: policy.route_to, error: message.slice(0, 300) },
          },
        });
      } else if (policy.then === 'fail') {
        await this.ticker.fail(tx, instance, `action_failed:${action}`, new Date());
      }
    });
  }

  /** Who owns a flow: its creator and whoever published the running version. */
  private async flowOwners(tx: WorkflowTx, instance: WorkflowInstanceRow): Promise<number[]> {
    const [def, version] = await Promise.all([
      tx.workflow_definitions.findFirst({
        where: { id: instance.definition_id, store_id: instance.store_id },
        select: { created_by_user_id: true },
      }),
      tx.workflow_versions.findFirst({
        where: { id: instance.version_id, store_id: instance.store_id },
        select: { published_by_user_id: true },
      }),
    ]);
    return [
      ...new Set(
        [def?.created_by_user_id, version?.published_by_user_id].filter(
          (id): id is number => typeof id === 'number',
        ),
      ),
    ];
  }

  // ---- completeTask ------------------------------------------------------

  async completeTask(raw: CompleteTaskInput): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const actor = this.userActor(ctx);
    const input = {
      ...raw,
      idempotencyKey: raw.idempotencyKey
        ? userIdempotencyKey(ctx.user_id, raw.idempotencyKey)
        : undefined,
    };
    try {
      return await this.prisma.$transaction((tx: WorkflowTx) =>
        this.completer.execute(tx, ctx, actor, input),
      );
    } catch (e) {
      if (e instanceof WorkflowIdempotencyConflict) {
        const prev = await this.events.replay(this.prisma, e.idempotencyKey, {
          actor: actor,
          types: COMPLETE_EVENT_TYPES,
        });
        if (prev) return prev;
      }
      throw e;
    }
  }


  // ---- claim -------------------------------------------------------------

  async claimTask(taskId: number): Promise<WorkflowTaskRow> {
    const ctx = this.loader.context();
    const actor = this.userActor(ctx);
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const task = await this.loader.loadTask(tx, taskId);
      if (task.status !== 'open') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
      }
      this.completer.assertTaskPermission(ctx);
      if (!(await this.assignment.canAct(
          tx,
          task,
          ctx.user_id as number,
          ctx.store_id,
          ctx.organization_id,
        ))) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
      }
      const instance = await this.loader.loadInstance(tx, task.instance_id);
      if (instance.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
      }
      const definition = await this.loader.loadDefinition(tx, instance.version_id);
      const stage: WorkflowStageDef | undefined = findStage(definition, task.stage_key);
      if (stage?.quorum && stage.quorum.required > 1) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_CLAIM_NOT_ALLOWED);
      }
      await this.events.lockInstance(tx, ctx.store_id, instance.id);
      const res = await tx.workflow_tasks.updateMany({
        where: { id: task.id, store_id: ctx.store_id, status: 'open' },
        data: { status: 'claimed', assignee_user_id: ctx.user_id, claimed_at: new Date() },
      });
      if (res.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_CLOSED);
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: instance.id,
        type: 'claimed',
        from_stage_key: task.stage_key,
        actor,
        payload: { task_id: task.id },
      });
      return this.loader.loadTask(tx, task.id);
    });
  }

  // ---- admin commands ----------------------------------------------------

  /** Force the instance to `to` (caller checks `store:workflows:manage`). */
  async transition(input: {
    instanceId: number;
    to: string;
    reason: string;
    expectedRowVersion?: number;
  }): Promise<WorkflowCommandResult> {
    const ctx = this.loader.context();
    const actor = this.adminActor(ctx);
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const instance = await this.loader.loadInstance(tx, input.instanceId);
      if (instance.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
      }
      const definition = await this.loader.loadDefinition(tx, instance.version_id);
      const from = this.loader.currentStage(definition, instance);
      const updated = await this.advancer.advance({
        tx,
        instance,
        definition,
        fromStage: from,
        toStageKey: input.to,
        data: instance.data ?? {},
        actor,
        expectedRowVersion: input.expectedRowVersion ?? instance.row_version,
        runExitHooks: false,
        event: { type: 'forced', payload: { reason: input.reason } },
      });
      return {
        instance: updated,
        task: null,
        advanced: true,
        replayed: false,
        from_stage_key: from.key,
        to_stage_key: input.to,
      };
    });
  }

  async cancel(input: { instanceId: number; reason: string }): Promise<WorkflowInstanceRow> {
    const ctx = this.loader.context();
    const actor = this.adminActor(ctx);
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const instance = await this.loader.loadInstance(tx, input.instanceId);
      if (instance.status !== 'active') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_INSTANCE_CLOSED);
      }
      const now = new Date();
      const cas = await tx.workflow_instances.updateMany({
        where: {
          id: instance.id,
          store_id: ctx.store_id,
          row_version: instance.row_version,
          status: 'active',
        },
        data: {
          status: 'cancelled',
          cancel_reason: input.reason,
          completed_at: now,
          stage_due_at: null,
          row_version: { increment: 1 },
        },
      });
      if (cas.count === 0) throw new VendixHttpException(ErrorCodes.WORKFLOW_STALE);
      await this.stages.cancelOpenTasks(tx, ctx.store_id, instance.id);
      await this.stages.notifyParent(tx, instance);
      // P1.3: a cancelled request frees its gates; a new attempt asks again.
      await resolveInstanceGates(tx, instance, 'cancelled', input.reason);
      await this.events.append(tx, {
        store_id: ctx.store_id,
        instance_id: instance.id,
        type: 'cancelled',
        from_stage_key: instance.current_stage_key,
        actor,
        payload: { reason: input.reason },
      });
      await this.cancelWaitedChildren(tx, instance, actor, now, 1);
      return this.loader.loadInstance(tx, instance.id);
    });
  }

  /**
   * P2.2: the children a cancelled parent was waiting for are cancelled too
   * (and theirs, down the tree). Children of a subflow that does not wait
   * live on by themselves.
   */
  private async cancelWaitedChildren(
    tx: WorkflowTx,
    parent: WorkflowInstanceRow,
    actor: WorkflowActor,
    now: Date,
    depth: number,
  ): Promise<void> {
    if (depth > WORKFLOW_LIMITS.maxSubflowDepth) return;
    const definition = await this.loader.loadDefinition(tx, parent.version_id);
    const stage = findStage(definition, parent.current_stage_key);
    if (stage?.type !== 'subflow' || stage.subflow?.wait === false) return;
    const children = (await tx.workflow_instances.findMany({
      where: {
        store_id: parent.store_id,
        parent_instance_id: parent.id,
        parent_stage_key: parent.current_stage_key,
        parent_entry_seq: parent.stage_entry_seq,
        status: 'active',
      },
    })) as WorkflowInstanceRow[];
    const reason = `Se canceló la solicitud padre ${parent.reference}.`;
    for (const child of children) {
      const done = await tx.workflow_instances.updateMany({
        where: { id: child.id, store_id: parent.store_id, status: 'active' },
        data: {
          status: 'cancelled',
          cancel_reason: reason,
          completed_at: now,
          stage_due_at: null,
          row_version: { increment: 1 },
        },
      });
      if (done.count === 0) continue;
      await this.stages.cancelOpenTasks(tx, parent.store_id, child.id);
      await resolveInstanceGates(tx, child, 'cancelled', reason);
      await this.events.append(tx, {
        store_id: parent.store_id,
        instance_id: child.id,
        type: 'cancelled',
        from_stage_key: child.current_stage_key,
        actor,
        payload: { reason, parent_id: parent.id },
      });
      await this.cancelWaitedChildren(tx, child, actor, now, depth + 1);
    }
  }

  /** Internal: automatic stages, overdue reminders and escalation. */
  tick(
    instanceId: number,
    opts: { expectStageEntrySeq?: number; now?: Date } = {},
  ) {
    return this.ticker.tick(instanceId, opts);
  }

  // ---- helpers -----------------------------------------------------------

  private userActor(ctx: WorkflowCallContext): WorkflowActor {
    if (ctx.user_id === null) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
    }
    return { type: 'user', id: ctx.user_id };
  }

  private adminActor(ctx: WorkflowCallContext): WorkflowActor {
    return ctx.user_id === null
      ? { type: 'system', id: null }
      : { type: 'user', id: ctx.user_id };
  }


}
