import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { resolveStoreTimezone } from '../../../../common/utils/store-timezone.util';
import { zonedParts } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { storeAllowsFlows } from '../engine/workflow-industry';
import { WorkflowInsightsService } from './workflow-insights.service';

export const INSIGHTS_WEEKLY_WEEKDAY = 1; // Monday
export const INSIGHTS_WEEKLY_HOUR = 8;
const CRON_LOCK_SECONDS = 50 * 60;

/**
 * P6.4: weekly AI summary. Runs every hour in the worker; for each store with
 * a published flow whose local time is Monday from 08:00 on it generates the
 * summary of that ISO week (the service skips a week that already has one, so a
 * missed 08:00 run is caught up later that Monday). A Redis lock
 * per hour keeps two instances from running the same hour; one failing store
 * never stops the rest.
 */
@Injectable()
export class WorkflowInsightsCron {
  private readonly logger = new Logger(WorkflowInsightsCron.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly insights: WorkflowInsightsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** At minute 0 of every hour. */
  @Cron('0 * * * *')
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const hourKey = now.toISOString().slice(0, 13);
      const claimed = await this.redis.set(`workflows:insights:cron:${hourKey}`, '1', 'EX', CRON_LOCK_SECONDS, 'NX');
      if (claimed !== 'OK') return;
      await this.runOnce(now);
    } catch (e) {
      this.logger.error(`Weekly insights run failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many stores got a new weekly summary. */
  async runOnce(now: Date): Promise<number> {
    const db = this.prisma.withoutScope();
    const rows = (await db.workflow_definitions.findMany({
      where: { status: 'active', published_version_id: { not: null } },
      select: { store_id: true, organization_id: true },
      distinct: ['store_id'],
    })) as Array<{ store_id: number; organization_id: number }>;

    let generated = 0;
    for (const { store_id, organization_id } of rows) {
      try {
        if (!(await storeAllowsFlows(db, store_id))) continue;
        const created = await RequestContextService.runIsolated(
          { store_id, organization_id, is_super_admin: false, is_owner: false },
          async () => {
            const parts = zonedParts(now, await resolveStoreTimezone(this.prisma, store_id));
            if (parts.weekday !== INSIGHTS_WEEKLY_WEEKDAY || parts.hour < INSIGHTS_WEEKLY_HOUR) return false;
            return (await this.insights.generateWeekly(now)) !== null;
          },
        );
        if (created) generated++;
      } catch (e) {
        this.logger.warn(`Weekly insights of store ${store_id} failed: ${(e as Error)?.message}`);
      }
    }
    return generated;
  }
}
