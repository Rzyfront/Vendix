import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import {
  localCivil,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingReservationsService } from '../reservations.service';
import { DEFAULT_NO_SHOW_TIME, noShowArrivalCutoff } from '../reservation-status';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Hospitality Suite (H1.2) — confirmed reservations whose guest never
 * arrived become "No-show" on the day after arrival at the store's
 * `hospitality.no_show_time` (store time zone), and their nights are freed.
 * Same shape as the bookings `AutoNoShowJob`: only stores with an overdue
 * candidate are visited, each inside its own store context.
 */
@Injectable()
export class LodgingNoShowJob {
  private readonly logger = new Logger(LodgingNoShowJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservations: LodgingReservationsService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let total = 0;
    try {
      // Cross-store discovery: any confirmed arrival up to yesterday in UTC
      // terms (+1 day of slack for time zones); each store decides precisely.
      const slack = new Date(now.getTime() + 86_400_000);
      const stores = await this.prisma.withoutScope().lodging_reservations.findMany({
        where: { status: 'confirmed', arrival_date: { lt: slack } },
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
            `LodgingNoShowJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (total > 0) this.logger.log(`LodgingNoShowJob: ${total} reservation(s) → no_show`);
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
    const settings = row?.settings as { hospitality?: { no_show_time?: string } } | null;
    const noShowTime = settings?.hospitality?.no_show_time || DEFAULT_NO_SHOW_TIME;
    return this.reservations.autoNoShow(noShowArrivalCutoff(today, time, noShowTime));
  }
}
