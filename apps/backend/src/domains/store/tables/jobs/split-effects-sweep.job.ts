import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SplitAccountPaymentService } from '../split-account-payment.service';

/**
 * Retries the financial effects (table projection, order promotion, accounting
 * event) of split-account payments that are already `succeeded` but whose
 * `financial_effects_recorded_at` is still null (B01 / S01.6). The money and
 * its cash movement are already committed; only the effects are replayed, via
 * the same idempotent `reconcilePayment` the manual `/split/reconcile` uses.
 */
@Injectable()
export class SplitEffectsSweepJob {
  private readonly logger = new Logger(SplitEffectsSweepJob.name);
  private running = false;

  /** Grace period so the request that registered the payment can finish first. */
  static readonly MIN_AGE_MS = 2 * 60_000;
  static readonly BATCH_SIZE = 100;
  private static readonly LOCK_KEY = 'split_effects_sweep_job';

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly storeContextRunner: StoreContextRunner,
    private readonly accountPayments: SplitAccountPaymentService,
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
            Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${SplitEffectsSweepJob.LOCK_KEY})) AS locked`,
          );
          if (!rows?.[0]?.locked) return 0;
          return this.reconcileStranded(tx, now);
        },
        { timeout: 280_000, maxWait: 5_000 },
      );
    } catch (error) {
      this.logger.error(
        `Split effects sweep failed: ${(error as Error)?.message ?? error}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async reconcileStranded(
    tx: Prisma.TransactionClient,
    now: Date,
  ): Promise<number> {
    const stranded = await tx.payments.findMany({
      where: {
        financial_account_id: { not: null },
        state: { in: ['succeeded', 'captured'] },
        financial_effects_recorded_at: null,
        updated_at: {
          lt: new Date(now.getTime() - SplitEffectsSweepJob.MIN_AGE_MS),
        },
      },
      select: { id: true, orders: { select: { store_id: true } } },
      orderBy: { id: 'asc' },
      take: SplitEffectsSweepJob.BATCH_SIZE,
    });
    let reconciled = 0;
    for (const payment of stranded) {
      const storeId = payment.orders?.store_id;
      if (!storeId) continue;
      try {
        await this.storeContextRunner.runInStoreContext(storeId, () =>
          this.accountPayments.reconcilePayment(payment.id),
        );
        reconciled++;
      } catch (error) {
        this.logger.error(
          `Split effects retry failed payment=${payment.id} store=${storeId}: ${(error as Error)?.message ?? error}`,
        );
      }
    }
    if (reconciled)
      this.logger.log(`Reconciled effects of ${reconciled} split payment(s)`);
    return reconciled;
  }
}
