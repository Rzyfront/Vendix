import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowEngineService } from './workflow-engine.service';

export const TIMERS_BATCH = 200;
/** Smallest `remind_every_hours` is 1: a reminded instance sleeps this long. */
const REMINDER_GRANULARITY_MS = 3_600_000;

/**
 * Every minute: active instances whose stage is overdue → `tick`, which sends
 * the reminder or the single escalation. Runs only in the worker (the API
 * unmounts crons). Index: `(store_id, status, stage_due_at)`.
 */
@Injectable()
export class WorkflowTimersCron {
  private readonly logger = new Logger(WorkflowTimersCron.name);
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
      this.logger.error(`Workflow timers failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  async runOnce(now: Date, limit = TIMERS_BATCH): Promise<number> {
    const due = await this.prisma.withoutScope().workflow_instances.findMany({
      where: {
        status: 'active',
        stage_due_at: { lte: now },
        OR: [
          { stage_last_reminded_at: null },
          { stage_last_reminded_at: { lte: new Date(now.getTime() - REMINDER_GRANULARITY_MS) } },
        ],
      },
      select: { id: true, store_id: true, organization_id: true },
      orderBy: { stage_due_at: 'asc' },
      take: limit,
    });
    let ticked = 0;
    for (const row of due) {
      try {
        await RequestContextService.runIsolated(
          {
            store_id: row.store_id,
            organization_id: row.organization_id,
            is_super_admin: false,
            is_owner: false,
          },
          () => this.engine.tick(row.id, { now }),
        );
        ticked++;
      } catch (e) {
        this.logger.warn(`Tick ${row.id} failed: ${(e as Error)?.message}`);
      }
    }
    return ticked;
  }
}
