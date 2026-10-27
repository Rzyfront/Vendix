import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingIcalImportService } from './ical-import.service';

/**
 * Hospitality Suite (H6.2) — keeps imported calendars fresh. Ticks every
 * 5 minutes; each store syncs the calendars older than its
 * `hospitality.ical_import_interval_minutes` (15 by default), inside its own
 * store context. Same shape as `LodgingNoShowJob`.
 */
@Injectable()
export class LodgingIcalImportJob {
  private readonly logger = new Logger(LodgingIcalImportJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly icalImport: LodgingIcalImportService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let total = 0;
    try {
      const stores = await this.prisma.withoutScope().lodging_ical_imports.findMany({
        where: { is_active: true },
        distinct: ['store_id'],
        select: { store_id: true },
      });
      for (const { store_id } of stores) {
        try {
          total += await this.storeContextRunner.runInStoreContext(store_id, () =>
            this.icalImport.syncDue(store_id, now),
          );
        } catch (err: unknown) {
          this.logger.error(
            `LodgingIcalImportJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      return total;
    } finally {
      this.isRunning = false;
    }
  }
}
