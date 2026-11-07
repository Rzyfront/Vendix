import { Injectable } from '@nestjs/common';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  evaluateCondition,
  resolveTransition,
} from '@common/workflows/contract';
import { firedGuard } from './workflow-guards';
import { systemIdempotencyKey } from './workflow-idempotency';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  WorkflowActor,
  WorkflowInstanceRow,
  WorkflowInstanceRuntime,
  WorkflowNotifyPayload,
  WorkflowTx,
} from './workflow-engine.types';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowLoaderService } from './workflow-loader.service';
import { WorkflowStageService } from './workflow-stage.service';

export interface TickResult {
  action: 'noop' | 'advanced' | 'failed' | 'overdue' | 'blocked';
  reminded: boolean;
  escalated: boolean;
}

const SYSTEM: WorkflowActor = { type: 'system', id: null };
/** Consecutive automatic transitions before the instance goes to `failed`. */
export const MAX_AUTOMATIC_HOPS = 100;
const NOOP: TickResult = { action: 'noop', reminded: false, escalated: false };

/**
 * `tick(instanceId)`: runs an automatic stage (queued by the outbox, never
 * chained inside the entering transaction) and handles an overdue stage
 * (reminder every `remind_every_hours`, a single escalation).
 */
@Injectable()
export class WorkflowTickService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly loader: WorkflowLoaderService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly advancer: WorkflowAdvanceService,
    private readonly stages: WorkflowStageService,
    private readonly events: WorkflowEventsService,
  ) {}

  async tick(
    instanceId: number,
    opts: { expectStageEntrySeq?: number; now?: Date } = {},
  ): Promise<TickResult> {
    const { store_id: storeId } = this.loader.context();
    return this.prisma.$transaction(async (tx: WorkflowTx) => {
      const instance = (await tx.workflow_instances.findFirst({
        where: { id: instanceId, store_id: storeId },
      })) as WorkflowInstanceRow | null;
      if (!instance || instance.status !== 'active') return NOOP;
      if (
        opts.expectStageEntrySeq !== undefined &&
        opts.expectStageEntrySeq !== instance.stage_entry_seq
      ) {
        return NOOP;
      }
      const now = opts.now ?? new Date();
      const definition = await this.loader.loadDefinition(tx, instance.version_id);
      const stage = this.loader.currentStage(definition, instance);

      if (stage.type === 'automatic') {
        if (await this.exceededAutomaticHops(tx, instance)) {
          return this.fail(tx, instance, 'automatic_loop', now);
        }
        return this.resolveSystem(tx, instance, definition, stage, 'auto', now, {
          type: 'transitioned',
          payload: { automatic: true },
        });
      }
      if (stage.type === 'loop' && stage.loop) {
        return this.runLoop(tx, instance, definition, stage, now);
      }
      if (stage.type === 'wait') {
        if (!instance.stage_due_at || instance.stage_due_at > now) return NOOP;
        return this.resolveSystem(tx, instance, definition, stage, 'elapsed', now, {
          type: 'transitioned',
          payload: { automatic: true, waited: true },
        });
      }
      if (stage.type === 'subflow' && stage.subflow) {
        return this.runSubflow(tx, instance, definition, stage, now);
      }

      if (!instance.stage_due_at || instance.stage_due_at > now) return NOOP;
      return this.overdue(tx, instance, stage.due?.on_overdue, now);
    });
  }

  /**
   * A stage the engine resolves by itself leaves with `outcome`: guards first
   * (P2.5), then its transitions. A blocking guard leaves the request where it
   * is with the reason in the timeline (once per stage entry).
   */
  private async resolveSystem(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    definition: WorkflowDefinitionV1,
    stage: WorkflowStageDef,
    outcome: string,
    now: Date,
    event: { type: string; payload: Record<string, unknown> },
    extra: { data?: Record<string, unknown>; runtime?: WorkflowInstanceRuntime } = {},
  ): Promise<TickResult> {
    const data = extra.data ?? instance.data ?? {};
    const guard = firedGuard(stage, outcome, data, definition.fields);
    if (guard && !guard.redirect_to) {
      const key = systemIdempotencyKey(
        `guard:${instance.id}:${instance.stage_entry_seq}:${stage.key}`,
      );
      const seen = await tx.workflow_instance_events.findFirst({
        where: { store_id: instance.store_id, idempotency_key: key },
        select: { id: true },
      });
      if (!seen) {
        await this.events.append(tx, {
          store_id: instance.store_id,
          instance_id: instance.id,
          type: 'guard_blocked',
          from_stage_key: stage.key,
          to_stage_key: stage.key,
          actor: SYSTEM,
          payload: { message: guard.message, outcome },
          idempotencyKey: key,
        });
      }
      await this.park(tx, instance, NOOP, now);
      return { action: 'blocked', reminded: false, escalated: false };
    }
    const transition = guard?.redirect_to
      ? { to: guard.redirect_to }
      : resolveTransition(stage, outcome, data, definition.fields);
    if (!transition) return this.fail(tx, instance, 'no_transition', now);
    await this.advancer.advance({
      tx,
      instance,
      definition,
      fromStage: stage,
      toStageKey: transition.to,
      data,
      actor: SYSTEM,
      expectedRowVersion: instance.row_version,
      runExitHooks: true,
      resolved: { submitted: false },
      runtime: extra.runtime,
      event: guard
        ? {
            type: 'guard_redirected',
            payload: { ...event.payload, message: guard.message, to: transition.to },
          }
        : { type: event.type, payload: { ...event.payload, outcome } },
    });
    return { action: 'advanced', reminded: false, escalated: false };
  }

  /**
   * P2.4: another lap while the condition holds and the hard limit allows it;
   * otherwise `done` and the counter resets for the next time the request
   * comes back to this loop.
   */
  private async runLoop(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    definition: WorkflowDefinitionV1,
    stage: WorkflowStageDef,
    now: Date,
  ): Promise<TickResult> {
    const loop = stage.loop!;
    const runtime: WorkflowInstanceRuntime = { ...(instance.runtime ?? {}) };
    const loops = { ...(runtime.loops ?? {}) };
    const laps = loops[stage.key] ?? 0;
    const holds = evaluateCondition(loop.while, instance.data ?? {}, definition.fields);
    if (holds && laps < loop.max_iterations) {
      loops[stage.key] = laps + 1;
      return this.resolveSystem(
        tx,
        instance,
        definition,
        stage,
        'continue',
        now,
        { type: 'loop_iteration', payload: { loop: true, iteration: laps + 1, max: loop.max_iterations } },
        { runtime: { ...runtime, loops } },
      );
    }
    loops[stage.key] = 0;
    return this.resolveSystem(
      tx,
      instance,
      definition,
      stage,
      'done',
      now,
      {
        type: 'loop_done',
        payload: { loop: true, iterations: laps, limit_reached: holds },
      },
      { runtime: { ...runtime, loops } },
    );
  }

  /**
   * P2.2: a waiting subflow stage resolves when every child closed —
   * `completed` (with the declared variables copied back) when all completed,
   * `rejected` when one was rejected, cancelled or failed, or could not start.
   * A stage that does not wait resolves `completed` at once.
   */
  private async runSubflow(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    definition: WorkflowDefinitionV1,
    stage: WorkflowStageDef,
    now: Date,
  ): Promise<TickResult> {
    const sub = stage.subflow!;
    if (sub.wait === false) {
      return this.resolveSystem(tx, instance, definition, stage, 'completed', now, {
        type: 'transitioned',
        payload: { automatic: true, subflow: true },
      });
    }
    const failedKey = `${stage.key}:${instance.stage_entry_seq}`;
    const failed = instance.runtime?.subflow_failed?.[failedKey];
    const rows: Array<{
      id: number;
      reference: string;
      status: string;
      data: Record<string, unknown> | null;
      definition_id: number;
    }> = await tx.workflow_instances.findMany({
      where: {
        store_id: instance.store_id,
        parent_instance_id: instance.id,
        parent_stage_key: stage.key,
        parent_entry_seq: instance.stage_entry_seq,
      },
      select: { id: true, reference: true, status: true, data: true, definition_id: true },
    });
    const defs: Array<{ id: number; key: string }> = rows.length
      ? await tx.workflow_definitions.findMany({
          where: { store_id: instance.store_id, id: { in: rows.map((r) => r.definition_id) } },
          select: { id: true, key: true },
        })
      : [];
    const children = rows.map((r) => ({
      ...r,
      flow_key: defs.find((d) => d.id === r.definition_id)?.key ?? null,
    }));
    const bad = children.find((c) => ['rejected', 'cancelled', 'failed'].includes(c.status));
    if (failed || bad) {
      return this.resolveSystem(tx, instance, definition, stage, 'rejected', now, {
        type: 'transitioned',
        payload: {
          automatic: true,
          subflow: true,
          reason: failed ?? `${bad!.reference}: ${bad!.status}`,
        },
      });
    }
    if (
      children.length < sub.flows.length ||
      children.some((c) => c.status !== 'completed')
    ) {
      return NOOP;
    }
    const data = { ...(instance.data ?? {}) };
    for (const [parentField, source] of Object.entries(sub.output ?? {})) {
      const [flowKey, childField] = source.split('.');
      const child = children.find((c) => c.flow_key === flowKey);
      const value = child?.data?.[childField];
      if (value !== undefined && value !== null) data[parentField] = value;
    }
    return this.resolveSystem(
      tx,
      instance,
      definition,
      stage,
      'completed',
      now,
      {
        type: 'transitioned',
        payload: {
          automatic: true,
          subflow: true,
          children: children.map((c) => c.reference),
        },
      },
      { data },
    );
  }

  /**
   * The validator rejects cycles without a human stage, but a definition from
   * before that rule or a bug must not spin forever: consecutive automatic
   * hops since the last human action are capped. The limit is above what a
   * valid chain can reach (60 stages at most).
   */
  private async exceededAutomaticHops(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
  ): Promise<boolean> {
    const recent: Array<{
      actor_type: string;
      payload: { automatic?: boolean } | null;
    }> = await tx.workflow_instance_events.findMany({
      where: { store_id: instance.store_id, instance_id: instance.id },
      orderBy: { seq: 'desc' },
      take: MAX_AUTOMATIC_HOPS * 3,
      select: { actor_type: true, payload: true },
    });
    let hops = 0;
    for (const event of recent) {
      if (event.actor_type !== SYSTEM.type) break;
      // A loop lap bounds the chain by itself (`max_iterations`, P2.4).
      if ((event.payload as { loop?: boolean } | null)?.loop === true) break;
      if (event.payload?.automatic === true) hops++;
    }
    return hops >= MAX_AUTOMATIC_HOPS;
  }

  /** Public for the error policy (P2.7, `then: fail`). */
  async fail(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    reason: string,
    now: Date,
  ): Promise<TickResult> {
    const cas = await tx.workflow_instances.updateMany({
      where: {
        id: instance.id,
        store_id: instance.store_id,
        row_version: instance.row_version,
        status: 'active',
      },
      data: {
        status: 'failed',
        completed_at: now,
        stage_due_at: null,
        row_version: { increment: 1 },
      },
    });
    if (cas.count === 0) return NOOP;
    await this.stages.cancelOpenTasks(tx, instance.store_id, instance.id);
    await this.stages.notifyParent(tx, instance);
    await this.events.append(tx, {
      store_id: instance.store_id,
      instance_id: instance.id,
      type: 'failed',
      from_stage_key: instance.current_stage_key,
      actor: SYSTEM,
      payload: { reason },
    });
    return { action: 'failed', reminded: false, escalated: false };
  }

  private async overdue(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    onOverdue: { remind_every_hours?: number; escalate_to?: any } | undefined,
    now: Date,
  ): Promise<TickResult> {
    const result: TickResult = { action: 'overdue', reminded: false, escalated: false };
    if (!onOverdue) return this.park(tx, instance, result, now);
    const openTasks: Array<{ id: number }> = await tx.workflow_tasks.findMany({
      where: {
        store_id: instance.store_id,
        instance_id: instance.id,
        stage_key: instance.current_stage_key,
        stage_entry_seq: instance.stage_entry_seq,
        status: { in: ['open', 'claimed'] },
      },
      select: { id: true },
    });
    if (openTasks.length === 0) return this.park(tx, instance, result, now);
    const taskIds = openTasks.map((t) => t.id);
    const title = `${instance.reference} · ${instance.title}`;

    // With reminders configured the current assignee gets the first one and a
    // full interval to act; only then does the task go up. Without reminders it
    // goes up on the first tick.
    const every = onOverdue.remind_every_hours;
    const last = instance.stage_last_reminded_at;
    const intervalMs = (every ?? 0) * 3_600_000;
    const assigneeWarned =
      !every || (!!last && now.getTime() - last.getTime() >= intervalMs);

    if (onOverdue.escalate_to && !instance.stage_escalated_at && assigneeWarned) {
      const stamped = await tx.workflow_instances.updateMany({
        where: {
          id: instance.id,
          store_id: instance.store_id,
          stage_entry_seq: instance.stage_entry_seq,
          stage_escalated_at: null,
        },
        // The escalation notice counts as a reminder for the new assignee.
        data: {
          stage_escalated_at: now,
          ...(every ? { stage_last_reminded_at: now } : {}),
        },
      });
      if (stamped.count === 1) {
        const target = await this.assignment.resolveDef(tx, onOverdue.escalate_to, instance);
        if (target.fields) {
          await tx.workflow_tasks.updateMany({
            where: {
              id: { in: taskIds },
              store_id: instance.store_id,
              status: { in: ['open', 'claimed'] },
            },
            data: { status: 'open', claimed_at: null, ...target.fields },
          });
          await this.notify(tx, instance, {
            title,
            message: 'Una solicitud vencida fue escalada a ti.',
            task_ids: taskIds,
          });
        }
        await this.events.append(tx, {
          store_id: instance.store_id,
          instance_id: instance.id,
          type: 'escalated',
          from_stage_key: instance.current_stage_key,
          to_stage_key: instance.current_stage_key,
          actor: SYSTEM,
          payload: {
            task_ids: taskIds,
            resolved: !!target.fields,
            reason: target.reason ?? null,
            to: onOverdue.escalate_to,
          },
        });
        await this.events.emitWebhook(tx, instance, 'workflow.task.overdue', {
          stage_key: instance.current_stage_key,
          task_ids: taskIds,
          action: 'escalated',
        });
        result.escalated = true;
        return result; // the new assignees were just notified
      }
    }

    // Already escalated (or lost the escalation race) and no reminders: done.
    if (!every) return this.park(tx, instance, result, now);
    if (!last || now.getTime() - last.getTime() >= intervalMs) {
      const stamped = await tx.workflow_instances.updateMany({
        where: {
          id: instance.id,
          store_id: instance.store_id,
          stage_entry_seq: instance.stage_entry_seq,
          stage_last_reminded_at: last,
        },
        data: { stage_last_reminded_at: now },
      });
      if (stamped.count === 1) {
        await this.notify(tx, instance, {
          title,
          message: 'Tienes una tarea vencida pendiente de atender.',
          task_ids: taskIds,
        });
        await this.events.emitWebhook(tx, instance, 'workflow.task.overdue', {
          stage_key: instance.current_stage_key,
          task_ids: taskIds,
          action: 'reminded',
        });
        result.reminded = true;
      }
    }
    return result;
  }

  /**
   * An overdue stage with nothing to send (no `on_overdue`, no open task, or
   * escalated with no reminders) still gets `stage_last_reminded_at` stamped,
   * in this transaction and by CAS: otherwise it keeps the `nulls first` head
   * of the timers batch every minute and starves the instances behind it.
   * The stamp is reset on stage entry. Not used when a reminder is configured
   * but not yet due: stamping then would shift its cadence.
   */
  private async park(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    result: TickResult,
    now: Date,
  ): Promise<TickResult> {
    await tx.workflow_instances.updateMany({
      where: {
        id: instance.id,
        store_id: instance.store_id,
        stage_entry_seq: instance.stage_entry_seq,
        stage_last_reminded_at: instance.stage_last_reminded_at,
      },
      data: { stage_last_reminded_at: now },
    });
    return result;
  }

  private notify(
    tx: WorkflowTx,
    instance: WorkflowInstanceRow,
    payload: WorkflowNotifyPayload,
  ) {
    return this.events.enqueue(tx, {
      store_id: instance.store_id,
      instance_id: instance.id,
      kind: 'notify',
      payload: payload as unknown as Record<string, unknown>,
    });
  }
}
