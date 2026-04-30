import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Prisma,
  subscription_payments,
  subscription_payment_method_state_enum,
} from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PaymentGatewayService } from '../../payments/services/payment-gateway.service';
import {
  PaymentData,
  PaymentStatus,
} from '../../payments/interfaces/payment-processor.interface';
import { WompiProcessor } from '../../payments/processors/wompi/wompi.processor';
import {
  WompiEnvironment,
  WompiTransactionData,
} from '../../payments/processors/wompi/wompi.types';
import { WompiClientFactory } from '../../payments/processors/wompi/wompi.factory';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { PlatformGatewayEnvironmentEnum } from '../../../superadmin/subscriptions/gateway/dto/upsert-gateway.dto';
import { SubscriptionBillingService } from './subscription-billing.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { SubscriptionStateService } from './subscription-state.service';
import { SubscriptionResolverService } from './subscription-resolver.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { isLegacyInlineTokenAllowed } from '../../payments/config/wompi-rollout.config';

/**
 * States from which a successful payment should synchronously promote the
 * subscription to `active` inside the same transaction that flips the
 * payment row to `succeeded`. This eliminates the
 * "payment succeeded but subscription still pending_payment" drift that
 * happens when the post-commit listener (`SubscriptionStateListener`) is
 * delayed, fails, or is silently dropped.
 *
 * Recovery states (grace_soft, grace_hard, suspended, blocked) are included
 * here because the cron / event-driven listener already promote them — doing
 * it synchronously here is a strict superset and safe (the listener becomes
 * a no-op when the sub is already active, see same-state guard in
 * transitionInTx).
 */
const PROMOTABLE_ON_PAYMENT_SUCCESS = [
  'pending_payment',
  'grace_soft',
  'grace_hard',
  'suspended',
  'blocked',
] as const;

const DECIMAL_ZERO = new Prisma.Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * S3.5 — Threshold of consecutive failed automatic charges against a saved
 * payment method before the PM is auto-invalidated (`state='invalid'`,
 * `is_default=false`) and the customer is notified to update their card.
 *
 * Exported so unit tests can assert behavior at the boundary without
 * hard-coding a magic number.
 */
export const MAX_CONSECUTIVE_FAILURES = 3;

export interface SaasWompiWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
}

@Injectable()
export class SubscriptionPaymentService {
  private readonly logger = new Logger(SubscriptionPaymentService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly gateway: PaymentGatewayService,
    private readonly billing: SubscriptionBillingService,
    private readonly commissionsService: PartnerCommissionsService,
    private readonly stateService: SubscriptionStateService,
    private readonly resolver: SubscriptionResolverService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly platformGw: PlatformGatewayService,
    private readonly wompiProcessor: WompiProcessor,
    private readonly wompiClientFactory: WompiClientFactory,
    @InjectQueue('commission-accrual')
    private readonly commissionQueue: Queue,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Charge an invoice via the payment gateway.
   * On success: updates invoice state, creates payment record, and accrues
   * partner commission if applicable.
   */
  async chargeInvoice(invoiceId: number): Promise<subscription_payments> {
    return this.charge(invoiceId);
  }

  /**
   * Enqueue the commission-accrual BullMQ job for a given invoice after a
   * webhook-driven payment success.  Must be called AFTER the atomic
   * dedup+payment transaction commits — never inside the transaction body.
   *
   * This is the post-commit counterpart to the in-tx outbox row inserted by
   * handleChargeSuccess when called with an externalTx.  If the enqueue
   * fails the outbox row stays pending and will be picked up by
   * reconciliation or manual retry.
   */
  async enqueueCommissionAccrualPostCommit(invoiceId: number): Promise<void> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice?.partner_organization_id) {
      return;
    }
    const splitBreakdown = invoice.split_breakdown as Record<
      string,
      unknown
    > | null;
    const partnerShare = splitBreakdown?.partner_share
      ? new Prisma.Decimal(splitBreakdown.partner_share as string)
      : DECIMAL_ZERO;
    if (!partnerShare.greaterThan(DECIMAL_ZERO)) {
      return;
    }
    try {
      await this.commissionQueue.add(
        'accrual',
        { invoiceId },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 3600, count: 100 },
          removeOnFail: { age: 86400 },
        },
      );
    } catch (e: any) {
      this.logger.warn(
        `Failed to enqueue commission accrual job (webhook path) for invoice ${invoiceId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Prepare a Wompi WidgetCheckout payload for an invoice. Returns the config
   * the frontend feeds into `new WidgetCheckout({...}).open(cb)` — same flow
   * the eCommerce checkout uses, so users stay inside Vendix instead of
   * being redirected to the hosted page.
   *
   * The payment row is created in `pending`. The actual "succeeded" / "failed"
   * transition is driven by the platform Wompi webhook
   * (POST /platform/webhooks/wompi).
   */
  async prepareWidgetCharge(
    invoiceId: number,
    opts: { customerEmail?: string; redirectUrl?: string },
  ): Promise<{
    payment: subscription_payments;
    widget: SaasWompiWidgetConfig | null;
  }> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }
    if (invoice.state === 'paid' || invoice.state === 'void') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Invoice already resolved',
      );
    }

    const total = new Prisma.Decimal(invoice.total);
    if (total.lessThanOrEqualTo(DECIMAL_ZERO)) {
      const payment = await this.handleZeroInvoice(invoiceId, invoice);
      return { payment, widget: null };
    }

    const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiConfig) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    const attemptCounter =
      (await this.prisma.subscription_payments.count({
        where: { invoice_id: invoiceId },
      })) + 1;
    const idempotencyKey = `sub_inv_${invoiceId}_att_${attemptCounter}`;
    const reference = `vendix_saas_${invoice.store_subscription_id}_${invoiceId}_${Date.now()}`;
    const amountInCents = Math.round(total.toNumber() * 100);
    const currency = invoice.currency || 'COP';

    const signatureIntegrity = this.computeIntegritySignature(
      reference,
      amountInCents,
      currency,
      wompiConfig.integrity_secret,
    );

    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'pending',
        amount: total,
        currency,
        payment_method: 'wompi',
        metadata: {
          idempotency_key: idempotencyKey,
          reference,
          attempt: attemptCounter,
          widget_flow: true,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      `prepareWidgetCharge: invoice ${invoiceId} → Wompi widget config (env=${wompiConfig.environment}, ref=${reference})`,
    );

    return {
      payment,
      widget: {
        public_key: wompiConfig.public_key,
        currency,
        amount_in_cents: amountInCents,
        reference,
        signature_integrity: signatureIntegrity,
        redirect_url: opts.redirectUrl ?? '',
        customer_email:
          opts.customerEmail ?? `saas-${invoice.store_id}@vendix.app`,
      },
    };
  }

  private computeIntegritySignature(
    reference: string,
    amountInCents: number,
    currency: string,
    integritySecret: string,
  ): string {
    const concatenated = `${reference}${amountInCents}${currency}${integritySecret}`;
    return require('crypto')
      .createHash('sha256')
      .update(concatenated)
      .digest('hex');
  }

  /**
   * Pull-fallback sync — Webhook safety net for environments where the
   * Wompi webhook cannot reach the backend (localhost, NAT, transient
   * outbound failures, prod misconfig). The frontend polling layer calls
   * this on every cycle while the subscription remains in `pending_payment`.
   *
   * Flow:
   *   1. Load invoice + payments. If invoice already paid → return.
   *   2. Pick the most recent pending payment row's `metadata.reference`
   *      (the one we generated when calling prepareWidgetCharge / charge).
   *   3. Query Wompi `GET /v1/transactions?reference=...` using PLATFORM
   *      credentials (same source the widget was issued with).
   *   4. If APPROVED → reuse webhook handler `markPaymentSucceededFromWebhook`
   *      so all atomic invariants (invoice paid, subscription promoted,
   *      auto-PM, partner commission outbox, listener emit) run identically.
   *      Idempotency via `webhook_event_dedup` keyed on the Wompi event id
   *      with processor='wompi_sync'.
   *   5. If DECLINED/ERROR → mark payment failed (same handler).
   *   6. If PENDING/empty → return pending status; caller keeps polling.
   *
   * Reusing the webhook handlers (instead of duplicating success logic)
   * guarantees parity: a charge confirmed via this path is indistinguishable
   * from one confirmed via the actual Wompi webhook.
   */
  async syncInvoiceFromGateway(invoiceId: number): Promise<{
    status: 'paid' | 'failed' | 'pending' | 'no_transaction';
    already_paid?: boolean;
    transaction_id?: string;
    payment_status?: string;
  }> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (invoice.state === 'paid') {
      return { status: 'paid', already_paid: true };
    }
    if (invoice.state === 'void' || invoice.state === 'refunded') {
      return { status: 'failed', already_paid: false };
    }

    // Locate the most recent pending payment for this invoice. The
    // `metadata.reference` is the one passed to the Wompi widget — that is
    // the only stable join key against `GET /transactions?reference=`.
    const payment = await this.prisma.subscription_payments.findFirst({
      where: { invoice_id: invoiceId },
      orderBy: { id: 'desc' },
    });

    if (!payment) {
      return { status: 'no_transaction' };
    }

    if (this.isTerminalState(payment.state)) {
      // Payment row already terminal — invoice should reflect it.
      return {
        status: payment.state === 'succeeded' ? 'paid' : 'failed',
        payment_status: payment.state,
      };
    }

    const meta =
      payment.metadata && typeof payment.metadata === 'object'
        ? (payment.metadata as Record<string, unknown>)
        : {};
    const reference =
      typeof meta.reference === 'string' && meta.reference.length > 0
        ? meta.reference
        : null;

    if (!reference) {
      this.logger.warn(
        `syncInvoiceFromGateway: payment ${payment.id} has no metadata.reference`,
      );
      return { status: 'pending', payment_status: payment.state };
    }

    const wompiCreds = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiCreds) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    let txns: WompiTransactionData[] = [];
    try {
      const client = this.wompiClientFactory.getClient(
        'platform-sync',
        this.toProcessorWompiConfig(wompiCreds),
      );
      const result = await client.getTransactionsByReference(reference);
      txns = Array.isArray(result?.data) ? result.data : [];
    } catch (err: any) {
      this.logger.warn(
        `syncInvoiceFromGateway: Wompi lookup failed for invoice ${invoiceId} ref=${reference}: ${err?.message ?? err}`,
      );
      return { status: 'pending', payment_status: payment.state };
    }

    if (txns.length === 0) {
      return { status: 'pending', payment_status: payment.state };
    }

    // Prefer an APPROVED txn if any; otherwise fall back to the most
    // recent terminal one (DECLINED/ERROR/VOIDED). PENDING ones leave
    // the caller polling.
    const approved = txns.find(
      (t) => String(t.status).toUpperCase() === 'APPROVED',
    );
    const terminalFailed = txns.find((t) => {
      const s = String(t.status).toUpperCase();
      return s === 'DECLINED' || s === 'ERROR' || s === 'VOIDED';
    });
    const txn = approved ?? terminalFailed ?? txns[0];
    const status = String(txn.status).toUpperCase();

    if (status === 'APPROVED') {
      // Idempotent dedup INSERT inside an atomic tx + reuse the webhook
      // success path so subscription promotion + auto-PM + outbox all run
      // identically to a real webhook. processor='wompi_sync' so a
      // subsequent real webhook (processor='wompi_platform') is NOT blocked
      // by this dedup row.
      await this.prisma.withoutScope().$transaction(
        async (tx) => {
          const dedupKey = String(txn.id);
          const inserted = await tx.$executeRaw<number>(
            Prisma.sql`
              INSERT INTO webhook_event_dedup (processor, event_id, event_type, received_at)
              VALUES ('wompi_sync', ${dedupKey}, 'pull_sync', NOW())
              ON CONFLICT (processor, event_id) DO NOTHING
            `,
          );
          if (inserted === 0) {
            this.logger.log(
              `syncInvoiceFromGateway: dedup hit for txn ${dedupKey}, invoice ${invoiceId}; skipping`,
            );
            return;
          }

          await this.markPaymentSucceededFromWebhook(
            {
              paymentId: payment.id,
              invoiceId,
              transactionId: txn.id,
              gatewayResponse: txn,
            },
            tx,
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

      // Post-commit side effects — mirror SubscriptionWebhookService.
      try {
        await this.enqueueCommissionAccrualPostCommit(invoiceId);
      } catch (e: any) {
        this.logger.warn(
          `syncInvoiceFromGateway: enqueueCommissionAccrual failed invoice=${invoiceId}: ${e?.message ?? e}`,
        );
      }

      try {
        this.eventEmitter.emit('subscription.payment.succeeded', {
          invoiceId,
          paymentId: payment.id,
          subscriptionId: invoice.store_subscription_id,
          storeId: invoice.store_id,
          source: 'pull_sync',
        });
      } catch (e: any) {
        this.logger.warn(
          `syncInvoiceFromGateway: emit failed invoice=${invoiceId}: ${e?.message ?? e}`,
        );
      }

      this.logger.log(
        `syncInvoiceFromGateway: APPROVED applied for invoice ${invoiceId} via pull (txn=${txn.id})`,
      );
      return {
        status: 'paid',
        transaction_id: txn.id,
        payment_status: 'succeeded',
      };
    }

    if (status === 'DECLINED' || status === 'ERROR' || status === 'VOIDED') {
      await this.markPaymentFailedFromWebhook({
        paymentId: payment.id,
        invoiceId,
        reason: txn.status_message ?? status,
      });
      return {
        status: 'failed',
        transaction_id: txn.id,
        payment_status: 'failed',
      };
    }

    // PENDING / unknown — caller continues polling.
    return { status: 'pending', payment_status: payment.state };
  }

  /**
   * Refund a payment for an invoice, optionally partially.
   * Calls the gateway refund and updates payment/invoice states.
   */
  async refundPayment(
    invoiceId: number,
    amount?: number,
  ): Promise<subscription_payments> {
    return this.refund(invoiceId, amount);
  }

  async getPaymentStatus(paymentId: number): Promise<PaymentStatus> {
    const payment = await this.prisma.subscription_payments.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Payment not found',
      );
    }

    if (!payment.gateway_reference) {
      return {
        status: payment.state as any,
        transactionId: payment.gateway_reference ?? undefined,
        amount: payment.amount.toNumber(),
        paidAt: payment.paid_at ?? undefined,
      };
    }

    return this.gateway.getPaymentStatus(payment.gateway_reference);
  }

  // ------------------------------------------------------------------
  // Public webhook entry-points
  //
  // These wrappers let SubscriptionWebhookService transition payment +
  // invoice state when an async Wompi callback arrives, without
  // duplicating the inline charge logic in handleChargeSuccess /
  // handleChargeFailure (which were private and reused across both
  // sync charge() and webhook). The wrapper resolves the invoice for the
  // webhook flow (the cron path already has it loaded) and short-circuits
  // when the payment is already in a terminal state — idempotent retries.
  // ------------------------------------------------------------------

  async markPaymentSucceededFromWebhook(
    input: {
      paymentId: number;
      invoiceId: number;
      transactionId?: string;
      gatewayResponse?: any;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<subscription_payments | null> {
    const { paymentId, invoiceId, transactionId, gatewayResponse } = input;

    const client = tx ?? this.prisma;

    const payment = await client.subscription_payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      this.logger.warn(
        `markPaymentSucceededFromWebhook: payment ${paymentId} not found`,
      );
      return null;
    }

    // Idempotency guard — terminal states never transition again from a
    // webhook. Webhooks can fire multiple times; the gateway retries on
    // non-2xx, and Wompi sometimes redelivers on its own.
    if (this.isTerminalState(payment.state)) {
      this.logger.log(
        `markPaymentSucceededFromWebhook: payment ${paymentId} already in ${payment.state}, skipping`,
      );
      return payment;
    }

    const invoice = await client.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      this.logger.warn(
        `markPaymentSucceededFromWebhook: invoice ${invoiceId} not found`,
      );
      return null;
    }

    const result = await this.handleChargeSuccess(
      paymentId,
      invoiceId,
      invoice,
      transactionId,
      gatewayResponse,
      tx,
    );

    // S3.5 — Reset consecutive_failures on the saved PM that authored this
    // charge. Run AFTER the success transaction so a rollback does not leave
    // the counter cleared for an un-paid invoice. When inside an external
    // transaction the caller (SubscriptionWebhookService) is responsible for
    // calling this post-commit; we still attempt it here best-effort because
    // the only side effect is an idempotent counter reset.
    const pmId = this.extractSavedPaymentMethodId(payment.metadata);
    if (pmId && !tx) {
      await this.resetPaymentMethodFailures(pmId);
    }

    return result;
  }

  async markPaymentFailedFromWebhook(
    input: {
      paymentId: number;
      invoiceId: number;
      reason: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<subscription_payments | null> {
    const { paymentId, invoiceId, reason } = input;

    const client = tx ?? this.prisma;

    const payment = await client.subscription_payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      this.logger.warn(
        `markPaymentFailedFromWebhook: payment ${paymentId} not found`,
      );
      return null;
    }

    if (this.isTerminalState(payment.state)) {
      this.logger.log(
        `markPaymentFailedFromWebhook: payment ${paymentId} already in ${payment.state}, skipping`,
      );
      return payment;
    }

    const result = await this.handleChargeFailure(
      paymentId,
      invoiceId,
      reason,
      tx,
    );

    // S3.5 — Bump consecutive_failures on the saved PM that authored this
    // charge. Like the success path, when inside an external tx the caller
    // owns the boundary and the bump is best-effort — the counter is
    // monotonic and idempotent enough to stomach a redelivery.
    const pmId = this.extractSavedPaymentMethodId(payment.metadata);
    if (pmId && !tx) {
      const inv = await this.prisma.subscription_invoices.findUnique({
        where: { id: invoiceId },
        select: { store_subscription_id: true },
      });
      if (inv) {
        await this.bumpPaymentMethodFailure(pmId, inv.store_subscription_id);
      }
    }

    return result;
  }

  private isTerminalState(state: subscription_payments['state']): boolean {
    return (
      state === 'succeeded' ||
      state === 'failed' ||
      state === 'refunded' ||
      state === 'partial_refund'
    );
  }

  // ------------------------------------------------------------------
  // ADR-2: Single confirmation point for pending plan changes
  // ------------------------------------------------------------------

  /**
   * ADR-2: Single confirmation point for all pending plan changes.
   * Called from: webhook APPROVED, free-plan synchronous path, Wompi polling.
   *
   * Invariant: after this method returns, state=active, plan_id=paid_plan_id,
   * all pending_* fields are null.
   */
  async confirmPendingChange(
    invoice: {
      id: number;
      store_subscription_id: number;
      to_plan_id: number | null;
      from_plan_id: number | null;
      change_kind: string | null;
    },
    tx: Prisma.TransactionClient,
  ): Promise<any> {
    // 1. Read the sub with plan and partner_override included
    const sub = await tx.store_subscriptions.findUniqueOrThrow({
      where: { id: invoice.store_subscription_id },
      include: {
        plan: true,
        partner_override: { include: { base_plan: true } },
      },
    });

    // 2. Guard: stale webhook or mismatch
    if (
      sub.pending_plan_id == null ||
      invoice.to_plan_id == null ||
      sub.pending_plan_id !== invoice.to_plan_id
    ) {
      this.logger.warn(
        JSON.stringify({
          event: 'CONFIRM_PENDING_MISMATCH',
          sub_pending: sub.pending_plan_id,
          invoice_to: invoice.to_plan_id,
          invoice_id: invoice.id,
        }),
      );
      return sub;
    }

    // 3. Fetch target plan
    const targetPlan = await tx.subscription_plans.findUniqueOrThrow({
      where: { id: sub.pending_plan_id },
      include: { partner_overrides: false },
    });

    // 4. Compute new pricing using the target plan shape
    const pricingInput = {
      plan: {
        id: targetPlan.id,
        base_price: targetPlan.base_price,
        max_partner_margin_pct: targetPlan.max_partner_margin_pct,
      },
      partner_override: sub.partner_override as any,
    };
    const newPricing = this.billing.computePricing(pricingInput);

    // 5. Determine if period should reset.
    // Plan-change policy: every upgrade/downgrade also restarts the cycle so
    // the new plan starts with a fresh full window (matches the full-price
    // charge applied server-side by SubscriptionProrationService — no credit,
    // no carry-over of consumed days).
    const changeKind = String(
      invoice.change_kind ?? sub.pending_change_kind ?? '',
    );
    const shouldResetPeriod = [
      'initial',
      'resubscribe',
      'trial_conversion',
      'renewal',
      'upgrade',
      'downgrade',
    ].includes(changeKind);

    // 6. Calculate new period if needed
    const now = new Date();
    let newPeriodEnd: Date | undefined;
    if (shouldResetPeriod) {
      const cycleDays = this.billingCycleDays(targetPlan.billing_cycle);
      newPeriodEnd = new Date(now.getTime() + cycleDays * DAY_MS);
    }

    // 7. Update the subscription (use UncheckedUpdateInput for scalar FK fields)
    const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, 6);
    const updateData: Prisma.store_subscriptionsUncheckedUpdateInput = {
      plan_id: sub.pending_plan_id,
      paid_plan_id: sub.pending_plan_id,
      effective_price: round2(newPricing.effective_price),
      vendix_base_price: round2(newPricing.base_price),
      partner_margin_amount: round2(newPricing.margin_amount),
      // Clear pending fields
      pending_plan_id: null,
      pending_change_invoice_id: null,
      pending_change_kind: null,
      pending_change_started_at: null,
      pending_revert_state: null,
      // Clear scheduled downgrade (upgrade cancels deferred downgrade)
      scheduled_plan_id: null,
      scheduled_plan_change_at: null,
      // Clear grace fields when confirming payment
      grace_soft_until: null,
      grace_hard_until: null,
      suspend_at: null,
      updated_at: now,
    };

    if (shouldResetPeriod && newPeriodEnd) {
      updateData.current_period_start = now;
      updateData.current_period_end = newPeriodEnd;
      updateData.next_billing_at = newPeriodEnd;
      // Clear trial fields if coming from trial
      if (
        sub.state === 'pending_payment' &&
        sub.pending_revert_state === 'trial'
      ) {
        updateData.trial_ends_at = null;
      }
    }

    const updated = await tx.store_subscriptions.update({
      where: { id: sub.id },
      data: updateData,
    });

    // 8. Transition state via stateService
    await this.stateService.transitionInTx(tx, sub.store_id, 'active', {
      reason: `plan_confirmed_invoice_${invoice.id}`,
      payload: {
        from_plan_id: invoice.from_plan_id,
        to_plan_id: invoice.to_plan_id,
        change_kind: changeKind,
        invoice_id: invoice.id,
      },
    });

    // 9. Emit event
    try {
      this.eventEmitter.emit('subscription.plan.changed', {
        storeId: sub.store_id,
        subscriptionId: sub.id,
        fromPlanId: invoice.from_plan_id,
        toPlanId: invoice.to_plan_id,
        kind: changeKind,
        mode: 'committed',
        invoiceId: invoice.id,
      });
    } catch (e: any) {
      this.logger.warn(
        `subscription.plan.changed emit failed for invoice ${invoice.id}: ${e?.message ?? e}`,
      );
    }

    // 10. Invalidate Redis cache
    try {
      await this.resolver.invalidate(sub.store_id);
    } catch (e: any) {
      this.logger.warn(
        `resolver.invalidate failed for store ${sub.store_id}: ${e?.message ?? e}`,
      );
    }

    return updated;
  }

  // ------------------------------------------------------------------
  // Core charge / refund
  // ------------------------------------------------------------------

  async charge(invoiceId: number): Promise<subscription_payments> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (invoice.state === 'paid' || invoice.state === 'void') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Invoice already resolved',
      );
    }

    const total = new Prisma.Decimal(invoice.total);

    if (total.lessThanOrEqualTo(DECIMAL_ZERO)) {
      return this.handleZeroInvoice(invoiceId, invoice);
    }

    // ── SaaS path: use platform-level Wompi credentials, NOT per-store
    // gateway registry. The store does not own the gateway used to charge
    // its own SaaS invoice — Vendix does.
    const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiConfig) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    // G11 — Resolve a usable stored payment method for this subscription.
    // Default tokenized card on the subscription is reused across renewals
    // when state='active' AND it has not expired AND it is not invalidated
    // by consecutive failures. If none exists or it is unusable, charge()
    // falls back to the legacy direct-call path (which will fail because
    // metadata.paymentMethod is required by WompiProcessor) and the caller
    // is expected to use prepareWidgetCharge() instead.
    const reusablePm = await this.resolveReusablePaymentMethod(
      invoice.store_subscription_id,
    );

    // Stable per-attempt idempotency key. Previous attempts for this
    // invoice are counted (any state) so retries always advance the counter,
    // making the key uniquely identify each logical attempt.
    const attemptCounter =
      (await this.prisma.subscription_payments.count({
        where: { invoice_id: invoiceId },
      })) + 1;
    const idempotencyKey = `sub_inv_${invoiceId}_att_${attemptCounter}`;

    // SaaS reference format — distinguishes SaaS billing transactions
    // from store/POS/eCommerce in Wompi reports and webhooks.
    const reference = `vendix_saas_${invoice.store_subscription_id}_${invoiceId}_${Date.now()}`;

    // Wompi Phase 6 — Build the per-attempt payment payload. Branching:
    //   • PM has provider_payment_source_id → COF / MIT (`payment_source_id`
    //     + `recurrent: true` inside WompiProcessor.processPayment). This is
    //     the production-grade flow: PCI-DSS compliant, MIT-flagged, eligible
    //     for Visa Account Updater.
    //   • Legacy PM (only `provider_token`, no `payment_source_id`) → inline
    //     `payment_method.token` flow. Preserved behind `legacyInlineTokenAllowed()`
    //     until Fase 7 wires the env-flag rampa. When the flag goes false,
    //     unmigrated PMs throw PAYMENT_METHOD_NOT_MIGRATED so the customer
    //     re-enters card data and gets re-tokenized via /payment_sources.
    //   • No reusable PM → standard SaaS flow (no PM metadata, falls through
    //     to processor's legacy branch which will fail without `paymentMethod`
    //     — caller is expected to use prepareWidgetCharge() instead).
    const baseMetadata: Record<string, unknown> = {
      subscription_payment: true,
      subscriptionId: invoice.store_subscription_id,
      invoiceId,
      invoice_number: invoice.invoice_number,
      reference,
      // Tells WompiProcessor to use these creds INSTEAD of looking up
      // store_payment_methods.custom_config (which doesn't apply for SaaS).
      wompiConfig: this.toProcessorWompiConfig(wompiConfig),
    };

    let chargeMetadata: Record<string, unknown>;
    if (reusablePm && reusablePm.provider_payment_source_id) {
      // ── Recurrent (COF/MIT) path — Wompi Phase 6 ──────────────────────
      chargeMetadata = {
        ...baseMetadata,
        payment_source_id: reusablePm.provider_payment_source_id,
        // SaaS internal contact mirrors what was registered with the COF.
        // Wompi requires `customer_email` on /transactions; processor falls
        // back to `cof-{storeId}@vendix.app` when absent.
        customerEmail: `saas-${invoice.store_id}@vendix.app`,
        saved_payment_method_id: reusablePm.id,
      };
    } else if (reusablePm) {
      if (!this.legacyInlineTokenAllowed()) {
        // Fase 7 enforce gate — unmigrated PMs are blocked. Customer must
        // re-tokenize via the widget so the next charge has a payment_source_id.
        throw new VendixHttpException(
          ErrorCodes.PAYMENT_METHOD_NOT_MIGRATED,
          'Payment method requires re-tokenization to Wompi payment_source',
          { paymentMethodId: reusablePm.id },
        );
      }
      // ── Legacy inline-token path (pre-Fase 6 PMs) ──────────────────────
      chargeMetadata = {
        ...baseMetadata,
        paymentMethod: {
          type: 'CARD',
          token: reusablePm.provider_token,
          installments: 1,
        },
        saved_payment_method_id: reusablePm.id,
        use_legacy_inline_token: true,
      };
    } else {
      // No reusable PM at all — pass-through. Processor will fail without
      // a paymentMethod, caller should have used prepareWidgetCharge().
      chargeMetadata = { ...baseMetadata };
    }

    // Telemetry — comparable approval-rate signal across the rollout (Fase 7
    // rampa). Logged on every attempt so ops can graph
    // success/failure-by-path without parsing structured payment metadata.
    this.logger.log(
      `WOMPI_CHARGE_PATH path=${
        reusablePm?.provider_payment_source_id
          ? 'recurrent'
          : reusablePm
            ? 'legacy'
            : 'no_pm'
      } subscriptionId=${invoice.store_subscription_id} invoiceId=${invoiceId} pmId=${reusablePm?.id ?? 'none'}`,
    );

    // Fase 7 — Structured warning to track legacy PMs still in use during
    // the rollout. Easy to grep / aggregate from logs while
    // `WOMPI_RECURRENT_ENFORCE=false`. Once the migration cohort is at
    // 100% and the warning rate is ~zero, the enforce flag can be flipped.
    if (reusablePm && !reusablePm.provider_payment_source_id) {
      this.logger.warn(
        `WOMPI_LEGACY_TOKEN_USED subscriptionId=${invoice.store_subscription_id} invoiceId=${invoiceId} pmId=${reusablePm.id} ` +
          `(re-tokenization required before WOMPI_RECURRENT_ENFORCE flip)`,
      );
    }

    const paymentData: PaymentData = {
      orderId: invoiceId,
      amount: total.toNumber(),
      currency: invoice.currency,
      // No per-store payment method on the SaaS path; the gateway is
      // resolved via PlatformGatewayService.
      storeId: invoice.store_id,
      idempotencyKey,
      metadata: chargeMetadata,
    };

    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'pending',
        amount: total,
        currency: invoice.currency,
        payment_method: 'wompi',
        metadata: {
          idempotency_key: idempotencyKey,
          reference,
          attempt: attemptCounter,
          ...(reusablePm ? { saved_payment_method_id: reusablePm.id } : {}),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      // Bypass PaymentGatewayService registry (which assumes per-store
      // credentials) and call the Wompi processor directly with platform
      // creds + SaaS metadata.
      const result = await this.wompiProcessor.processPayment(paymentData);

      if (result.success) {
        // G11 — On success, reset consecutive_failures to 0 on the saved
        // payment method (idempotent: NOOP if already 0).
        if (reusablePm) {
          await this.resetPaymentMethodFailures(reusablePm.id);
        }
        return this.handleChargeSuccess(
          payment.id,
          invoiceId,
          invoice,
          result.transactionId,
          result.gatewayResponse,
        );
      }

      // Wompi Phase 6 / Tactical Gap #4 — Issuer-revoked payment_source.
      // The processor surfaces `errorCode='PAYMENT_SOURCE_REVOKED'` for both
      // PAYMENT_SOURCE_REVOKED and INVALID_PAYMENT_SOURCE; the SaaS layer
      // also accepts the raw INVALID_PAYMENT_SOURCE shape defensively. This
      // is NOT a card-holder failure — bumping consecutive_failures would
      // incorrectly trigger dunning. Mark PM revoked, attempt failover.
      if (
        reusablePm &&
        (result.errorCode === 'PAYMENT_SOURCE_REVOKED' ||
          result.errorCode === 'INVALID_PAYMENT_SOURCE')
      ) {
        return this.handleRevokedPaymentSource({
          payment,
          invoice,
          invoiceId,
          revokedPm: reusablePm,
          errorCode: result.errorCode,
          failureMessage: result.message ?? 'Payment source revoked',
        });
      }

      // G11 — Track consecutive failures on the saved payment method.
      if (reusablePm) {
        await this.bumpPaymentMethodFailure(
          reusablePm.id,
          invoice.store_subscription_id,
        );
      }
      return this.handleChargeFailure(
        payment.id,
        invoiceId,
        result.message ?? 'Charge failed',
      );
    } catch (err) {
      if (reusablePm) {
        await this.bumpPaymentMethodFailure(
          reusablePm.id,
          invoice.store_subscription_id,
        );
      }
      return this.handleChargeFailure(
        payment.id,
        invoiceId,
        err instanceof Error ? err.message : 'Charge failed',
      );
    }
  }

  /**
   * Wompi Phase 6 / Tactical Gap #4 — Handle a charge attempt that was
   * rejected because the issuer revoked the stored `payment_source` (Wompi
   * `INVALID_PAYMENT_SOURCE` / `PAYMENT_SOURCE_REVOKED`).
   *
   * Policy:
   *   1. Mark the revoked PM as invalid with `consecutive_failures=0` and
   *      `replaced_at=now`. Counter is NOT bumped — this is an issuer event,
   *      not a card-holder dunning trigger.
   *      Note: enum has no `revoked` value; we use `invalid` and tag the
   *      semantic via `subscription_events.payload.reason='payment_source_revoked'`.
   *   2. Emit a `payment_method_revoked` audit event (subscription_events).
   *   3. Failover — if another active PM with `provider_payment_source_id`
   *      exists for the same subscription, promote it to default and retry
   *      the charge ONCE inline. If that also fails, leave the invoice in
   *      pending and let the reconciliation cron retry on the next dunning
   *      cycle.
   *   4. If no fallback PM, mark the payment as failed and return — the
   *      cron / customer flow will pick it up.
   */
  private async handleRevokedPaymentSource(input: {
    payment: subscription_payments;
    invoice: any;
    invoiceId: number;
    revokedPm: { id: number; provider_payment_source_id: string | null };
    errorCode: string;
    failureMessage: string;
  }): Promise<subscription_payments> {
    const { payment, invoice, invoiceId, revokedPm, errorCode, failureMessage } =
      input;
    const subscriptionId = invoice.store_subscription_id;
    const storeId = invoice.store_id;

    this.logger.warn(
      `WOMPI_PM_REVOKED subscriptionId=${subscriptionId} storeId=${storeId} pmId=${revokedPm.id} errorCode=${errorCode}`,
    );

    // 1+2. Atomic invalidate + audit event. We deliberately do NOT call
    // bumpPaymentMethodFailure here — that path increments the counter.
    let fallbackPmId: number | null = null;
    try {
      await this.prisma.$transaction(async (tx: any) => {
        await tx.subscription_payment_methods.update({
          where: { id: revokedPm.id },
          data: {
            // Enum has no `revoked` value (active|invalid|removed|replaced);
            // use `invalid` and rely on the event payload below to tag the
            // semantic as "revoked by issuer" for ops/dunning consumers.
            state: subscription_payment_method_state_enum.invalid,
            consecutive_failures: 0,
            is_default: false,
            replaced_at: new Date(),
            updated_at: new Date(),
          },
        });

        // Promote a sibling active PM with a payment_source_id (failover
        // requires the COF/MIT flow to work end-to-end without prompting
        // the user). Prefer payment_source-enabled candidates.
        const fallback = await tx.subscription_payment_methods.findFirst({
          where: {
            store_subscription_id: subscriptionId,
            state: subscription_payment_method_state_enum.active,
            id: { not: revokedPm.id },
            provider_payment_source_id: { not: null },
          },
          orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
        });
        if (fallback) {
          await tx.subscription_payment_methods.updateMany({
            where: {
              store_id: fallback.store_id,
              is_default: true,
              state: subscription_payment_method_state_enum.active,
            },
            data: { is_default: false, updated_at: new Date() },
          });
          await tx.subscription_payment_methods.update({
            where: { id: fallback.id },
            data: { is_default: true, updated_at: new Date() },
          });
          fallbackPmId = fallback.id;
        }

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'payment_method_revoked',
            payload: {
              reason: 'payment_source_revoked',
              payment_method_id: revokedPm.id,
              error_code: errorCode,
              fallback_promoted_id: fallbackPmId,
            } as Prisma.InputJsonValue,
            triggered_by_job: 'subscription-payment-service',
          },
        });
      });
    } catch (e: any) {
      this.logger.warn(
        `handleRevokedPaymentSource: failed to invalidate pm=${revokedPm.id}: ${e?.message ?? e}`,
      );
    }

    // Best-effort domain event (banner / cache bust).
    try {
      this.eventEmitter.emit('payment_method.revoked', {
        subscriptionId,
        storeId,
        paymentMethodId: revokedPm.id,
        errorCode,
        fallbackPromotedId: fallbackPmId,
      });
    } catch (e: any) {
      this.logger.warn(
        `payment_method.revoked emit failed pm=${revokedPm.id}: ${e?.message ?? e}`,
      );
    }

    // 3. Inline single-shot failover when a usable fallback is available.
    if (fallbackPmId) {
      const fallbackPm = await this.prisma.subscription_payment_methods.findUnique({
        where: { id: fallbackPmId },
      });
      if (fallbackPm?.provider_payment_source_id) {
        this.logger.log(
          `WOMPI_CHARGE_PATH path=recurrent_failover subscriptionId=${subscriptionId} invoiceId=${invoiceId} pmId=${fallbackPmId}`,
        );

        const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
        if (wompiConfig) {
          const retryAttempt =
            (await this.prisma.subscription_payments.count({
              where: { invoice_id: invoiceId },
            })) + 1;
          const retryPaymentData: PaymentData = {
            orderId: invoiceId,
            amount: new Prisma.Decimal(invoice.total).toNumber(),
            currency: invoice.currency,
            storeId,
            idempotencyKey: `sub_inv_${invoiceId}_att_${retryAttempt}_failover`,
            metadata: {
              subscription_payment: true,
              subscriptionId,
              invoiceId,
              invoice_number: invoice.invoice_number,
              reference: `vendix_saas_${subscriptionId}_${invoiceId}_${Date.now()}_failover`,
              wompiConfig: this.toProcessorWompiConfig(wompiConfig),
              payment_source_id: fallbackPm.provider_payment_source_id,
              customerEmail: `saas-${storeId}@vendix.app`,
              saved_payment_method_id: fallbackPm.id,
              failover_from_pm_id: revokedPm.id,
            },
          };

          try {
            const retryResult =
              await this.wompiProcessor.processPayment(retryPaymentData);
            if (retryResult.success) {
              await this.resetPaymentMethodFailures(fallbackPm.id);
              return this.handleChargeSuccess(
                payment.id,
                invoiceId,
                invoice,
                retryResult.transactionId,
                retryResult.gatewayResponse,
              );
            }
            // Retry also failed — log and fall through to handleChargeFailure
            // (no second retry to keep the flow bounded; cron will pick up).
            this.logger.warn(
              `WOMPI_FAILOVER_FAILED subscriptionId=${subscriptionId} invoiceId=${invoiceId} fallbackPmId=${fallbackPmId} message=${retryResult.message ?? 'unknown'}`,
            );
          } catch (e: any) {
            this.logger.warn(
              `WOMPI_FAILOVER_THREW subscriptionId=${subscriptionId} invoiceId=${invoiceId} fallbackPmId=${fallbackPmId} error=${e?.message ?? e}`,
            );
          }
        }
      }
    }

    // 4. No (working) fallback — mark payment failed and let the cron retry.
    return this.handleChargeFailure(payment.id, invoiceId, failureMessage);
  }

  /**
   * Wompi Phase 7 — Returns whether legacy inline-token charges are still
   * allowed for PMs without `provider_payment_source_id`.
   *
   * Delegates to {@link isLegacyInlineTokenAllowed} (reads
   * `WOMPI_RECURRENT_ENFORCE`). Default is log-only (`true`); flipping the
   * env flag to `'true'` switches to enforce mode and legacy PMs are rejected
   * with `PAYMENT_METHOD_NOT_MIGRATED`.
   *
   * Exposed as a class method (not a constant) so tests can stub it via
   * `jest.spyOn(service as any, 'legacyInlineTokenAllowed')`.
   */
  private legacyInlineTokenAllowed(): boolean {
    return isLegacyInlineTokenAllowed();
  }

  /**
   * G11 / S3.5 — Returns the active default payment method for a subscription
   * if it is usable for an automatic renewal charge:
   *   - state = 'active'
   *   - not expired (expiry_year/expiry_month either null = unknown or future)
   *   - consecutive_failures < MAX_CONSECUTIVE_FAILURES (real column).
   *
   * Returns null if no eligible PM is found; callers fall back to the
   * Wompi widget flow.
   *
   * Wompi Phase 6 — also returns `provider_payment_source_id` (when present)
   * so chargeInvoice can route to the COF / `recurrent: true` branch instead
   * of the legacy inline-token path.
   */
  private async resolveReusablePaymentMethod(subscriptionId: number): Promise<{
    id: number;
    provider_token: string;
    provider_payment_source_id: string | null;
  } | null> {
    const pm = await this.prisma.subscription_payment_methods.findFirst({
      where: {
        store_subscription_id: subscriptionId,
        is_default: true,
        state: 'active',
      },
      orderBy: { created_at: 'desc' },
    });
    if (!pm || !pm.provider_token) return null;

    // Expiry check: if expiry_month/year are stored and the card is already
    // expired, skip it. We use UTC-safe comparison vs current month.
    if (pm.expiry_month && pm.expiry_year) {
      const expMonth = parseInt(pm.expiry_month, 10);
      const expYear = parseInt(pm.expiry_year, 10);
      if (!isNaN(expMonth) && !isNaN(expYear)) {
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth() + 1;
        const expiredAlready =
          expYear < currentYear ||
          (expYear === currentYear && expMonth < currentMonth);
        if (expiredAlready) return null;
      }
    }

    // S3.5 — Consecutive failures guard (real column).
    if ((pm.consecutive_failures ?? 0) >= MAX_CONSECUTIVE_FAILURES) return null;

    return {
      id: pm.id,
      provider_token: pm.provider_token,
      provider_payment_source_id: pm.provider_payment_source_id ?? null,
    };
  }

  /**
   * S3.5 — Reset consecutive_failures to 0 after a successful charge.
   * No-op if the counter is already 0 (idempotent).
   */
  private async resetPaymentMethodFailures(
    paymentMethodId: number,
  ): Promise<void> {
    try {
      const pm = await this.prisma.subscription_payment_methods.findUnique({
        where: { id: paymentMethodId },
      });
      if (!pm) return;
      if ((pm.consecutive_failures ?? 0) === 0) return;
      await this.prisma.subscription_payment_methods.update({
        where: { id: paymentMethodId },
        data: { consecutive_failures: 0, updated_at: new Date() },
      });
    } catch (e: any) {
      this.logger.warn(
        `resetPaymentMethodFailures failed pm=${paymentMethodId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * S3.5 — Bump consecutive_failures on a saved payment method. When the
   * counter reaches MAX_CONSECUTIVE_FAILURES the PM is invalidated
   * (`state='invalid'`, `is_default=false`), a `state_transition` event is
   * persisted in `subscription_events`, the next active PM (if any) is
   * promoted to default, and a `subscription.payment-method-invalidated-failures.email`
   * job is enqueued.
   *
   * Mirrors the post-expiry sweep contract in
   * `PaymentMethodExpiryNotifierJob.invalidateExpiredCards` so banner UX,
   * timeline events, and dunning logic can treat both reasons uniformly.
   */
  private async bumpPaymentMethodFailure(
    paymentMethodId: number,
    subscriptionId: number,
  ): Promise<void> {
    try {
      const pm = await this.prisma.subscription_payment_methods.findUnique({
        where: { id: paymentMethodId },
      });
      if (!pm) return;
      if (pm.state !== 'active') return; // do not bump a PM already invalidated

      const next = (pm.consecutive_failures ?? 0) + 1;
      const isInvalid = next >= MAX_CONSECUTIVE_FAILURES;

      if (!isInvalid) {
        await this.prisma.subscription_payment_methods.update({
          where: { id: paymentMethodId },
          data: {
            consecutive_failures: next,
            updated_at: new Date(),
          },
        });
        this.logger.log(
          `PAYMENT_METHOD_FAILURE_BUMPED pm=${paymentMethodId} sub=${subscriptionId} consecutive_failures=${next}`,
        );
        return;
      }

      // Threshold reached → atomic invalidate + promote-default + event.
      const wasDefault = pm.is_default === true;
      const now = new Date();
      const txResult = await this.prisma.$transaction(async (tx: any) => {
        await tx.subscription_payment_methods.update({
          where: { id: paymentMethodId },
          data: {
            state: 'invalid',
            consecutive_failures: next,
            is_default: false,
            updated_at: now,
          },
        });

        let promotedId: number | null = null;
        if (wasDefault) {
          const candidate = await tx.subscription_payment_methods.findFirst({
            where: {
              store_id: pm.store_id,
              state: 'active',
              id: { not: pm.id },
            },
            orderBy: { created_at: 'desc' },
            select: { id: true },
          });
          if (candidate) {
            await tx.subscription_payment_methods.updateMany({
              where: { store_id: pm.store_id, is_default: true },
              data: { is_default: false, updated_at: now },
            });
            await tx.subscription_payment_methods.update({
              where: { id: candidate.id },
              data: { is_default: true, updated_at: now },
            });
            promotedId = candidate.id;
          }
        }

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subscriptionId,
            type: 'state_transition',
            payload: {
              reason: 'consecutive_failures_threshold',
              payment_method_id: pm.id,
              store_id: pm.store_id,
              consecutive_failures: next,
              was_default: wasDefault,
              promoted_default_id: promotedId,
              last_four: pm.last4 ?? null,
              brand: pm.brand ?? null,
            } as Prisma.InputJsonValue,
            triggered_by_job: 'subscription-payment-service',
          },
        });

        return { promotedId };
      });

      // Structured log (matches post-expiry sweep format for parity).
      this.logger.warn(
        `PAYMENT_METHOD_AUTO_INVALIDATED payment_method_id=${pm.id} ` +
          `store_id=${pm.store_id} ` +
          `store_subscription_id=${subscriptionId} ` +
          `consecutive_failures=${next} ` +
          `reason=consecutive_failures ` +
          `was_default=${wasDefault} ` +
          `promoted_default_id=${txResult.promotedId ?? 'none'}`,
      );

      // Best-effort domain event for in-process listeners (banner cache bust).
      try {
        this.eventEmitter.emit('payment_method.invalidated', {
          subscriptionId,
          paymentMethodId,
          reason: 'consecutive_failures',
        });
      } catch (e: any) {
        this.logger.warn(
          `payment_method.invalidated emit failed pm=${paymentMethodId}: ${e?.message ?? e}`,
        );
      }

      // Notify customer.
      try {
        await this.emailQueue.add(
          'subscription.payment-method-invalidated-failures.email',
          {
            subscriptionId,
            storeId: pm.store_id,
            paymentMethodId: pm.id,
            last_four: pm.last4 ?? null,
            brand: pm.brand ?? null,
            consecutive_failures: next,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `Failed to enqueue payment-method-invalidated-failures email pm=${paymentMethodId}: ${e?.message ?? e}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(
        `bumpPaymentMethodFailure failed pm=${paymentMethodId}: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Resolve the saved_payment_method_id stored in payment metadata. Used by
   * webhook flows where the payment row was created earlier (charge() or
   * prepareWidgetCharge) and the PM linkage lives in `metadata`.
   */
  private extractSavedPaymentMethodId(metadata: unknown): number | null {
    if (!metadata || typeof metadata !== 'object') return null;
    const meta = metadata as Record<string, unknown>;
    const id = meta.saved_payment_method_id ?? meta.payment_method_id;
    const n = typeof id === 'number' ? id : Number(id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Bridge platform gateway DecryptedCreds (env enum from
   * PlatformGatewayEnvironmentEnum) into the WompiConfig shape the processor
   * expects (env from WompiEnvironment).
   */
  private toProcessorWompiConfig(creds: DecryptedCreds) {
    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret,
      integrity_secret: creds.integrity_secret,
      environment:
        creds.environment === PlatformGatewayEnvironmentEnum.PRODUCTION
          ? WompiEnvironment.PRODUCTION
          : WompiEnvironment.SANDBOX,
    };
  }

  async refund(
    invoiceId: number,
    amount?: number,
  ): Promise<subscription_payments> {
    const existing = await this.prisma.subscription_payments.findFirst({
      where: { invoice_id: invoiceId, state: 'succeeded' },
    });

    if (!existing) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'No successful payment to refund',
      );
    }

    if (!existing.gateway_reference) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'No gateway reference on payment',
      );
    }

    const refundAmount =
      amount ?? new Prisma.Decimal(existing.amount).toNumber();

    const refundResult = await this.gateway.refundPayment(
      existing.gateway_reference,
      refundAmount,
      'Subscription refund',
    );

    return this.prisma.$transaction(async (tx: any) => {
      const isFullRefund =
        !amount ||
        new Prisma.Decimal(amount).greaterThanOrEqualTo(existing.amount);

      const updatedPayment = await tx.subscription_payments.update({
        where: { id: existing.id },
        data: {
          state: isFullRefund ? 'refunded' : ('partial_refund' as const),
          updated_at: new Date(),
          metadata: {
            ...(existing.metadata && typeof existing.metadata === 'object'
              ? (existing.metadata as Record<string, unknown>)
              : {}),
            refund_amount: refundAmount,
            refund_result: refundResult.success ? 'success' : 'failed',
          } as Prisma.InputJsonValue,
        },
      });

      if (refundResult.success && isFullRefund) {
        // RNC-10/RNC-11: only full refunds change invoice state to 'refunded'.
        // Partial refunds leave the invoice in 'paid'; the partial chargeback
        // is recorded only on the subscription_payments row (state='partial_refund').
        await tx.subscription_invoices.update({
          where: { id: invoiceId },
          data: {
            state: 'refunded',
            updated_at: new Date(),
          },
        });
      }

      return updatedPayment;
    });
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private async handleChargeSuccess(
    paymentId: number,
    invoiceId: number,
    invoice: any,
    transactionId?: string,
    gatewayResponse?: any,
    externalTx?: Prisma.TransactionClient,
  ): Promise<subscription_payments> {
    // If an external transaction is provided (e.g. from the atomic webhook
    // dedup flow), execute writes directly inside it — no nested $transaction.
    // Otherwise open a new transaction (charge() / handleZeroInvoice paths).
    const executeWrites = async (
      tx: Prisma.TransactionClient,
    ): Promise<subscription_payments> => {
      const now = new Date();

      const updatedPayment = await tx.subscription_payments.update({
        where: { id: paymentId },
        data: {
          state: 'succeeded',
          gateway_reference: transactionId ?? null,
          paid_at: now,
          metadata: {
            ...(gatewayResponse ? { gateway_response: gatewayResponse } : {}),
          } as Prisma.InputJsonValue,
          updated_at: now,
        },
      });

      await tx.subscription_invoices.update({
        where: { id: invoiceId },
        data: {
          state: 'paid',
          amount_paid: invoice.total,
          updated_at: now,
        },
      });

      // ── Auto-register the card used for this charge as a saved
      // subscription_payment_method (implicit > explicit). This is the
      // canonical path: the user pays the real invoice via Wompi widget,
      // and the card used is persisted as the recurring PM with
      // is_default=true. No standalone "add card" flow is needed.
      //
      // Errors are swallowed (logged) — the payment is already approved by
      // the gateway and the invoice is paid; failing to persist the PM
      // must NOT roll back the success transaction. The user can re-pay
      // manually next renewal if the PM record is missing.
      try {
        await this.autoRegisterPaymentMethodFromGateway(
          tx,
          invoice.store_id,
          invoice.store_subscription_id,
          gatewayResponse,
          paymentId,
        );
      } catch (e: any) {
        this.logger.warn(
          `autoRegisterPaymentMethodFromGateway failed for invoice ${invoiceId}: ${e?.message ?? e}`,
        );
      }

      // Synchronous subscription-state promotion (root-cause fix for
      // pending_payment drift). The listener at
      // `SubscriptionStateListener.onPaymentSucceeded` is best-effort and
      // post-commit; if it fails or is delayed, subscriptions get stuck in
      // pending_payment despite the payment being approved. Doing the
      // promotion here, INSIDE the same tx that flips payment->succeeded
      // and invoice->paid, guarantees atomicity.
      //
      // ADR-2: When invoice.to_plan_id is set, this is a "pending-change flow"
      // (upgrade, initial, resubscribe, trial_conversion, renewal with plan
      // change). confirmPendingChange() handles plan promotion, period reset,
      // state transition and cache invalidation atomically.
      //
      // When invoice.to_plan_id is null, this is the legacy flow (renewal of
      // existing plan, grace reactivation). The original promotion logic runs.
      //
      // Errors are logged and swallowed (not propagated): the payment is
      // already confirmed by the gateway; we must not roll back to "pending"
      // because of a state-transition issue. The reconciliation cron picks
      // up any drift left by this best-effort path.
      if (invoice.store_id) {
        try {
          if (invoice.to_plan_id != null) {
            // ── New pending-change flow (ADR-2) ──────────────────────────
            await this.confirmPendingChange(
              {
                id: invoiceId,
                store_subscription_id: invoice.store_subscription_id,
                to_plan_id: invoice.to_plan_id,
                from_plan_id: invoice.from_plan_id ?? null,
                change_kind: invoice.change_kind ?? null,
              },
              tx,
            );
          } else {
            // ── Legacy flow (renewal / grace reactivation) ───────────────
            const subRow = await tx.store_subscriptions.findUnique({
              where: { id: invoice.store_subscription_id },
              select: {
                state: true,
                current_period_end: true,
                plan: { select: { billing_cycle: true } },
              },
            });
            const currentState = subRow?.state as string | undefined;
            if (
              currentState &&
              PROMOTABLE_ON_PAYMENT_SUCCESS.includes(
                currentState as (typeof PROMOTABLE_ON_PAYMENT_SUCCESS)[number],
              )
            ) {
              // RNC-22 — Reactivation from grace/suspended discounts the days
              // already consumed in grace. Only applies when the previous
              // billing period actually ended before the payment landed
              // (current_period_end < paid_at). Pure new-cycle states
              // (pending_payment, draft, expired, no_plan, cancelled) get a
              // clean cycle per RNC-21 and never enter this branch.
              const isGraceReactivation =
                currentState === 'grace_soft' ||
                currentState === 'grace_hard' ||
                currentState === 'suspended';

              if (
                isGraceReactivation &&
                subRow?.current_period_end &&
                subRow.plan?.billing_cycle
              ) {
                const previousPeriodEnd = new Date(subRow.current_period_end);
                if (previousPeriodEnd.getTime() < now.getTime()) {
                  const cycleMs = this.billingCycleMs(
                    subRow.plan.billing_cycle,
                  );
                  const cycleDays = Math.max(1, Math.round(cycleMs / DAY_MS));
                  // Days fully consumed in grace, clamped to [0, cycleDays].
                  const daysInGraceRaw = Math.floor(
                    (now.getTime() - previousPeriodEnd.getTime()) / DAY_MS,
                  );
                  const daysInGrace = Math.max(
                    0,
                    Math.min(cycleDays, daysInGraceRaw),
                  );

                  // New period: paid_at + (cycle - days_in_grace).
                  const effectiveDaysGranted = cycleDays - daysInGrace;
                  const newPeriodEnd = new Date(
                    now.getTime() + effectiveDaysGranted * DAY_MS,
                  );

                  await tx.store_subscriptions.update({
                    where: { id: invoice.store_subscription_id },
                    data: {
                      current_period_start: now,
                      current_period_end: newPeriodEnd,
                      next_billing_at: newPeriodEnd,
                      grace_soft_until: null,
                      grace_hard_until: null,
                      suspend_at: null,
                      updated_at: now,
                    },
                  });

                  await tx.subscription_events.create({
                    data: {
                      store_subscription_id: invoice.store_subscription_id,
                      type: 'state_transition',
                      payload: {
                        reason: 'reactivation_with_grace_discount',
                        previous_state: currentState,
                        payment_id: paymentId,
                        invoice_id: invoiceId,
                        days_in_grace: daysInGrace,
                        cycle_days: cycleDays,
                        original_period_end: previousPeriodEnd.toISOString(),
                        new_period_end: newPeriodEnd.toISOString(),
                        paid_at: now.toISOString(),
                      } as Prisma.InputJsonValue,
                      triggered_by_job: 'subscription-payment-service',
                    },
                  });

                  this.logger.log(
                    `RNC-22 grace-discount applied sub=${invoice.store_subscription_id} ` +
                      `previous_state=${currentState} days_in_grace=${daysInGrace} ` +
                      `original_period_end=${previousPeriodEnd.toISOString()} ` +
                      `new_period_end=${newPeriodEnd.toISOString()}`,
                  );
                }
              }

              await this.stateService.transitionInTx(
                tx,
                invoice.store_id,
                'active',
                {
                  reason: `payment_${paymentId}_approved`,
                  triggeredByJob: 'webhook',
                  payload: {
                    invoice_id: invoiceId,
                    payment_id: paymentId,
                    previous_state: currentState,
                    source: 'handle_charge_success_sync',
                  },
                },
              );
            }
          }
        } catch (txStateErr: any) {
          // The payment is approved by the gateway; never propagate a
          // state-transition error from here. Log warn so ops can see drift
          // and the reconciliation cron will clean up.
          this.logger.warn(
            `Synchronous state promotion failed for invoice ${invoiceId} (paymentId=${paymentId}): ${txStateErr?.message ?? txStateErr}`,
          );
        }
      }

      // Outbox pattern: insert a commission_accrual_pending row inside the
      // SAME transaction as the invoice paid update. This guarantees
      // atomicity — if the tx fails, neither invoice paid nor outbox row
      // is committed. The asynchronous worker (commission-accrual BullMQ
      // processor) will later read this row and create/update the actual
      // partner_commissions record.
      if (invoice.partner_organization_id) {
        const splitBreakdown = invoice.split_breakdown as Record<
          string,
          unknown
        > | null;
        const partnerShare = splitBreakdown?.partner_share
          ? new Prisma.Decimal(splitBreakdown.partner_share as string)
          : DECIMAL_ZERO;

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          try {
            await tx.commission_accrual_pending.upsert({
              where: { invoice_id: invoiceId },
              create: {
                invoice_id: invoiceId,
                partner_organization_id: invoice.partner_organization_id,
                amount: partnerShare,
                currency: invoice.currency,
                state: 'pending',
              },
              update: {}, // no-op if already exists
            });
          } catch (e: any) {
            if (e?.code !== 'P2002') {
              throw e;
            }
            this.logger.warn(
              `Commission accrual outbox hit P2002 for invoice ${invoiceId}; skipped`,
            );
          }
        }
      }

      return updatedPayment;
    };

    const result = externalTx
      ? await executeWrites(externalTx)
      : await this.prisma.$transaction(
          (tx: Prisma.TransactionClient) => executeWrites(tx),
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );

    // Post-commit side effects.
    //
    // When externalTx is present the caller (SubscriptionWebhookService) owns
    // the transaction boundary. These side effects must run AFTER the external
    // tx commits, so the webhook handler is responsible for triggering them.
    // Skip them here to avoid running before commit (race) or on rollback.
    if (!externalTx) {
      // Enqueue the commission-accrual worker so the outbox row is processed
      // asynchronously. If enqueue fails, the row stays pending and will be
      // picked up by reconciliation or manual retry.
      if (invoice.partner_organization_id) {
        const splitBreakdown = invoice.split_breakdown as Record<
          string,
          unknown
        > | null;
        const partnerShare = splitBreakdown?.partner_share
          ? new Prisma.Decimal(splitBreakdown.partner_share as string)
          : DECIMAL_ZERO;

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          try {
            await this.commissionQueue.add(
              'accrual',
              { invoiceId },
              {
                attempts: 5,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: { age: 3600, count: 100 },
                removeOnFail: { age: 86400 },
              },
            );
          } catch (e: any) {
            this.logger.warn(
              `Failed to enqueue commission accrual job for invoice ${invoiceId}: ${e?.message ?? e}`,
            );
          }
        }
      }

      // Emit `subscription.payment.succeeded` so the SubscriptionStateListener
      // can auto-promote the subscription from `pending_payment` (or
      // `grace_*`/`blocked`) to `active` immediately — without waiting for the
      // daily 03:00 dunning cron.
      //
      // Wrapped because emit() is sync but listener errors must NOT break
      // the caller (charge() returning to checkout commit). Listener also
      // wraps in try/catch as defense in depth.
      try {
        this.eventEmitter.emit('subscription.payment.succeeded', {
          invoiceId,
          paymentId,
          subscriptionId: invoice.store_subscription_id,
          storeId: invoice.store_id,
          source: 'charge_success',
        });
      } catch (e: any) {
        this.logger.warn(
          `subscription.payment.succeeded emit failed for invoice ${invoiceId}: ${e?.message ?? e}`,
        );
      }
    }

    return result;
  }

  /**
   * Auto-register the card used in a successful Wompi charge as a
   * subscription_payment_methods row. This is the canonical "implicit PM
   * registration" path: when the user pays a real invoice via the Wompi
   * widget, the card used becomes the saved recurring PM (is_default=true).
   *
   * Idempotent — webhook redelivery or duplicate charge is safe:
   *   - A row with the same provider_token for this store is reused
   *     (only `last_used_at` / metadata gets refreshed; no new row).
   *   - If the card data is incomplete (e.g. payment_method_type !== 'CARD',
   *     no provider_token, no last_four), the call is a NO-OP. The user can
   *     still pay; we just won't persist a recurring PM. Next successful
   *     charge with full data will register it.
   *
   * Wompi `transaction.payment_method` shape for CARD:
   *   {
   *     type: 'CARD',
   *     installments: 1,
   *     extra: { last_four, name, brand, exp_year, exp_month, ... }
   *   }
   * The recurring token comes via `transaction.payment_method_token` (or
   * `payment_method.token` depending on widget version) — without it we
   * cannot reuse the card for renewals, so we skip persistence.
   */
  private async autoRegisterPaymentMethodFromGateway(
    tx: Prisma.TransactionClient,
    storeId: number | null | undefined,
    subscriptionId: number,
    gatewayResponse: any,
    paymentId: number,
  ): Promise<void> {
    if (!storeId) return;
    if (!gatewayResponse || typeof gatewayResponse !== 'object') return;

    // Wompi shape: `transaction.payment_method.type` (current API). The
    // legacy `payment_method_type` top-level key is also accepted.
    const paymentMethodType = String(
      gatewayResponse.payment_method?.type ??
        gatewayResponse.payment_method_type ??
        gatewayResponse.type ??
        '',
    ).toUpperCase();
    // Empty type => assume CARD (best-effort: the gateway response is
    // optional in some retry paths). Wallets like NEQUI / PSE are one-shot
    // per Wompi's contract — re-prompt the user each time.
    if (paymentMethodType && paymentMethodType !== 'CARD') {
      return;
    }

    // Wompi Phase 5 — extract `payment_source_id` (long-lived) instead of
    // the short-lived recurring token. Wompi exposes it on the transaction
    // body as `payment_source.id` when a card was saved server-side via
    // `/payment_sources` (or as the top-level `payment_source_id` field on
    // some webhook shapes).
    const rawPsId =
      gatewayResponse?.payment_source_id ??
      gatewayResponse?.payment_source?.id ??
      null;

    if (rawPsId == null) {
      // Legacy fallback path — happens when the SaaS charge ran via the
      // inline-token flow (no payment_source created server-side yet).
      // Should be 0 occurrences after Fase 7 enforce. Log so ops can see it.
      this.logger.warn(
        `auto-register PM: missing payment_source_id sub=${subscriptionId} payment=${paymentId} ` +
          `(legacy fallback path; should be 0 occurrences after Fase 7 enforce)`,
      );
      return;
    }

    const paymentSourceId = String(rawPsId);

    const paymentMethod = gatewayResponse.payment_method ?? {};
    const extra = paymentMethod.extra ?? {};

    const last4: string | null =
      typeof extra.last_four === 'string'
        ? extra.last_four
        : typeof paymentMethod.last_four === 'string'
          ? paymentMethod.last_four
          : null;

    const brand: string | null = (extra.brand ??
      paymentMethod.brand ??
      null) as string | null;
    const expMonthRaw = extra.exp_month ?? paymentMethod.exp_month ?? null;
    const expYearRaw = extra.exp_year ?? paymentMethod.exp_year ?? null;
    const expiry_month =
      expMonthRaw !== null && expMonthRaw !== undefined
        ? String(expMonthRaw).padStart(2, '0').slice(0, 2)
        : null;
    const expiry_year =
      expYearRaw !== null && expYearRaw !== undefined
        ? String(expYearRaw).slice(0, 4)
        : null;
    const cardHolder: string | null = (extra.name ??
      extra.card_holder ??
      paymentMethod.name ??
      null) as string | null;

    // Idempotency — keyed by (store_id, provider_payment_source_id). Webhook
    // re-delivery (or a widget callback racing with the webhook) hits this
    // branch and is a no-op. The advisory lock used by the manual tokenize
    // path is not needed here: the call site is already inside a
    // subscription_payments transaction.
    const existing = await tx.subscription_payment_methods.findFirst({
      where: {
        store_id: storeId,
        provider_payment_source_id: paymentSourceId,
        state: subscription_payment_method_state_enum.active,
      },
    });

    const nowDate = new Date();

    if (existing) {
      await tx.subscription_payment_methods.update({
        where: { id: existing.id },
        data: { updated_at: nowDate },
      });
      this.logger.log(
        `auto-register PM dedup sub=${subscriptionId} reused pm=${existing.id} psid=${paymentSourceId}`,
      );
      return;
    }

    // First-PM-for-store ⇒ default. Otherwise demote any previous default
    // and promote the freshly-paid card as default — RNC-25 failover relies
    // on `is_default=true` pointing at the most-recently-charged card.
    await tx.subscription_payment_methods.updateMany({
      where: {
        store_id: storeId,
        is_default: true,
        state: subscription_payment_method_state_enum.active,
      },
      data: { is_default: false, updated_at: nowDate },
    });

    const created = await tx.subscription_payment_methods.create({
      data: {
        store_id: storeId,
        store_subscription_id: subscriptionId,
        type: 'card',
        provider: 'wompi',
        // Legacy mirror — readers that still consult provider_token (eg.
        // Fase 5 reusable-PM lookup before Fase 6 swaps to payment_source_id)
        // keep working with the new shape.
        provider_token: paymentSourceId,
        provider_payment_source_id: paymentSourceId,
        acceptance_token_used:
          (gatewayResponse?.acceptance_token as string | undefined) ?? null,
        cof_registered_at: nowDate,
        last4,
        brand,
        expiry_month,
        expiry_year,
        card_holder: cardHolder,
        is_default: true,
        state: subscription_payment_method_state_enum.active,
        metadata: {
          source: 'auto_register_from_payment',
          payment_id: paymentId,
          registered_at: nowDate.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });

    // Audit row so the timeline reflects "card auto-saved".
    await tx.subscription_events.create({
      data: {
        store_subscription_id: subscriptionId,
        type: 'state_transition',
        payload: {
          reason: 'payment_method_auto_registered',
          payment_method_id: created.id,
          payment_id: paymentId,
          payment_source_id: paymentSourceId,
          last_four: last4,
          brand,
        } as Prisma.InputJsonValue,
        triggered_by_job: 'subscription-payment-service',
      },
    });

    this.logger.log(
      `PAYMENT_METHOD_AUTO_REGISTERED sub=${subscriptionId} pm=${created.id} psid=${paymentSourceId} last4=${last4 ?? 'n/a'} brand=${brand ?? 'unknown'}`,
    );
  }

  private async handleChargeFailure(
    paymentId: number,
    invoiceId: number,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<subscription_payments> {
    const client = tx ?? this.prisma;

    const updatedPayment = await client.subscription_payments.update({
      where: { id: paymentId },
      data: {
        state: 'failed',
        failure_reason: reason,
        updated_at: new Date(),
      },
    });

    // ADR-2: If there's an active pending change on the subscription, revert it.
    // This clears pending_* fields and transitions the sub back to the state
    // it was in before the change was initiated (pending_revert_state).
    try {
      const subForRevert = await client.store_subscriptions.findFirst({
        where: { pending_change_invoice_id: invoiceId },
        select: {
          id: true,
          store_id: true,
          state: true,
          pending_revert_state: true,
        },
      });

      if (
        subForRevert &&
        subForRevert.state === 'pending_payment' &&
        subForRevert.pending_revert_state
      ) {
        await client.store_subscriptions.update({
          where: { id: subForRevert.id },
          data: {
            pending_plan_id: null,
            pending_change_invoice_id: null,
            pending_change_kind: null,
            pending_change_started_at: null,
            pending_revert_state: null,
            updated_at: new Date(),
          },
        });
        await this.stateService.transitionInTx(
          client as Prisma.TransactionClient,
          subForRevert.store_id,
          subForRevert.pending_revert_state as any,
          {
            reason: `payment_failed_invoice_${invoiceId}`,
            payload: { invoice_id: invoiceId },
          },
        );
      }
    } catch (revertErr: any) {
      this.logger.warn(
        `ADR-2 pending-change revert failed on payment failure invoice=${invoiceId}: ${revertErr?.message ?? revertErr}`,
      );
    }

    // Emit AFTER the write (whether inside external tx or standalone).
    // When called with an external tx, the emit fires before tx commits —
    // this is safe because subscription.payment.failed is best-effort
    // observability. When called standalone (charge() path), emits immediately.
    this.eventEmitter.emit('subscription.payment.failed', {
      invoiceId,
      paymentId,
      reason,
    });

    return updatedPayment;
  }

  /**
   * ADR-2 helper — billing cycle duration in days.
   * Mirrors SubscriptionProrationService.billingCycleDays().
   */
  private billingCycleDays(cycle: string): number {
    return Math.ceil(this.billingCycleMs(cycle) / DAY_MS);
  }

  /**
   * RNC-22 helper — billing cycle duration in milliseconds.
   * Mirrors the table in SubscriptionBillingService.billingCycleMs() so the
   * grace-discount path computes the same period length the renewal cron
   * would have used.
   */
  private billingCycleMs(cycle: string): number {
    switch (cycle) {
      case 'monthly':
        return 30 * DAY_MS;
      case 'quarterly':
        return 90 * DAY_MS;
      case 'semiannual':
        return 180 * DAY_MS;
      case 'annual':
        return 365 * DAY_MS;
      case 'lifetime':
        return 100 * 365 * DAY_MS;
      default:
        return 30 * DAY_MS;
    }
  }

  private async handleZeroInvoice(
    invoiceId: number,
    invoice: any,
  ): Promise<subscription_payments> {
    const now = new Date();
    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'succeeded',
        amount: DECIMAL_ZERO,
        currency: invoice.currency,
        payment_method: 'zero',
        paid_at: now,
        metadata: { zero_price_skip: true } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.prisma.subscription_invoices.update({
      where: { id: invoiceId },
      data: {
        state: 'paid',
        amount_paid: DECIMAL_ZERO,
        updated_at: now,
      },
    });

    return payment;
  }
}
