import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';

/**
 * Frees timed station/provider holds so the PostgreSQL exclusion constraint
 * agrees with availability after `expires_at`. The state transition is
 * idempotent and restricted to each store context.
 */
@Injectable()
export class ServiceAllocationExpiryJob {
  private readonly logger = new Logger(ServiceAllocationExpiryJob.name);
  private running = false;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const stores = await this.prisma.stores.findMany({
        where: { is_active: true },
        select: { id: true },
      });
      let expiredCount = 0;
      for (const store of stores) {
        try {
          expiredCount += await this.storeContextRunner.runInStoreContext(
            store.id,
            () => this.expireStore(store.id),
          );
        } catch (error) {
          this.logger.error(`Could not expire service allocations for store ${store.id}: ${(error as Error)?.message ?? error}`);
        }
      }
      if (expiredCount) this.logger.log(`Expired ${expiredCount} service allocation hold(s)`);
    } finally {
      this.running = false;
    }
  }

  private async expireStore(storeId: number): Promise<number> {
    const result = await this.prisma.service_allocations.updateMany({
      where: {
        store_id: storeId,
        state: { in: ['held', 'payment_pending'] },
        expires_at: { lte: new Date() },
      },
      data: { state: 'expired', updated_at: new Date() },
    });
    return result.count;
  }
}