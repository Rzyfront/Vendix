import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
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

    const dedupTxnId = txn?.id ? String(txn.id) : undefined;
    const txnReference: string | undefined = txn?.reference;
    const txnId: string | undefined = txn?.id ? String(txn.id) : undefined;
    const wompiStatus = (txn.status ?? '').toString().toUpperCase() as
      | WompiTransactionStatus
      | string;

    // Fast-path for statuses that require no writes — no need to open a TX.
    if (wompiStatus === 'PENDING' || wompiStatus === '') {
      this.logger.log(
        `Wompi transaction still pending for invoice ${invoiceId}; ignoring webhook`,
      );
      return;
    }
    if (
      wompiStatus !== 'APPROVED' &&
      wompiStatus !== 'DECLINED' &&
      wompiStatus !== 'ERROR' &&
      wompiStatus !== 'VOIDED'
    ) {
      this.logger.warn(
        `Unhandled Wompi status '${wompiStatus}' for invoice ${invoiceId}`,
      );
      return;
    }

    // ── Atomic dedup + payment processing ────────────────────────────────
    //
    // The INSERT ON CONFLICT and all payment-state writes execute inside a
    // single ReadCommitted transaction.  The dedup INSERT acquires a row-level
    // lock on (processor, event_id), so two concurrent identical webhooks
    // will serialize: the second INSERT returns 0 rows and the inner block
    // returns early — before any payment write is attempted.
    //
    // NOTE: eventEmitter.emit calls are intentionally placed OUTSIDE the
    // transaction block so they fire only after the commit succeeds.
    // ──────────────────────────────────────────────────────────────────────
    type TxResult = {
      isDuplicate: boolean;
      paymentNotFound: boolean;
      updatedPayment: Awaited<
        ReturnType<typeof this.paymentService.markPaymentSucceededFromWebhook>
      >;
      paymentId: number | null;
    };

    const txResult = await this.prisma
      .withoutScope()
      .$transaction(
        async (tx) => {
          // Step 1: Deduplication INSERT — must be first so the lock is
          // acquired before any reads, preventing both workers from
          // continuing past this point simultaneously.
          if (dedupTxnId) {
            const inserted = await tx.$executeRaw<number>(
              Prisma.sql`
                INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
                VALUES ('wompi_platform', ${dedupTxnId}, 'transaction.updated', NOW())
                ON CONFLICT (processor, event_id) DO NOTHING
              `,
            );
            if (inserted === 0) {
              this.logger.log(
                `Duplicate Wompi webhook detected for transaction ${dedupTxnId} (invoice ${invoiceId}), returning 200`,
              );
              return { isDuplicate: true, paymentNotFound: false, updatedPayment: null, paymentId: null } satisfies TxResult;
            }
          }

          // Step 2: Resolve the payment row this webhook refers to.
          //
          // Lookup priority (most specific -> fallback):
          //  1. `gateway_reference` matches `txn.reference`
          //  2. `gateway_reference` matches `txn.id`
          //  3. `metadata->>'reference'` matches `txn.reference`
          //  4. Latest pending row for this invoice
          //  5. Any row for this invoice (absolute last resort)
          let payment: Awaited<
            ReturnType<typeof tx.subscription_payments.findFirst>
          > = null;

          if (txnReference) {
            payment = await tx.subscription_payments.findFirst({
              where: { invoice_id: invoiceId, gateway_reference: txnReference },
              orderBy: { id: 'desc' },
            });
          }

          if (!payment && txnId) {
            payment = await tx.subscription_payments.findFirst({
              where: { invoice_id: invoiceId, gateway_reference: txnId },
              orderBy: { id: 'desc' },
            });
          }

          if (!payment && txnReference) {
            payment = await tx.subscription_payments.findFirst({
              where: {
                invoice_id: invoiceId,
                metadata: { path: ['reference'], equals: txnReference },
              },
              orderBy: { id: 'desc' },
            });
          }

          if (!payment) {
            payment = await tx.subscription_payments.findFirst({
              where: { invoice_id: invoiceId, state: 'pending' },
              orderBy: { id: 'desc' },
            });
          }

          if (!payment) {
            payment = await tx.subscription_payments.findFirst({
              where: { invoice_id: invoiceId },
              orderBy: { id: 'desc' },
            });
          }

          if (!payment) {
            this.logger.warn(
              `No subscription_payments row found for invoice ${invoiceId} (sub ${subscriptionId})`,
            );
            return { isDuplicate: false, paymentNotFound: true, updatedPayment: null, paymentId: null } satisfies TxResult;
          }

          // Step 3: Mutate payment state — pass `tx` so all writes stay
          // inside THIS transaction (no nested $transaction opened).
          let updatedPayment: Awaited<
            ReturnType<typeof this.paymentService.markPaymentSucceededFromWebhook>
          > = null;

          switch (wompiStatus) {
            case 'APPROVED': {
              updatedPayment =
                await this.paymentService.markPaymentSucceededFromWebhook(
                  {
                    paymentId: payment.id,
                    invoiceId,
                    transactionId: txn.id,
                    gatewayResponse: txn,
                  },
                  tx,
                );
              break;
            }
            case 'DECLINED':
            case 'ERROR': {
              updatedPayment =
                await this.paymentService.markPaymentFailedFromWebhook(
                  {
                    paymentId: payment.id,
                    invoiceId,
                    reason: txn.status_message ?? wompiStatus,
                  },
                  tx,
                );
              break;
            }
            case 'VOIDED': {
              this.logger.log(
                `Wompi VOIDED webhook for invoice ${invoiceId}; mapping to failure`,
              );
              updatedPayment =
                await this.paymentService.markPaymentFailedFromWebhook(
                  {
                    paymentId: payment.id,
                    invoiceId,
                    reason: 'voided',
                  },
                  tx,
                );
              break;
            }
          }

          return { isDuplicate: false, paymentNotFound: false, updatedPayment, paymentId: payment.id } satisfies TxResult;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

    // ── Post-commit side effects ──────────────────────────────────────────
    // All side effects below run AFTER the transaction commits so they always
    // observe the committed state and are not executed on rollback.
    if (txResult.isDuplicate || txResult.paymentNotFound) {
      return;
    }

    if (
      wompiStatus === 'APPROVED' &&
      txResult.updatedPayment?.state === 'succeeded'
    ) {
      // Enqueue the commission-accrual BullMQ job post-commit.
      // The outbox row (commission_accrual_pending) was inserted inside the tx;
      // the job will process it asynchronously.
      await this.paymentService.enqueueCommissionAccrualPostCommit(invoiceId);

      // Best-effort observability event. The internal accrual->pending_payout
      // transition lives inside SubscriptionPaymentService.handleChargeSuccess
      // and ran inside the tx above; this is just a notification hook.
      this.eventEmitter.emit('subscription.payment.succeeded', {
        invoiceId,
        paymentId: txResult.paymentId,
        subscriptionId,
        source: 'webhook',
      });
    }
  }
}
