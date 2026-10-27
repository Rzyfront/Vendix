import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

/**
 * Frees timed station/provider holds so the PostgreSQL exclusion constraint
 * agrees with availability after `expires_at`. The state transition is
 * idempotent, store-agnostic and runs as a single UPDATE: no per-store loop,
 * so stores without stations cost nothing.
 */
@Injectable()
export class ServiceAllocationExpiryJob {
  private readonly logger = new Logger(ServiceAllocationExpiryJob.name);
  private running = false;

  /** Constante de pg_advisory_xact_lock: un solo pod ejecuta el tick. */
  private static readonly LOCK_KEY = 'service_allocation_expiry_job';
  private static readonly LOCK_TX_TIMEOUT_MS = 55_000;

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Lock distribuido: la transaccion mantiene el lock mientras corre el
      // tick; si otro pod ya lo tiene, se omite este tick. El UPDATE corre en
      // la misma transaccion: una sola conexion del pool por tick.
      await this.globalPrisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${ServiceAllocationExpiryJob.LOCK_KEY})) AS locked`,
          );
          if (!rows?.[0]?.locked) {
            this.logger.debug('Another instance holds the expiry lock, skipping tick');
            return;
          }
          await this.runTick(tx);
        },
        { timeout: ServiceAllocationExpiryJob.LOCK_TX_TIMEOUT_MS, maxWait: 5_000 },
      );
    } catch (error) {
      this.logger.error(`Service allocation expiry tick failed: ${(error as Error)?.message ?? error}`);
    } finally {
      this.running = false;
    }
  }

  private async runTick(tx: Prisma.TransactionClient): Promise<void> {
    const now = new Date();
    const result = await tx.service_allocations.updateMany({
      where: {
        state: { in: ['held', 'payment_pending'] },
        expires_at: { lte: now },
      },
      data: { state: 'expired', updated_at: now },
    });
    if (result.count) this.logger.log(`Expired ${result.count} service allocation hold(s)`);
  }
}
