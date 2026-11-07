import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { storeAllowsFlows } from '../../workflows/engine/workflow-industry';
import { DEFAULT_STORE_TIMEZONE } from '../../workflows/engine/workflow-stage.service';
import { DocumentRetentionService } from './document-retention.service';

/**
 * P4.4: scheduled retention purge. Fires monthly in the worker; the run flag is
 * a `schedule` run of the store in the last `RERUN_WINDOW_MS`, so a repeated
 * fire (restart, second worker) purges nothing twice. The window does not
 * depend on any time zone: the fire of the next month is always outside it. A store without active
 * policies, or without the Flujos industry, is skipped. One failing store never
 * stops the rest.
 */
/** Shorter than any month and longer than any retry of the same fire. */
export const RERUN_WINDOW_MS = 20 * 24 * 60 * 60 * 1000;

@Injectable()
export class DocumentRetentionCron {
  private readonly logger = new Logger(DocumentRetentionCron.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly retention: DocumentRetentionService,
  ) {}

  /** 03:00 (store default time zone) on the 1st of every month. */
  @Cron('0 3 1 * *', { timeZone: DEFAULT_STORE_TIMEZONE })
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce(new Date());
    } catch (e) {
      this.logger.error(`Retention purge failed: ${(e as Error)?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many stores got a new run. */
  async runOnce(now: Date): Promise<number> {
    const db = this.prisma.withoutScope() as any;
    const policies: Array<{ store_id: number; organization_id: number }> =
      await db.document_retention_policies.findMany({
        where: { is_active: true },
        select: { store_id: true, organization_id: true },
      });
    const stores = new Map(policies.map((p) => [p.store_id, p.organization_id]));
    let started = 0;
    for (const [storeId, organizationId] of stores) {
      try {
        if (!(await storeAllowsFlows(db, storeId))) continue;
        const since = new Date(now.getTime() - RERUN_WINDOW_MS);
        const ran = await RequestContextService.runIsolated(
          {
            store_id: storeId,
            organization_id: organizationId,
            is_super_admin: false,
            is_owner: false,
          },
          async () => {
            const already = await this.prisma.document_purge_runs.findFirst({
              where: { store_id: storeId, trigger: 'schedule', started_at: { gte: since } },
              select: { id: true },
            });
            if (already) return false;
            await this.retention.run('schedule', now);
            return true;
          },
        );
        if (ran) started++;
      } catch (e) {
        this.logger.warn(`Retention purge of store ${storeId} failed: ${(e as Error)?.message}`);
      }
    }
    return started;
  }
}
