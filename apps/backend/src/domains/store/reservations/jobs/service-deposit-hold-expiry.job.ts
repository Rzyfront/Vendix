import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ReservationDepositsService } from '../reservation-deposits.service';

/**
 * Releases the unpaid deposit holds (D11): cancels the booking, its pending
 * deposit rows and payment requests. `service-allocation-expiry.job.ts` only
 * flips the allocations; this one closes what hangs from them. Idempotent: each
 * booking is claimed with a conditional update, so two ticks never release twice.
 */
@Injectable()
export class ServiceDepositHoldExpiryJob {
  private readonly logger = new Logger(ServiceDepositHoldExpiryJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservationDeposits: ReservationDepositsService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expire(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const stores = await this.prisma.stores.findMany({ where: { is_active: true }, select: { id: true } });
      let released = 0;
      for (const store of stores) {
        try {
          released += await this.storeContextRunner.runInStoreContext(store.id, () =>
            this.reservationDeposits.expireOverdueHolds(),
          );
        } catch (err: unknown) {
          this.logger.error(`Hold expiry of store ${store.id} failed: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (released > 0) this.logger.log(`Released ${released} unpaid deposit hold(s)`);
    } finally {
      this.isRunning = false;
    }
  }
}
