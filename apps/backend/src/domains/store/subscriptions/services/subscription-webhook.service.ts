import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionPaymentService } from './subscription-payment.service';

/**
 * Wompi transaction.updated payload statuses we care about.
 * Documented at https://docs.wompi.co/docs/colombia/eventos/.
 */
type WompiTransactionStatus = 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR';

export interface SubscriptionWebhookInput {
  subscriptionId: number;
  invoiceId: number;
  body: any;
}

/**
 * Routes validated platform Wompi webhooks into the subscription payment
 * state machine. Sits between PlatformWebhookController (HTTP entry) and
 * SubscriptionPaymentService (state-mutation logic).
 *
 * Idempotency invariant: if the most-recent payment row for the invoice is
 * already in a terminal state (succeeded/failed/refunded), the call is a
 * no-op. SubscriptionPaymentService.markPayment*FromWebhook() ALSO short-
 * circuits on terminal states — defense in depth so a redelivered webhook
 * never double-promotes a partner_commission to pending_payout (which would
 * silently inflate the next monthly batch).
 */
@Injectable()
export class SubscriptionWebhookService {
  private readonly logger = new Logger(SubscriptionWebhookService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleWompiEvent(input: SubscriptionWebhookInput): Promise<void> {
    const { subscriptionId, invoiceId, body } = input;
    const txn = body?.data?.transaction;

    if (!txn) {
      this.logger.warn(
        `Webhook missing transaction body for invoice ${invoiceId} (sub ${subscriptionId})`,
      );
      return;
    }

    // Resolve the payment row this webhook refers to. `orderBy: id desc`
    // alone is wrong on retries: a second attempt creates a newer row, and
    // the original Wompi APPROVED redelivery would be applied to the wrong
    // payment, double-promoting the partner_commission and corrupting the
    // payout batch.
    //
    // Lookup priority (most specific -> fallback):
    //  1. `gateway_reference` matches `txn.reference` (set by Wompi on the
    //     return from processPayment; uniquely identifies this attempt).
    //  2. `gateway_reference` matches `txn.id` (Wompi transaction id, used
    //     when the reference field wasn't populated yet — race with webhook
    //     arriving before processPayment returned).
    //  3. `metadata->>'reference'` matches `txn.reference` (the SaaS
    //     reference computed in prepareWidgetCharge / charge BEFORE the
    //     transaction id is assigned).
    //  4. Last resort: latest pending row for this invoice.
    const txnReference: string | undefined = txn?.reference;
    const txnId: string | undefined = txn?.id ? String(txn.id) : undefined;

    let payment = null as Awaited<
      ReturnType<typeof this.prisma.subscription_payments.findFirst>
    >;

    if (txnReference) {
      payment = await this.prisma.subscription_payments.findFirst({
        where: {
          invoice_id: invoiceId,
          gateway_reference: txnReference,
        },
        orderBy: { id: 'desc' },
      });
    }

    if (!payment && txnId) {
      payment = await this.prisma.subscription_payments.findFirst({
        where: {
          invoice_id: invoiceId,
          gateway_reference: txnId,
        },
        orderBy: { id: 'desc' },
      });
    }

    if (!payment && txnReference) {
      // Match by reference stored in metadata at attempt-creation time
      // (before the transaction has a gateway_reference).
      payment = await this.prisma.subscription_payments.findFirst({
        where: {
          invoice_id: invoiceId,
          metadata: {
            path: ['reference'],
            equals: txnReference,
          },
        },
        orderBy: { id: 'desc' },
      });
    }

    if (!payment) {
      // Fallback: latest pending payment for this invoice. Preserves the
      // pre-fix behaviour for legacy/edge cases where neither reference nor
      // id is matchable.
      payment = await this.prisma.subscription_payments.findFirst({
        where: { invoice_id: invoiceId, state: 'pending' },
        orderBy: { id: 'desc' },
      });
    }

    if (!payment) {
      // Absolute last resort — any payment row for this invoice.
      payment = await this.prisma.subscription_payments.findFirst({
        where: { invoice_id: invoiceId },
        orderBy: { id: 'desc' },
      });
    }

    if (!payment) {
      this.logger.warn(
        `No subscription_payments row found for invoice ${invoiceId} (sub ${subscriptionId})`,
      );
      return;
    }

    const wompiStatus = (txn.status ?? '').toString().toUpperCase() as
      | WompiTransactionStatus
      | string;

    switch (wompiStatus) {
      case 'APPROVED': {
        const updated = await this.paymentService.markPaymentSucceededFromWebhook({
          paymentId: payment.id,
          invoiceId,
          transactionId: txn.id,
          gatewayResponse: txn,
        });
        if (updated && updated.state === 'succeeded') {
          // Best-effort observability event. The internal accrual->pending_payout
          // transition lives inside SubscriptionPaymentService.handleChargeSuccess
          // and runs in the same Prisma tx; this is just a notification hook.
          this.eventEmitter.emit('subscription.payment.succeeded', {
            invoiceId,
            paymentId: payment.id,
            subscriptionId,
            source: 'webhook',
          });
        }
        return;
      }
      case 'DECLINED':
      case 'ERROR': {
        await this.paymentService.markPaymentFailedFromWebhook({
          paymentId: payment.id,
          invoiceId,
          reason: txn.status_message ?? wompiStatus,
        });
        return;
      }
      case 'VOIDED': {
        // VOIDED comes from a manual void in the Wompi dashboard or our own
        // void call; treat as failure for SaaS billing — the invoice stays
        // unpaid and the renewal cron will retry on the next attempt.
        this.logger.log(
          `Wompi VOIDED webhook for invoice ${invoiceId}; mapping to failure`,
        );
        await this.paymentService.markPaymentFailedFromWebhook({
          paymentId: payment.id,
          invoiceId,
          reason: 'voided',
        });
        return;
      }
      case 'PENDING':
      case '': {
        this.logger.log(
          `Wompi transaction still pending for invoice ${invoiceId}; ignoring webhook`,
        );
        return;
      }
      default: {
        this.logger.warn(
          `Unhandled Wompi status '${wompiStatus}' for invoice ${invoiceId}`,
        );
      }
    }
  }
}
