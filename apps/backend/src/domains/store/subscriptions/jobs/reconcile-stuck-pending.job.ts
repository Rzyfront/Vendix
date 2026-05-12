import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../services/subscription-state.service';
import { SubscriptionPaymentService } from '../services/subscription-payment.service';

/**
 * Safety-net cron that catches subscriptions stuck in `pending_payment`
 * even though their latest payment is already `succeeded`.
 *
 * Root cause covered (legacy path): when the synchronous `handleChargeSuccess`
 * promotion (inside the payment-success transaction) and the post-commit
 * `SubscriptionStateListener` BOTH fail or are dropped (NestJS event bus is
 * in-process and fire-and-forget), the subscription would stay in
 * `pending_payment` forever and the customer keeps being denied access
 * despite paying.
 *
 * ADR-2 path (new): subscriptions with a pending plan change tracked via
 * `pending_change_invoice_id` may get stuck when:
 *   A) The invoice is still in `issued` state after 60 min (webhook never arrived)
 *   B) The invoice is `paid` but `confirmPendingChange()` failed after the webhook
 *   C) The invoice is `failed`/`void` but the pending_* fields were not cleared
 *
 * Strategy:
 *   - Every 5 minutes, run TWO reconciliation passes:
 *     1. Tipo A (ADR-2): subs with pending_change_invoice_id started > 60 min ago
 *     2. Tipo B (legacy): subs in pending_payment with a succeeded payment > 1 min ago
 *        and NO pending_change_invoice_id (avoids double-handling ADR-2 subs)
 *
 * Idempotent: `transition()` / `transitionInTx()` no-ops on same-state.
 */
@Injectable()
export class ReconcileStuckPendingJob {
  private readonly logger = new Logger(ReconcileStuckPendingJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly paymentService: SubscriptionPaymentService,
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
      await this.reconcilePendingChanges();
      await this.reconcileLegacyStuckPayments();
    } catch (err: any) {
      this.logger.error(
        `ReconcileStuckPendingJob top-level failure: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Tipo A: ADR-2 — Pending plan changes stuck (pending_change_invoice_id)
  // ---------------------------------------------------------------------------

  /**
   * Find subscriptions with a pending plan change initiated more than 60 minutes
   * ago and reconcile them based on the invoice state.
   */
  private async reconcilePendingChanges(): Promise<void> {
    const cutoff60min = new Date(Date.now() - 60 * 60 * 1000);

    const stuckPendingChanges = await this.prisma
      .withoutScope()
      .store_subscriptions.findMany({
        where: {
          state: 'pending_payment',
          pending_change_started_at: {
            lt: cutoff60min,
          },
          pending_change_invoice_id: { not: null },
        },
        include: {
          pending_change_invoice: {
            select: {
              id: true,
              state: true,
              to_plan_id: true,
              from_plan_id: true,
              change_kind: true,
              store_subscription_id: true,
            },
          },
        },
        take: 100,
      });

    if (!stuckPendingChanges.length) {
      return;
    }

    this.logger.log(
      `ReconcileStuckPendingJob [ADR-2]: found ${stuckPendingChanges.length} stuck pending change(s)`,
    );

    for (const sub of stuckPendingChanges) {
      try {
        await this.reconcilePendingChange(sub);
      } catch (err: any) {
        this.logger.error(
          `Error reconciling pending change for sub ${sub.id} (store ${sub.store_id}): ${err?.message ?? err}`,
          err?.stack,
        );
      }
    }
  }

  /**
   * Reconcile a single subscription with a stuck pending plan change.
   *
   * Scenarios:
   *   - invoice.state === 'issued': webhook never arrived → void invoice + revert state
   *   - invoice.state === 'paid':   webhook arrived but confirmPendingChange() failed → re-execute
   *   - invoice.state === 'failed' | 'void': payment failed → clean up orphaned pending_* fields
   */
  private async reconcilePendingChange(sub: any): Promise<void> {
    const invoice = sub.pending_change_invoice;
    if (!invoice) {
      return;
    }

    await this.prisma.withoutScope().$transaction(
      async (tx: Prisma.TransactionClient) => {
        if (invoice.state === 'issued') {
          // ── Scenario A: Invoice stuck without a webhook after 60 min ─────────
          // Void the invoice and revert the subscription state.
          await tx.subscription_invoices.update({
            where: { id: invoice.id },
            data: { state: 'void', updated_at: new Date() },
          });

          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: {
              pending_plan_id: null,
              pending_change_invoice_id: null,
              pending_change_kind: null,
              pending_change_started_at: null,
              pending_revert_state: null,
              updated_at: new Date(),
            },
          });

          const revertState = sub.pending_revert_state ?? 'cancelled';
          const stuckMinutes = Math.round(
            (Date.now() - new Date(sub.pending_change_started_at).getTime()) /
              60000,
          );

          await this.stateService.transitionInTx(
            tx,
            sub.store_id,
            revertState,
            {
              reason: 'reconcile_stuck_pending_change',
              triggeredByJob: 'reconcile-stuck-pending',
              payload: {
                invoice_id: invoice.id,
                stuck_minutes: stuckMinutes,
              },
            },
          );

          this.logger.warn(
            JSON.stringify({
              event: 'RECONCILE_VOID_STUCK_INVOICE',
              sub_id: sub.id,
              store_id: sub.store_id,
              invoice_id: invoice.id,
              stuck_minutes: stuckMinutes,
              reverted_to: revertState,
            }),
          );
        } else if (invoice.state === 'paid') {
          // ── Scenario B: Invoice paid but confirmPendingChange() failed ────────
          // Re-execute the confirmation inside this transaction.
          await this.paymentService.confirmPendingChange(invoice, tx);

          this.logger.log(
            JSON.stringify({
              event: 'RECONCILE_CONFIRM_PAID_INVOICE',
              sub_id: sub.id,
              store_id: sub.store_id,
              invoice_id: invoice.id,
            }),
          );
        } else if (invoice.state === 'failed' || invoice.state === 'void') {
          // ── Scenario C: Payment failed / voided — clean up orphaned fields ────
          await tx.store_subscriptions.update({
            where: { id: sub.id },
            data: {
              pending_plan_id: null,
              pending_change_invoice_id: null,
              pending_change_kind: null,
              pending_change_started_at: null,
              pending_revert_state: null,
              updated_at: new Date(),
            },
          });

          if (sub.state === 'pending_payment' && sub.pending_revert_state) {
            await this.stateService.transitionInTx(
              tx,
              sub.store_id,
              sub.pending_revert_state,
              {
                reason: 'reconcile_cleanup_orphaned_pending',
                triggeredByJob: 'reconcile-stuck-pending',
              },
            );
          }

          this.logger.warn(
            JSON.stringify({
              event: 'RECONCILE_CLEANUP_ORPHANED',
              sub_id: sub.id,
              store_id: sub.store_id,
              invoice_id: invoice.id,
              invoice_state: invoice.state,
            }),
          );
        } else {
          // Unrecognized invoice state — log and skip.
          this.logger.warn(
            JSON.stringify({
              event: 'RECONCILE_UNKNOWN_INVOICE_STATE',
              sub_id: sub.id,
              invoice_id: invoice.id,
              invoice_state: invoice.state,
            }),
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  // ---------------------------------------------------------------------------
  // Tipo B: Legacy — subs stuck in pending_payment with a succeeded payment
  //         (no pending_change_invoice_id — avoids double-handling ADR-2 subs)
  // ---------------------------------------------------------------------------

  /**
   * Legacy reconciliation path.
   *
   * Catches subscriptions stuck in `pending_payment` whose newest succeeded
   * payment was confirmed more than 1 minute ago AND that do NOT have an
   * active pending plan change (i.e. pending_change_invoice_id is null).
   *
   * Root cause: when `handleChargeSuccess` promotion (inside the payment-success
   * transaction) AND the post-commit `SubscriptionStateListener` BOTH fail or
   * are dropped, the subscription stays in `pending_payment` forever.
   *
   * The 1-minute buffer avoids racing the in-flight transaction. Idempotent:
   * `transition()` no-ops on same-state, so a row promoted by the listener
   * mid-run will be skipped on the next pass.
   */
  private async reconcileLegacyStuckPayments(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 1000); // 1 min buffer

    const candidates = await this.prisma
      .withoutScope()
      .store_subscriptions.findMany({
        where: {
          state: 'pending_payment',
          // Only legacy rows — ADR-2 rows are handled by reconcilePendingChanges()
          pending_change_invoice_id: null,
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
  }
}
