import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import {
  FINISH_PENDING_MARKER_NEEDLE,
  OrderFlowService,
} from '../order-flow.service';

/**
 * B07/B11 — retries the closing step of orders whose money is already firm but
 * whose finish (`flow/pay`) or table settlement failed on infrastructure. They
 * carry an open `finish_pending_after_payment` marker; the same idempotent
 * `resumeFinishPendingAfterPayment` the request tried once does the work.
 */
@Injectable()
export class FinishPendingSweepJob {
  private readonly logger = new Logger(FinishPendingSweepJob.name);
  private running = false;

  /** Grace period so the request that wrote the marker can finish first. */
  static readonly MIN_AGE_MS = 2 * 60_000;
  static readonly BATCH_SIZE = 50;
  private static readonly LOCK_KEY = 'finish_pending_sweep_job';

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly storeContextRunner: StoreContextRunner,
    private readonly orderFlow: OrderFlowService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      // One pod per tick: the advisory lock lives as long as this transaction.
      return await this.globalPrisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const rows = await tx.$queryRaw<{ locked: boolean }[]>(
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${FinishPendingSweepJob.LOCK_KEY})) AS locked`,
          );
          if (!rows?.[0]?.locked) return 0;
          return this.resumeStranded(tx, now);
        },
        { timeout: 280_000, maxWait: 5_000 },
      );
    } catch (error) {
      this.logger.error(
        `Finish pending sweep failed: ${(error as Error)?.message ?? error}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async resumeStranded(
    tx: Prisma.TransactionClient,
    now: Date,
  ): Promise<number> {
    const stranded = await tx.orders.findMany({
      where: {
        state: { in: ['draft', 'created', 'processing', 'finished', 'delivered'] },
        internal_notes: { contains: FINISH_PENDING_MARKER_NEEDLE },
        updated_at: {
          lt: new Date(now.getTime() - FinishPendingSweepJob.MIN_AGE_MS),
        },
      },
      select: { id: true, store_id: true },
      orderBy: { id: 'asc' },
      take: FinishPendingSweepJob.BATCH_SIZE,
    });
    let resumed = 0;
    for (const order of stranded) {
      try {
        const outcome = await this.storeContextRunner.runInStoreContext(
          order.store_id,
          () => this.orderFlow.resumeFinishPendingAfterPayment(order.id),
        );
        if (outcome === 'resolved') resumed++;
      } catch (error) {
        this.logger.error(
          `Finish pending retry failed order=${order.id} store=${order.store_id}: ${(error as Error)?.message ?? error}`,
        );
      }
    }
    if (resumed) this.logger.log(`Resumed ${resumed} order(s) pending close after payment`);
    return resumed;
  }
}
