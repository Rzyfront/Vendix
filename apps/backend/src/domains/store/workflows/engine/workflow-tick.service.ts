import { Injectable } from '@nestjs/common';
import { resolveTransition } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAdvanceService } from './workflow-advance.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import {
  WorkflowActor,
  WorkflowInstanceRow,
  WorkflowNotifyPayload,
  WorkflowTx,
} from './workflow-engine.types';
import { WorkflowEventsService } from './workflow-events.service';
import { WorkflowLoaderService } from './workflow-loader.service';
import { WorkflowStageService } from './workflow-stage.service';

export interface TickResult {
  action: 'noop' | 'advanced' | 'failed' | 'overdue';
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
        const transition = resolveTransition(
          stage,
          'auto',
          instance.data ?? {},
          definition.fields,
        );
        if (!transition) return this.fail(tx, instance, 'no_transition', now);
        if (await this.exceededAutomaticHops(tx, instance)) {
          return this.fail(tx, instance, 'automatic_loop', now);
        }
        await this.advancer.advance({
          tx,
          instance,
          definition,
          fromStage: stage,
          toStageKey: transition.to,
          data: instance.data ?? {},
          actor: SYSTEM,
          expectedRowVersion: instance.row_version,
          runExitHooks: true,
          event: { type: 'transitioned', payload: { automatic: true } },
        });
        return { action: 'advanced', reminded: false, escalated: false };
      }

      if (!instance.stage_due_at || instance.stage_due_at > now) return NOOP;
      return this.overdue(tx, instance, stage.due?.on_overdue, now);
    });
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
      if (event.payload?.automatic === true) hops++;
    }
    return hops >= MAX_AUTOMATIC_HOPS;
  }

  private async fail(
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
