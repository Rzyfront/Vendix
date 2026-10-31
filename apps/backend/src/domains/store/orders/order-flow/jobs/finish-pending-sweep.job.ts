import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { OrderFlowService } from '../order-flow.service';

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
      const stranded = await this.claimStranded(now);
      return await this.resumeStranded(stranded);
    } catch (error) {
      this.logger.error(
        `Finish pending sweep failed: ${(error as Error)?.message ?? error}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * R3 #6 — short claim: under the advisory lock (one pod per tick) picks the
   * batch by the indexed `finish_pending_at` and leases it by moving that
   * stamp to `now`, so no other pod/tick takes it within `MIN_AGE_MS`. The
   * transaction ends here; the resumes run outside it.
   */
  private async claimStranded(
    now: Date,
  ): Promise<{ id: number; store_id: number }[]> {
    return this.globalPrisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const rows = await tx.$queryRaw<{ locked: boolean }[]>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${FinishPendingSweepJob.LOCK_KEY})) AS locked`,
        );
        if (!rows?.[0]?.locked) return [];
        const stranded = await tx.orders.findMany({
          where: {
            finish_pending_at: {
              lt: new Date(now.getTime() - FinishPendingSweepJob.MIN_AGE_MS),
            },
          } as Prisma.ordersWhereInput,
          select: { id: true, store_id: true },
          orderBy: { id: 'asc' },
          take: FinishPendingSweepJob.BATCH_SIZE,
        });
        if (stranded.length) {
          await tx.orders.updateMany({
            where: { id: { in: stranded.map((o) => o.id) } },
            data: { finish_pending_at: now } as Prisma.ordersUpdateManyMutationInput,
          });
        }
        return stranded;
      },
      { timeout: 10_000, maxWait: 5_000 },
    );
  }

  private async resumeStranded(
    stranded: { id: number; store_id: number }[],
  ): Promise<number> {
    let resumed = 0;
    for (const order of stranded) {
      try {
        const outcome = await this.storeContextRunner.runInStoreContext(
          order.store_id,
          () => this.orderFlow.resumeFinishPendingAfterPayment(order.id),
        );
        if (outcome === 'resolved') resumed++;
        else await this.releaseOrphanStamp(order.id);
      } catch (error) {
        this.logger.error(
          `Finish pending retry failed order=${order.id} store=${order.store_id}: ${(error as Error)?.message ?? error}`,
        );
      }
    }
    if (resumed) this.logger.log(`Resumed ${resumed} order(s) pending close after payment`);
    return resumed;
  }

  /** No open marker behind the stamp (`skipped`): clear it so it stops being leased. */
  private async releaseOrphanStamp(orderId: number): Promise<void> {
    await this.globalPrisma.orders.updateMany({
      where: { id: orderId },
      data: { finish_pending_at: null } as Prisma.ordersUpdateManyMutationInput,
    });
  }
}
