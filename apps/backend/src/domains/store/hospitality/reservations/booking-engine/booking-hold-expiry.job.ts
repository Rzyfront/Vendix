import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingBookingEngineService } from './booking-engine.service';

/**
 * Hospitality Suite (H6.6) — a web booking not paid within
 * `hospitality.booking_hold_minutes` is cancelled and its nights return to
 * sale. Only stores with an expired hold are visited, each in its own store
 * context (same shape as `LodgingNoShowJob`).
 */
@Injectable()
export class BookingHoldExpiryJob {
  private readonly logger = new Logger(BookingHoldExpiryJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly bookingEngine: LodgingBookingEngineService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(now: Date = new Date()): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    let total = 0;
    try {
      const stores = await this.prisma.withoutScope().lodging_reservations.findMany({
        where: { status: 'tentative', hold_expires_at: { lt: now } },
        distinct: ['store_id'],
        select: { store_id: true },
      });
      for (const { store_id } of stores) {
        try {
          total += await this.storeContextRunner.runInStoreContext(store_id, () =>
            this.bookingEngine.expireHolds(now),
          );
        } catch (err: unknown) {
          this.logger.error(
            `BookingHoldExpiryJob store ${store_id} failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (total > 0) this.logger.log(`BookingHoldExpiryJob: ${total} web hold(s) expired`);
      return total;
    } finally {
      this.isRunning = false;
    }
  }
}
