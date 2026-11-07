import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import {
  WorkflowTriggerDef,
  cronMatches,
  parseCron,
  zonedParts,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { storeAllowsFlows } from './workflow-industry';
import { DEFAULT_STORE_TIMEZONE } from './workflow-stage.service';

/**
 * Minutes looked back on each run: a worker restart or a slow batch does not
 * lose a fire, and the idempotency key keeps each minute to one request.
 */
export const SCHEDULE_LOOKBACK_MINUTES = 5;

interface ScheduledRow {
  id: number;
  store_id: number;
  organization_id: number;
  triggers: WorkflowTriggerDef[] | null;
  timezone: string | null;
}

/**
 * P2.10: starts flows with a `schedule` trigger. Runs in the worker every
 * minute; each cron is matched minute by minute in the store's time zone over
 * the look-back window and every match starts one request (actor `system`)
 * with the key `schedule:<definition>:<minute>`, so overlapping runs and
 * several workers never start the same fire twice. Switched-off, archived or
 * unpublished flows are left out by the query.
 */
@Injectable()
export class WorkflowScheduleCron {
  private readonly logger = new Logger(WorkflowScheduleCron.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly engine: WorkflowEngineService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce(new Date());
    } catch (e) {
      this.logger.error(`Workflow schedules failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many requests were started. */
  async runOnce(now: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<ScheduledRow[]>(Prisma.sql`
      SELECT d.id, d.store_id, d.organization_id,
             v.definition->'triggers' AS triggers, s.timezone
      FROM workflow_definitions d
      JOIN workflow_versions v ON v.id = d.published_version_id
      JOIN stores s ON s.id = d.store_id
      WHERE d.status = 'active'
        AND d.is_enabled = true
        AND v.definition->'triggers' @> '[{"kind":"schedule"}]'::jsonb`);
    let started = 0;
    const minute = Math.floor(now.getTime() / 60_000) * 60_000;
    for (const row of rows) {
      try {
        if (!(await storeAllowsFlows(this.prisma.withoutScope() as never, row.store_id))) {
          continue;
        }
        const tz = row.timezone || DEFAULT_STORE_TIMEZONE;
        for (const trigger of row.triggers ?? []) {
          if (trigger.kind !== 'schedule') continue;
          const parsed = parseCron(trigger.cron);
          if (!parsed.ok) continue;
          for (let k = SCHEDULE_LOOKBACK_MINUTES - 1; k >= 0; k--) {
            const at = new Date(minute - k * 60_000);
            if (!cronMatches(parsed.cron, zonedParts(at, tz))) continue;
            const result = await RequestContextService.runIsolated(
              {
                store_id: row.store_id,
                organization_id: row.organization_id,
                is_super_admin: false,
                is_owner: false,
              },
              () =>
                this.engine.startScheduled({
                  definitionId: row.id,
                  cron: trigger.cron,
                  fireAt: at.toISOString().slice(0, 16),
                }),
            );
            if (result && !result.replayed) started++;
          }
        }
      } catch (e) {
        this.logger.warn(
          `Schedule of definition ${row.id} failed: ${(e as Error)?.message}`,
        );
      }
    }
    return started;
  }
}
