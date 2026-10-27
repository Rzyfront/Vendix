import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { localCivil, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingFolioService } from '../folio/folio.service';
import { DEFAULT_NIGHT_AUDIT_TIME, nightAuditCutoff } from '../folio/folio-nights';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Hospitality Suite (H3.4) — night audit: at the store's
 * `hospitality.night_audit_time` (store time zone) every in-house folio gets
 * the nights already slept that it does not have yet. Posting is idempotent
 * per night (`lodging_room_nights.posted_order_item_id`), so running every
 * 10 minutes only charges a night once. Same shape as `LodgingNoShowJob`.
 */
@Injectable()
export class LodgingNightAuditJob {
  private readonly logger = new Logger(LodgingNightAuditJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly folios: LodgingFolioService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let total = 0;
    try {
      // Cross-store discovery: stores with an open folio; each decides its day.
      const stores = await this.prisma.withoutScope().lodging_folios.findMany({
        where: { status: 'open' },
        distinct: ['store_id'],
        select: { store_id: true },
      });
      for (const { store_id } of stores) {
        try {
          total += await this.storeContextRunner.runInStoreContext(store_id, () =>
            this.runStore(store_id, now),
          );
        } catch (err: unknown) {
          this.logger.error(
            `LodgingNightAuditJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (total > 0) this.logger.log(`LodgingNightAuditJob: ${total} night(s) posted`);
      return total;
    } finally {
      this.isRunning = false;
    }
  }

  private async runStore(store_id: number, now: Date): Promise<number> {
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const local = localCivil(now, timezone);
    const today = `${local.year}-${pad2(local.month)}-${pad2(local.day)}`;
    const time = `${pad2(local.hour)}:${pad2(local.minute)}`;
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = row?.settings as { hospitality?: { night_audit_time?: string } } | null;
    const auditTime = settings?.hospitality?.night_audit_time || DEFAULT_NIGHT_AUDIT_TIME;
    const cutoff = nightAuditCutoff(today, time, auditTime);

    const folios = await this.prisma.lodging_folios.findMany({
      where: { status: 'open', reservation: { status: 'checked_in' } },
      select: { id: true, status: true, reservation_id: true, order_id: true },
    });
    let posted = 0;
    for (const folio of folios) {
      try {
        posted += await this.folios.postNightsThrough(folio, cutoff, false);
      } catch (err: unknown) {
        // One folio failing never blocks the rest of the hotel.
        this.logger.error(
          `LodgingNightAuditJob folio ${folio.id} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return posted;
  }
}
