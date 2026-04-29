import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, subscription_payments } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PaymentGatewayService } from '../../payments/services/payment-gateway.service';
import {
  PaymentData,
  PaymentStatus,
} from '../../payments/interfaces/payment-processor.interface';
import { WompiProcessor } from '../../payments/processors/wompi/wompi.processor';
import { WompiEnvironment } from '../../payments/processors/wompi/wompi.types';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { PlatformGatewayEnvironmentEnum } from '../../../superadmin/subscriptions/gateway/dto/upsert-gateway.dto';
import { SubscriptionBillingService } from './subscription-billing.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { SubscriptionStateService } from './subscription-state.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

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
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly platformGw: PlatformGatewayService,
    private readonly wompiProcessor: WompiProcessor,
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

    const paymentData: PaymentData = {
      orderId: invoiceId,
      amount: total.toNumber(),
      currency: invoice.currency,
      // No per-store payment method on the SaaS path; the gateway is
      // resolved via PlatformGatewayService.
      storeId: invoice.store_id,
      idempotencyKey,
      metadata: {
        subscription_payment: true,
        subscriptionId: invoice.store_subscription_id,
        invoiceId,
        invoice_number: invoice.invoice_number,
        reference,
        // Tells WompiProcessor to use these creds INSTEAD of looking up
        // store_payment_methods.custom_config (which doesn't apply for SaaS).
        wompiConfig: this.toProcessorWompiConfig(wompiConfig),
        // G11 — When a reusable saved card is present, pass its tokenized
        // payment_method shape directly to the processor so renewals do
        // NOT prompt the user to re-enter card data.
        ...(reusablePm
          ? {
              paymentMethod: {
                type: 'CARD',
                token: reusablePm.provider_token,
                installments: 1,
              },
              saved_payment_method_id: reusablePm.id,
            }
          : {}),
      },
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
          ...(reusablePm
            ? { saved_payment_method_id: reusablePm.id }
            : {}),
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
   * G11 / S3.5 — Returns the active default payment method for a subscription
   * if it is usable for an automatic renewal charge:
   *   - state = 'active'
   *   - not expired (expiry_year/expiry_month either null = unknown or future)
   *   - consecutive_failures < MAX_CONSECUTIVE_FAILURES (real column).
   *
   * Returns null if no eligible PM is found; callers fall back to the
   * Wompi widget flow.
   */
  private async resolveReusablePaymentMethod(
    subscriptionId: number,
  ): Promise<{
    id: number;
    provider_token: string;
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

    return { id: pm.id, provider_token: pm.provider_token };
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
  private extractSavedPaymentMethodId(
    metadata: unknown,
  ): number | null {
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

      if (refundResult.success) {
        await tx.subscription_invoices.update({
          where: { id: invoiceId },
          data: {
            state: isFullRefund ? 'refunded' : 'partially_paid',
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
    const executeWrites = async (tx: Prisma.TransactionClient): Promise<subscription_payments> => {
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

      // Synchronous subscription-state promotion (root-cause fix for
      // pending_payment drift). The listener at
      // `SubscriptionStateListener.onPaymentSucceeded` is best-effort and
      // post-commit; if it fails or is delayed, subscriptions get stuck in
      // pending_payment despite the payment being approved. Doing the
      // promotion here, INSIDE the same tx that flips payment->succeeded
      // and invoice->paid, guarantees atomicity.
      //
      // Errors are logged and swallowed (not propagated): the payment is
      // already confirmed by the gateway; we must not roll back to "pending"
      // because of a state-transition issue. The reconciliation cron picks
      // up any drift left by this best-effort path.
      if (invoice.store_id) {
        try {
          const subRow = await tx.store_subscriptions.findUnique({
            where: { id: invoice.store_subscription_id },
            select: { state: true },
          });
          const currentState = subRow?.state as string | undefined;
          if (
            currentState &&
            PROMOTABLE_ON_PAYMENT_SUCCESS.includes(
              currentState as (typeof PROMOTABLE_ON_PAYMENT_SUCCESS)[number],
            )
          ) {
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
