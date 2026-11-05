import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { WorkflowDefinitionV1, findStage } from '@common/workflows/contract';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WorkflowAssignmentService } from './workflow-assignment.service';
import { WorkflowEmailService } from './workflow-email.service';
import { WorkflowEngineService } from './workflow-engine.service';
import {
  WorkflowInstanceRow,
  WorkflowNotifyPayload,
} from './workflow-engine.types';

export const OUTBOX_BATCH = 20;
export const OUTBOX_MAX_ATTEMPTS = 6;
/** Delay before attempt 2..6 (minutes): 1m, 5m, 30m, 2h, 12h. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 30, 120, 720];
/** A `processing` row older than this was abandoned by a dead worker. */
const STALE_PROCESSING_MINUTES = 10;
const NOTIFICATION_TYPE = 'workflow_task';

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
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.dispatchBatch();
    } catch (e) {
      this.logger.error(`Outbox dispatch failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  async dispatchBatch(limit = OUTBOX_BATCH, now = new Date()): Promise<DispatchSummary> {
    const rows = await this.claim(limit);
    const summary: DispatchSummary = { claimed: rows.length, done: 0, retried: 0, dead: 0 };
    const orgByStore = new Map<number, number>();
    for (const row of rows) {
      try {
        await this.process(row, orgByStore);
        await this.prisma.withoutScope().workflow_outbox.updateMany({
          where: { id: row.id, status: 'processing' },
          data: { status: 'done', last_error: null },
        });
        summary.done++;
      } catch (e) {
        const outcome = await this.fail(row, e, now);
        summary[outcome]++;
      }
    }
    return summary;
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
    const dead = row.attempts >= OUTBOX_MAX_ATTEMPTS;
    const delayMin =
      OUTBOX_BACKOFF_MINUTES[Math.min(row.attempts, OUTBOX_BACKOFF_MINUTES.length) - 1];
    await this.prisma.withoutScope().workflow_outbox.updateMany({
      where: { id: row.id },
      data: dead
        ? { status: 'dead', last_error: message }
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
