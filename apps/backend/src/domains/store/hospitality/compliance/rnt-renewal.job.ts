import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { localCivil, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { mergeStoreSettingsWithDefaults } from '../../settings/defaults/default-store-settings';
import { RntSettings, rntRenewalNotice } from './rnt';

export const RNT_RENEWAL_NOTIFICATION_TYPE = 'lodging_rnt_renewal';

/**
 * Hospitality Suite (H4.3) — every March (store time zone) each active hotel
 * with an RNT gets ONE bell notification to renew it before March 31. The
 * owner turns it off with `hospitality.rnt_renewal_reminder = false`. Purely
 * informative (D14): nothing in the hotel depends on it.
 */
@Injectable()
export class LodgingRntRenewalJob {
  private readonly logger = new Logger(LodgingRntRenewalJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  /** 13:00 UTC = 08:00 in Colombia, when the day's work starts. */
  @Cron(CronExpression.EVERY_DAY_AT_1PM)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let sent = 0;
    try {
      const client = this.prisma.withoutScope();
      const stores = await client.stores.findMany({
        where: { is_active: true, industries: { has: 'hospitality' } },
        select: { id: true },
      });
      for (const { id: store_id } of stores) {
        try {
          sent += await this.storeContextRunner.runInStoreContext(store_id, () =>
            this.runStore(store_id, now),
          );
        } catch (err: unknown) {
          this.logger.error(
            `LodgingRntRenewalJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (sent > 0) this.logger.log(`LodgingRntRenewalJob: ${sent} RNT renewal reminder(s) sent`);
      return sent;
    } finally {
      this.isRunning = false;
    }
  }

  private async runStore(store_id: number, now: Date): Promise<number> {
    const client = this.prisma.withoutScope();
    const local = localCivil(now, await resolveStoreTimezone(this.prisma, store_id));
    const row = await client.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const hospitality = mergeStoreSettingsWithDefaults(row?.settings)?.hospitality as RntSettings | undefined;
    const notice = rntRenewalNotice(hospitality, local);
    if (!notice) return 0;

    // Once per year: this March's reminder already went out.
    const already = await client.notifications.findFirst({
      where: {
        store_id,
        type: RNT_RENEWAL_NOTIFICATION_TYPE,
        created_at: { gte: new Date(Date.UTC(local.year, 0, 1)) },
      },
      select: { id: true },
    });
    if (already) return 0;

    const created = await this.notifications.createAndBroadcast(
      store_id,
      RNT_RENEWAL_NOTIFICATION_TYPE,
      notice.title,
      notice.body,
      notice.data,
    );
    return created ? 1 : 0;
  }
}
