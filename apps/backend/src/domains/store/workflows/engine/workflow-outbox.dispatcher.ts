import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { WorkflowDefinitionV1, findStage } from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  DISPATCHER_CYCLE_BUDGET_MS,
  DISPATCHER_HEARTBEAT_KEY,
  DISPATCHER_HEARTBEAT_TTL_SECONDS,
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_BATCH,
  OUTBOX_MAX_ATTEMPTS,
} from './workflow-outbox.dispatcher.constants';
import { VendixHttpException } from '@common/errors';
import { WorkflowWebhookDeliveryService } from '../webhooks/workflow-webhook-delivery.service';
import { WorkflowActionsExecutor } from './workflow-actions.executor';
import { WorkflowAiStepService } from './workflow-ai-step.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowEmailService } from './workflow-email.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowTriggerFanout } from './workflow-trigger.fanout';
import {
  BUSINESS_EVENT_OUTBOX_KIND,
  BusinessEventOutboxPayload,
} from './workflow-trigger.outbox';
import {
  WorkflowInstanceRow,
  WorkflowNonRetryableError,
  WorkflowNotifyPayload,
} from './workflow-engine.types';
import { storeAllowsFlows } from './workflow-industry';
import { ApprovalGateProcessor } from '../gates/approval-gate.processor';
import {
  GATE_RESOLVED_OUTBOX_KIND,
  GATE_START_OUTBOX_KIND,
} from '../gates/approval-gate';
import {
  AI_STEP_OUTBOX_KIND,
  SUBFLOW_CLOSED_OUTBOX_KIND,
  SUBFLOW_START_OUTBOX_KIND,
} from './workflow-stage.service';

export {
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_BATCH,
  OUTBOX_MAX_ATTEMPTS,
} from './workflow-outbox.dispatcher.constants';
/** A `processing` row older than this was abandoned by a dead worker. */
const STALE_PROCESSING_MINUTES = 10;
const NOTIFICATION_TYPE = 'workflow_task';
/** `last_error` of a row buried while `processing` that had none recorded. */
export const OUTBOX_ABANDONED_ERROR =
  'Abandoned while processing after the last attempt (worker died)';

export interface ClaimedOutboxRow {
  id: number;
  store_id: number;
  instance_id: number | null;
  kind: string;
  payload: Record<string, any>;
  attempts: number;
}

export interface DispatchSummary {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
}

/** What the last dispatcher cycle left in Redis for the superadmin screen. */
export interface DispatcherHeartbeat {
  at: string;
  processed: number;
  batches: number;
  duration_ms: number;
}

/**
 * Drains `workflow_outbox`. Crons run only in the worker process (the API
 * unmounts them, see `unmountScheduledJobs` in main.ts). The claim is one
 * atomic `UPDATE … WHERE id IN (… FOR UPDATE SKIP LOCKED) RETURNING`, so two
 * workers never take the same row; delivery is at-least-once.
 */
@Injectable()
export class WorkflowOutboxDispatcher {
  private readonly logger = new Logger(WorkflowOutboxDispatcher.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly engine: WorkflowEngineService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly notifications: NotificationsService,
    private readonly mailer: WorkflowEmailService,
    private readonly webhooks: WorkflowWebhookDeliveryService,
    private readonly actions: WorkflowActionsExecutor,
    private readonly fanout: WorkflowTriggerFanout,
    private readonly gates: ApprovalGateProcessor,
    private readonly aiStep: WorkflowAiStepService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = Date.now();
    try {
      const { processed, batches } = await this.drain();
      // Only a cycle that drained beats: a failing one leaves the heartbeat to
      // age, so the superadmin screen and the `dispatcher_stalled` alert see it.
      await this.writeHeartbeat({
        at: new Date().toISOString(),
        processed,
        batches,
        duration_ms: Date.now() - startedAt,
      });
    } catch (e) {
      this.logger.error(`Outbox dispatch failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Runs batches back to back until no due row is left or the cycle budget is
   * spent, so a burst is not throttled to one batch per minute. A batch that
   * claims nothing means the queue is empty (rows scheduled for later stay put).
   */
  async drain(
    budgetMs = DISPATCHER_CYCLE_BUDGET_MS,
    clock: () => number = Date.now,
  ): Promise<{ processed: number; batches: number }> {
    const startedAt = clock();
    let processed = 0;
    let batches = 0;
    for (;;) {
      const summary = await this.dispatchBatch();
      batches++;
      processed += summary.done + summary.retried + summary.dead;
      if (summary.claimed === 0 || clock() - startedAt >= budgetMs) break;
    }
    return { processed, batches };
  }

  /** The heartbeat is observability: failing to write it never fails a cycle. */
  private async writeHeartbeat(beat: DispatcherHeartbeat): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        DISPATCHER_HEARTBEAT_KEY,
        JSON.stringify(beat),
        'EX',
        DISPATCHER_HEARTBEAT_TTL_SECONDS,
      );
    } catch (e) {
      this.logger.warn(`Outbox heartbeat not written: ${(e as Error)?.message}`);
    }
  }

  async dispatchBatch(limit = OUTBOX_BATCH, now = new Date()): Promise<DispatchSummary> {
    const buried = await this.buryExhaustedStale(now);
    const rows = await this.claim(limit);
    const summary: DispatchSummary = {
      claimed: rows.length,
      done: 0,
      retried: 0,
      dead: buried,
    };
    const orgByStore = new Map<number, number>();
    for (const row of rows) {
      try {
        await this.process(row, orgByStore);
        const { count } = await this.prisma.withoutScope().workflow_outbox.updateMany({
          where: { id: row.id, status: 'processing' },
          data: { status: 'done', last_error: null, processed_at: new Date() },
        });
        if (count === 0) {
          this.logger.warn(
            `Outbox ${row.id} (${row.kind}) finished after being buried or reclaimed by another worker`,
          );
        }
        summary.done++;
      } catch (e) {
        const outcome = await this.fail(row, e, now);
        if (outcome === 'dead') await this.afterDead(row, e);
        summary[outcome]++;
      }
    }
    return summary;
  }

  /**
   * A `processing` row is abandoned when its worker died mid-attempt, so
   * `fail()` never ran. If that was already the last attempt it goes to `dead`
   * here (keeping its `last_error`) instead of being reclaimed forever: a row
   * that kills the worker must not loop. CAS per row on `status` +
   * `available_at`, so a concurrent claim or completion wins cleanly.
   */
  private async buryExhaustedStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_PROCESSING_MINUTES * 60_000);
    const where = {
      status: 'processing' as const,
      available_at: { lte: cutoff },
      attempts: { gte: OUTBOX_MAX_ATTEMPTS },
    };
    const db = this.prisma.withoutScope();
    const stale = await db.workflow_outbox.findMany({
      where,
      take: OUTBOX_BATCH,
      select: {
        id: true,
        store_id: true,
        instance_id: true,
        kind: true,
        payload: true,
        attempts: true,
        last_error: true,
      },
    });
    let buried = 0;
    for (const r of stale) {
      const lastError = r.last_error ?? OUTBOX_ABANDONED_ERROR;
      const { count } = await db.workflow_outbox.updateMany({
        where: { ...where, id: r.id },
        data: { status: 'dead', last_error: lastError, processed_at: new Date() },
      });
      if (count === 0) continue;
      buried++;
      this.logger.warn(
        `Outbox ${r.id} (${r.kind}) DEAD: abandoned while processing at attempt ${r.attempts}`,
      );
      const row: ClaimedOutboxRow = {
        id: Number(r.id),
        store_id: r.store_id,
        instance_id: r.instance_id,
        kind: r.kind,
        payload: r.payload as Record<string, any>,
        attempts: r.attempts,
      };
      await this.afterDead(row, new Error(lastError));
    }
    return buried;
  }

  private async claim(limit: number): Promise<ClaimedOutboxRow[]> {
    const rows = await this.prisma.$queryRaw<Array<ClaimedOutboxRow & { id: bigint }>>(
      Prisma.sql`
        UPDATE workflow_outbox SET
          status = 'processing',
          attempts = attempts + 1,
          available_at = now()
        WHERE id IN (
          SELECT id FROM workflow_outbox
          WHERE (status = 'pending' AND available_at <= now())
             OR (status = 'processing'
                 AND attempts < ${Prisma.raw(String(OUTBOX_MAX_ATTEMPTS))}
                 AND available_at <= now() - ${Prisma.raw(`interval '${STALE_PROCESSING_MINUTES} minutes'`)})
          ORDER BY available_at, id
          LIMIT ${limit}::int
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, store_id, instance_id, kind, payload, attempts`,
    );
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  private async fail(
    row: ClaimedOutboxRow,
    error: unknown,
    now: Date,
  ): Promise<'retried' | 'dead'> {
    const message = ((error as Error)?.message ?? String(error)).slice(0, 1000);
    // P2.7: an action may ask for fewer retries before its error policy applies.
    const own = row.payload?.max_attempts;
    const maxAttempts =
      typeof own === 'number' && Number.isInteger(own) && own >= 1
        ? Math.min(own, OUTBOX_MAX_ATTEMPTS)
        : OUTBOX_MAX_ATTEMPTS;
    const dead = row.attempts >= maxAttempts || error instanceof WorkflowNonRetryableError;
    const delayMin =
      OUTBOX_BACKOFF_MINUTES[Math.min(row.attempts, OUTBOX_BACKOFF_MINUTES.length) - 1];
    await this.prisma.withoutScope().workflow_outbox.updateMany({
      where: { id: row.id },
      data: dead
        ? { status: 'dead', last_error: message, processed_at: new Date() }
        : {
            status: 'pending',
            last_error: message,
            available_at: new Date(now.getTime() + delayMin * 60_000),
          },
    });
    this.logger.warn(
      `Outbox ${row.id} (${row.kind}) attempt ${row.attempts} ${dead ? 'DEAD' : 'retry'}: ${message}`,
    );
    return dead ? 'dead' : 'retried';
  }

  /**
   * An exhausted `action` row leaves `action_failed` in the instance history;
   * an exhausted subflow row resolves or wakes its parent.
   */
  private async afterDead(row: ClaimedOutboxRow, error: unknown): Promise<void> {
    if (row.kind === GATE_START_OUTBOX_KIND) {
      try {
        await this.gates.abandonStart(
          row,
          ((error as Error)?.message ?? String(error)).slice(0, 500),
        );
      } catch (e) {
        this.logger.error(
          `Could not abandon gate_start ${row.id}: ${(e as Error)?.message}`,
        );
      }
      return;
    }
    const subflow =
      row.kind === SUBFLOW_START_OUTBOX_KIND || row.kind === SUBFLOW_CLOSED_OUTBOX_KIND;
    if (row.kind !== 'action' && row.kind !== AI_STEP_OUTBOX_KIND && !subflow) return;
    try {
      const store = await this.prisma
        .withoutScope()
        .stores.findFirst({ where: { id: row.store_id }, select: { organization_id: true } });
      if (!store) return;
      await RequestContextService.runIsolated(
        {
          store_id: row.store_id,
          organization_id: store.organization_id,
          is_super_admin: false,
          is_owner: false,
        },
        async () => {
          const message = ((error as Error)?.message ?? String(error)).slice(0, 500);
          if (subflow) {
            // P2.2: a dead subflow row must not leave the parent waiting forever.
            await this.engine.onSubflowDead(row, message);
            return;
          }
          if (row.kind === AI_STEP_OUTBOX_KIND) {
            // P6.1: the AI never answered; the step degrades and the owner is alerted.
            await this.aiStep.onDead(row);
            return;
          }
          await this.actions.recordFailure(row, message);
          // P2.7: alert the flow owner and apply the action's error policy.
          await this.engine.onActionDead(row, message);
        },
      );
    } catch (e) {
      this.logger.error(
        `Could not handle dead outbox ${row.id} (${row.kind}): ${(e as Error)?.message}`,
      );
    }
  }

  /**
   * Business event → instance (actor `system`). A definition that was
   * deactivated or lost its trigger since the event, or a store over its
   * monthly plan cap, is a permanent skip, not a retry loop.
   */
  private async startFromEvent(row: ClaimedOutboxRow): Promise<void> {
    const p = row.payload;
    if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, row.store_id))) {
      this.logger.warn(
        `start_instance ${row.id} skipped: store ${row.store_id} no longer has the administration industry`,
      );
      return;
    }
    try {
      await this.engine.startSystem({
        definitionId: Number(p.definition_id),
        event: String(p.event),
        eventContext: (p.event_context ?? {}) as Record<string, unknown>,
        idempotencyKey: String(p.idempotency_key),
      });
    } catch (e) {
      if (
        e instanceof VendixHttpException &&
        // P7.1: a reached monthly cap is not a failure to retry; the owners
        // were already told once by the limits service.
        [
          'WORKFLOW_NOT_ACTIVE',
          'WORKFLOW_DEFINITION_NOT_FOUND',
          'WORKFLOW_DISABLED',
          'WORKFLOW_PLAN_LIMIT_REACHED',
        ].includes(e.errorCode)
      ) {
        this.logger.warn(
          `start_instance ${row.id} skipped: ${e.errorCode} (definition ${String(p.definition_id)})`,
        );
        return;
      }
      throw e;
    }
  }

  /** Runs the effect under the tenant of the row, never under a caller's. */
  private async process(
    row: ClaimedOutboxRow,
    orgByStore: Map<number, number>,
  ): Promise<void> {
    let organizationId = orgByStore.get(row.store_id);
    if (organizationId === undefined) {
      const store = await this.prisma
        .withoutScope()
        .stores.findFirst({ where: { id: row.store_id }, select: { organization_id: true } });
      if (!store) throw new Error(`Store ${row.store_id} not found`);
      organizationId = store.organization_id;
      orgByStore.set(row.store_id, organizationId);
    }
    await RequestContextService.runIsolated(
      {
        store_id: row.store_id,
        organization_id: organizationId,
        is_super_admin: false,
        is_owner: false,
      },
      async () => {
        if (row.kind === 'advance') {
          await this.engine.tick(Number(row.payload.instance_id ?? row.instance_id), {
            expectStageEntrySeq: row.payload.stage_entry_seq,
          });
        } else if (row.kind === 'notify') {
          await this.notify(row);
        } else if (row.kind === 'webhook') {
          await this.webhooks.deliver(row);
        } else if (row.kind === BUSINESS_EVENT_OUTBOX_KIND) {
          await this.fanout.fanOut(
            row.store_id,
            row.payload as BusinessEventOutboxPayload,
          );
        } else if (row.kind === 'start_instance') {
          await this.startFromEvent(row);
        } else if (row.kind === 'action') {
          await this.actions.execute(row);
        } else if (row.kind === AI_STEP_OUTBOX_KIND) {
          await this.aiStep.execute(row);
        } else if (row.kind === GATE_START_OUTBOX_KIND) {
          await this.gates.start(row);
        } else if (row.kind === GATE_RESOLVED_OUTBOX_KIND) {
          await this.gates.resolved(row);
        } else if (row.kind === SUBFLOW_START_OUTBOX_KIND) {
          await this.engine.startSubflow({
            parentId: Number(row.payload.parent_id),
            stageKey: String(row.payload.stage_key),
            entrySeq: Number(row.payload.stage_entry_seq),
            index: Number(row.payload.index),
          });
        } else if (row.kind === SUBFLOW_CLOSED_OUTBOX_KIND) {
          await this.engine.subflowClosed({
            parentId: Number(row.payload.parent_id),
            childId: Number(row.payload.child_id),
            entrySeq:
              row.payload.stage_entry_seq === null || row.payload.stage_entry_seq === undefined
                ? null
                : Number(row.payload.stage_entry_seq),
          });
        } else {
          throw new Error(`Unsupported outbox kind: ${row.kind}`);
        }
      },
    );
  }

  /**
   * In-app first, then e-mail. Per-recipient delivery is recorded in
   * `payload.delivered` after each send, so a retry (backoff) only repeats what
   * did not go out: nobody gets the same channel twice. A failed e-mail makes the
   * row fail (retry by backoff) once all other recipients were attended.
   */
  private async notify(row: ClaimedOutboxRow): Promise<void> {
    if (!row.instance_id) return;
    const payload = row.payload as WorkflowNotifyPayload & {
      delivered?: { in_app?: number[]; email?: number[] };
    };
    const instance = (await this.prisma.workflow_instances.findFirst({
      where: { id: row.instance_id, store_id: row.store_id },
    })) as WorkflowInstanceRow | null;
    if (!instance) return;
    const resolved = await this.assignment.resolveUserIds(this.prisma, payload, instance);
    const excluded = new Set(payload.exclude_user_ids ?? []);
    const users = resolved.filter((u) => !excluded.has(u));
    const delivered = {
      in_app: [...(payload.delivered?.in_app ?? [])],
      email: [...(payload.delivered?.email ?? [])],
    };
    const save = () =>
      this.prisma.withoutScope().workflow_outbox.updateMany({
        where: { id: row.id },
        data: { payload: { ...row.payload, delivered } },
      });

    for (const userId of users) {
      if (delivered.in_app.includes(userId)) continue;
      await this.notifications.sendToUser(
        row.store_id,
        userId,
        NOTIFICATION_TYPE,
        payload.title,
        payload.message,
        {
          kind: 'workflow',
          instance_id: instance.id,
          url: `/admin/workflows/instances/${instance.id}`,
        },
      );
      delivered.in_app.push(userId);
    }
    await save();

    const version = await this.prisma.workflow_versions.findFirst({
      where: { id: instance.version_id, store_id: row.store_id },
      select: { definition: true },
    });
    const stage = version
      ? findStage(version.definition as WorkflowDefinitionV1, instance.current_stage_key)
      : undefined;
    const subject = `${instance.reference} · ${stage?.name ?? instance.title}`;
    const failed: number[] = [];
    for (const userId of users) {
      if (delivered.email.includes(userId)) continue;
      const result = await this.mailer.send({
        storeId: row.store_id,
        userId,
        instanceId: instance.id,
        subject,
        message: payload.message,
      });
      if (result === 'failed') failed.push(userId);
      else delivered.email.push(userId);
    }
    await save();
    if (failed.length > 0) {
      throw new Error(`E-mail not delivered to users: ${failed.join(',')}`);
    }
  }
}
