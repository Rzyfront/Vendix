import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionPaymentService } from './subscription-payment.service';
import { SubscriptionFraudService } from './subscription-fraud.service';
import { SubscriptionStateService } from './subscription-state.service';

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
    private readonly fraudService: SubscriptionFraudService,
    private readonly stateService: SubscriptionStateService,
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

    // RNC-29 — Chargeback / dispute detection. Wompi signals chargebacks via
    // dedicated event types (`nu.dispute.*`, `chargeback.*`) and/or via
    // `transaction.updated` with a status_message indicating a forced refund.
    // Both shapes route to the fraud service which:
    //   - increments `organizations.chargeback_count`,
    //   - flips the subscription to `suspended` with `lock_reason='chargeback'`,
    //   - reverses the partner_commission for that invoice (ledger row).
    // Event is deduped via the same `webhook_event_dedup` table the
    // transaction.updated path uses, keyed by Wompi event id (or
    // `cb_<txnId>` when the dispute payload re-uses the original transaction id).
    if (this.isChargebackEvent(body, txn)) {
      await this.handleChargebackEvent({
        subscriptionId,
        invoiceId,
        body,
        txn,
      });
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

    const txResult = await this.prisma.withoutScope().$transaction(
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
            return {
              isDuplicate: true,
              paymentNotFound: false,
              updatedPayment: null,
              paymentId: null,
            } satisfies TxResult;
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
          return {
            isDuplicate: false,
            paymentNotFound: true,
            updatedPayment: null,
            paymentId: null,
          } satisfies TxResult;
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

        return {
          isDuplicate: false,
          paymentNotFound: false,
          updatedPayment,
          paymentId: payment.id,
        } satisfies TxResult;
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

  /**
   * RNC-29 — Detect chargeback / dispute / forced-refund webhook bodies.
   *
   * Wompi shapes we accept:
   *   - body.event starts with `nu.dispute.`, `dispute.`, or `chargeback.`
   *   - body.event === 'transaction.updated' AND status is REFUNDED/VOIDED
   *     AND status_message contains 'chargeback' or 'dispute' (case-insensitive)
   *
   * The signal must be unambiguous — voluntary refunds DO NOT enter this
   * branch. Per RNC-11 Vendix never issues voluntary refunds; any refund
   * arriving here is bank-forced (a real chargeback) and must be treated as
   * one.
   */
  private isChargebackEvent(body: any, txn: any): boolean {
    const eventName = (body?.event ?? '').toString().toLowerCase();
    if (
      eventName.startsWith('nu.dispute.') ||
      eventName.startsWith('dispute.') ||
      eventName.startsWith('chargeback.')
    ) {
      return true;
    }

    // Fallback path: `transaction.updated` carrying a chargeback hint.
    const statusMessage = (txn?.status_message ?? '').toString().toLowerCase();
    if (
      eventName === 'transaction.updated' &&
      (statusMessage.includes('chargeback') ||
        statusMessage.includes('dispute') ||
        statusMessage.includes('contracargo'))
    ) {
      return true;
    }

    return false;
  }

  /**
   * RNC-29 — Process a chargeback webhook. Idempotent via `webhook_event_dedup`
   * keyed on the Wompi event id (or a derived id for dispute payloads that
   * re-reference the original transaction). All writes happen inside a single
   * ReadCommitted transaction; the post-commit emit is best-effort.
   */
  private async handleChargebackEvent(args: {
    subscriptionId: number;
    invoiceId: number;
    body: any;
    txn: any;
  }): Promise<void> {
    const { subscriptionId, invoiceId, body, txn } = args;

    // Stable dedup id. Prefer the dispute envelope id; fall back to the
    // transaction id with a `cb_` prefix so a regular `transaction.updated`
    // and its chargeback don't collide on the same dedup key.
    const eventEnvelopeId =
      body?.id ??
      body?.data?.id ??
      body?.data?.dispute?.id ??
      (txn?.id ? `cb_${txn.id}` : undefined);

    const dedupKey = eventEnvelopeId ? String(eventEnvelopeId) : undefined;

    // Resolve the subscription -> store -> organization needed by the fraud
    // service. Read outside the tx because it is a read-only lookup; the
    // critical writes (dedup insert + fraud-service writes) happen inside.
    const sub = await this.prisma
      .withoutScope()
      .store_subscriptions.findUnique({
        where: { id: subscriptionId },
        select: {
          id: true,
          store_id: true,
          state: true,
          store: { select: { organization_id: true } },
        },
      });

    if (!sub || !sub.store) {
      this.logger.warn(
        `Chargeback webhook for unknown subscription ${subscriptionId} (invoice ${invoiceId})`,
      );
      return;
    }

    const organizationId = sub.store.organization_id;

    // Idempotent dedup INSERT inside a transaction so concurrent redeliveries
    // serialize on (processor, event_id).
    const dedupResult = await this.prisma.withoutScope().$transaction(
      async (tx) => {
        if (dedupKey) {
          const inserted = await tx.$executeRaw<number>(
            Prisma.sql`
                INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
                VALUES ('wompi_platform', ${dedupKey}, 'chargeback', NOW())
                ON CONFLICT (processor, event_id) DO NOTHING
              `,
          );
          if (inserted === 0) {
            return { duplicate: true };
          }
        }
        return { duplicate: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    if (dedupResult.duplicate) {
      this.logger.log(
        `Duplicate chargeback webhook detected for invoice ${invoiceId} (event ${dedupKey}); skipping`,
      );
      return;
    }

    // Suspend the subscription with lock_reason='chargeback'. Done in a short
    // tx so the fraud-service writes (counter bump + event row) and the state
    // transition share a consistent committed view.
    try {
      if (sub.state !== 'suspended' && sub.state !== 'cancelled') {
        await this.stateService.transition(sub.store_id, 'suspended', {
          reason: 'chargeback',
          triggeredByJob: 'webhook',
          payload: {
            invoice_id: invoiceId,
            subscription_id: subscriptionId,
            wompi_event: body?.event ?? 'unknown',
            wompi_txn_id: txn?.id ?? null,
            source: 'chargeback_webhook',
          },
        });
      }
    } catch (e: any) {
      // Do not abort: chargeback bookkeeping must still run. The cron
      // reconciler will re-attempt the suspension on the next sweep.
      this.logger.warn(
        `Failed to transition sub ${subscriptionId} to suspended on chargeback: ${e?.message ?? e}`,
      );
    }

    // Bump organization-level chargeback counter + log subscription_event
    // (org block at threshold per RNC-30 happens inside fraudService).
    try {
      const txnAmount =
        typeof txn?.amount_in_cents === 'number'
          ? new Prisma.Decimal(txn.amount_in_cents).dividedBy(100)
          : undefined;
      const reason =
        (txn?.status_message as string | undefined) ??
        (body?.event as string | undefined) ??
        'wompi_chargeback';

      await this.fraudService.handleChargeback(organizationId, {
        storeId: sub.store_id,
        invoiceId,
        chargebackReason: reason,
        chargebackAmount: txnAmount,
      });
    } catch (e: any) {
      // Surface in logs; the dedup row already prevents replay so a manual
      // retry path is safe.
      this.logger.error(
        `fraudService.handleChargeback failed for org ${organizationId} ` +
          `(invoice ${invoiceId}): ${e?.message ?? e}`,
      );
    }

    // Post-commit emit — listeners (commission reversal, super-admin notif)
    // pick up from here. Wrapped because emit() is synchronous but listener
    // errors must not propagate to the webhook controller.
    try {
      this.eventEmitter.emit('subscription.chargeback.received', {
        organizationId,
        storeId: sub.store_id,
        subscriptionId,
        invoiceId,
        wompiEvent: body?.event ?? 'unknown',
        wompiTxnId: txn?.id ?? null,
      });
    } catch (e: any) {
      this.logger.warn(
        `subscription.chargeback.received emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
      );
    }
  }
}
