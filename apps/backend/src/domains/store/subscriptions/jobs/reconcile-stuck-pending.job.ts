import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../services/subscription-state.service';

/**
 * Safety-net cron that catches subscriptions stuck in `pending_payment`
 * even though their latest payment is already `succeeded`.
 *
 * Root cause covered: when the synchronous `handleChargeSuccess` promotion
 * (inside the payment-success transaction) and the post-commit
 * `SubscriptionStateListener` BOTH fail or are dropped (NestJS event bus is
 * in-process and fire-and-forget), the subscription would stay in
 * `pending_payment` forever and the customer keeps being denied access
 * despite paying.
 *
 * Strategy: every 5 minutes, find pending_payment subscriptions whose
 * latest payment is `succeeded` and was confirmed more than 1 minute ago
 * (the 1-minute buffer avoids racing the in-flight transaction). Promote
 * each of them via `SubscriptionStateService.transition()` and emit a
 * WARN log so ops can investigate why the synchronous path didn't win.
 *
 * Idempotent: `transition()` no-ops on same-state, so a row that gets
 * promoted by the listener mid-run will be skipped on the next pass.
 */
@Injectable()
export class ReconcileStuckPendingJob {
  private readonly logger = new Logger(ReconcileStuckPendingJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcile(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'ReconcileStuckPendingJob already running, skipping this tick',
      );
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - 60 * 1000); // 1 min buffer

      // Pull candidates: subscriptions in pending_payment whose newest
      // succeeded payment was confirmed before the cutoff. We bypass tenant
      // scopes (cron has no request context) and look directly at the
      // succeeded payment via a relation filter.
      const candidates = await this.prisma
        .withoutScope()
        .store_subscriptions.findMany({
          where: {
            state: 'pending_payment',
            invoices: {
              some: {
                payments: {
                  some: {
                    state: 'succeeded',
                    paid_at: { lt: cutoff },
                  },
                },
              },
            },
          },
          select: {
            id: true,
            store_id: true,
            invoices: {
              where: {
                payments: {
                  some: {
                    state: 'succeeded',
                    paid_at: { lt: cutoff },
                  },
                },
              },
              orderBy: { id: 'desc' },
              take: 1,
              select: {
                id: true,
                payments: {
                  where: { state: 'succeeded' },
                  orderBy: { paid_at: 'desc' },
                  take: 1,
                  select: { id: true, paid_at: true },
                },
              },
            },
          },
          take: 100,
        });

      if (!candidates.length) {
        return;
      }

      for (const sub of candidates) {
        const lastInvoice = sub.invoices[0];
        const lastPayment = lastInvoice?.payments[0];

        try {
          await this.stateService.transition(sub.store_id, 'active', {
            reason: 'webhook_state_drift',
            triggeredByJob: 'cron_reconciliation',
            payload: {
              invoice_id: lastInvoice?.id,
              payment_id: lastPayment?.id,
              succeeded_at: lastPayment?.paid_at?.toISOString() ?? null,
              source: 'reconcile-stuck-pending-job',
            },
          });

          // WARN level — every reconciliation is a signal that the
          // synchronous webhook promotion + listener BOTH missed this row.
          this.logger.warn({
            msg: 'STATE_ENGINE_RECONCILED',
            subscriptionId: sub.id,
            storeId: sub.store_id,
            invoiceId: lastInvoice?.id,
            paymentId: lastPayment?.id,
            succeededAt: lastPayment?.paid_at,
            note: 'subscription was stuck in pending_payment despite a succeeded payment; reconciled to active',
          });
        } catch (err: any) {
          this.logger.error(
            `Reconcile failed for subscription ${sub.id} (store ${sub.store_id}): ${err?.message ?? err}`,
            err?.stack,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(
        `ReconcileStuckPendingJob top-level failure: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
