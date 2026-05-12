import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionPaymentService } from '../domains/store/subscriptions/services/subscription-payment.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface SubscriptionPaymentRetryData {
  invoiceId: number;
  subscriptionId: number;
  storeId?: number;
  attempt: number;
}

/**
 * Retries a failed SaaS subscription charge via SubscriptionPaymentService.
 *
 * Design:
 * - Each invocation calls `chargeInvoice(invoiceId)` once. The provider
 *   idempotency key (`sub_inv_${invoiceId}_att_${counter}`) is derived inside
 *   `charge()` from the count of existing `subscription_payments` rows for the
 *   invoice, so every BullMQ attempt naturally produces a fresh, stable key —
 *   the gateway will deduplicate accidental double-fires of the same attempt.
 * - On `state='failed'` (or unknown non-terminal state) we throw so BullMQ
 *   applies the configured exponential backoff and retries.
 * - When `attempts` is exhausted BullMQ marks the job as failed permanently.
 *   We DO NOT force a transition to grace_hard from here — the
 *   SubscriptionStateEngine cron (3am daily) is the canonical source for
 *   state transitions based on dunning windows.
 */
@Processor('subscription-payment-retry')
export class SubscriptionPaymentRetryJob extends WorkerHost {
  private readonly logger = new Logger(SubscriptionPaymentRetryJob.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<SubscriptionPaymentRetryData>): Promise<{
    paymentId?: number;
    state?: string;
    skipped?: boolean;
    reason?: string;
  }> {
    const { invoiceId, subscriptionId, storeId } = job.data;
    // BullMQ exposes attempts already made; the human-friendly attempt
    // number for logging is +1 (covers the current run).
    const currentAttempt = (job.attemptsMade ?? 0) + 1;

    this.logger.log(
      `Retry attempt ${currentAttempt} for invoice ${invoiceId} (subscription ${subscriptionId})`,
    );

    // Short-circuit if invoice was already resolved (paid via webhook,
    // refunded, voided, etc.). This prevents redundant gateway calls when
    // an out-of-band path settled the invoice between scheduling and now.
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
      select: { id: true, state: true, store_id: true },
    });

    if (!invoice) {
      this.logger.warn(`Invoice ${invoiceId} not found — skipping retry`);
      return { skipped: true, reason: 'invoice_not_found' };
    }

    if (invoice.state === 'paid' || invoice.state === 'void') {
      this.logger.log(
        `Invoice ${invoiceId} already resolved (state=${invoice.state}) — skipping retry`,
      );
      return { skipped: true, reason: 'already_resolved' };
    }

    try {
      const result = await this.paymentService.chargeInvoice(invoiceId);

      if (result.state === 'succeeded') {
        this.logger.log(
          `Retry succeeded for invoice ${invoiceId} on attempt ${currentAttempt} (payment ${result.id})`,
        );
        return { paymentId: result.id, state: result.state };
      }

      if (result.state === 'failed') {
        this.eventEmitter.emit('subscription.payment.retry.failed', {
          invoiceId,
          subscriptionId,
          storeId: storeId ?? invoice.store_id,
          attempt: currentAttempt,
          paymentId: result.id,
        });

        // Throw so BullMQ honors the `attempts` + `backoff` config and
        // schedules the next retry. When attempts are exhausted BullMQ
        // marks the job as permanently failed; the state engine cron
        // handles the grace_hard transition.
        throw new Error(
          `Charge failed for invoice ${invoiceId} on attempt ${currentAttempt}: payment ${result.id} state=failed`,
        );
      }

      // Non-terminal (pending / unknown). Treat as a soft failure so BullMQ
      // retries — the alternative (returning success) would silently strand
      // the invoice in pending forever.
      throw new Error(
        `Charge ended in non-terminal state '${result.state}' for invoice ${invoiceId} on attempt ${currentAttempt}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Retry attempt ${currentAttempt} failed for invoice ${invoiceId}: ${error?.message ?? error}`,
      );
      // Re-throw so BullMQ applies backoff + counts the attempt. When attempts
      // are exhausted BullMQ marks the job as failed — we deliberately do NOT
      // force a state transition here (see class-level docstring).
      throw error;
    }
  }
}
