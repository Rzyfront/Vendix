import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
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

  /** Constante de pg_advisory_xact_lock: un solo pod ejecuta el tick. */
  private static readonly LOCK_KEY = 'service_allocation_expiry_job';
  private static readonly LOCK_TX_TIMEOUT_MS = 55_000;

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Lock distribuido: la transaccion mantiene el lock mientras corre el
      // tick; si otro pod ya lo tiene, se omite este tick.
      await this.globalPrisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${ServiceAllocationExpiryJob.LOCK_KEY})) AS locked`,
          );
          if (!rows?.[0]?.locked) {
            this.logger.debug('Another instance holds the expiry lock, skipping tick');
            return;
          }
          await this.runTick();
        },
        { timeout: ServiceAllocationExpiryJob.LOCK_TX_TIMEOUT_MS, maxWait: 5_000 },
      );
    } catch (error) {
      this.logger.error(`Service allocation expiry tick failed: ${(error as Error)?.message ?? error}`);
    } finally {
      this.running = false;
    }
  }

  private async runTick(): Promise<void> {
    {
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