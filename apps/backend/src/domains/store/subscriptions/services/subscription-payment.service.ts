import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, subscription_payments } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PaymentGatewayService } from '../../payments/services/payment-gateway.service';
import { PaymentData, PaymentStatus } from '../../payments/interfaces/payment-processor.interface';
import { WompiProcessor } from '../../payments/processors/wompi/wompi.processor';
import { WompiEnvironment } from '../../payments/processors/wompi/wompi.types';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { PlatformGatewayEnvironmentEnum } from '../../../superadmin/subscriptions/gateway/dto/upsert-gateway.dto';
import { SubscriptionBillingService } from './subscription-billing.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

const DECIMAL_ZERO = new Prisma.Decimal(0);

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
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly platformGw: PlatformGatewayService,
    private readonly wompiProcessor: WompiProcessor,
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
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_010, 'Invoice already resolved');
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
        customer_email: opts.customerEmail ?? `saas-${invoice.store_id}@vendix.app`,
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
    return require('crypto').createHash('sha256').update(concatenated).digest('hex');
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
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Payment not found');
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

  async markPaymentSucceededFromWebhook(input: {
    paymentId: number;
    invoiceId: number;
    transactionId?: string;
    gatewayResponse?: any;
  }): Promise<subscription_payments | null> {
    const { paymentId, invoiceId, transactionId, gatewayResponse } = input;

    const payment = await this.prisma.subscription_payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      this.logger.warn(`markPaymentSucceededFromWebhook: payment ${paymentId} not found`);
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

    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      this.logger.warn(`markPaymentSucceededFromWebhook: invoice ${invoiceId} not found`);
      return null;
    }

    return this.handleChargeSuccess(paymentId, invoiceId, invoice, transactionId, gatewayResponse);
  }

  async markPaymentFailedFromWebhook(input: {
    paymentId: number;
    invoiceId: number;
    reason: string;
  }): Promise<subscription_payments | null> {
    const { paymentId, invoiceId, reason } = input;

    const payment = await this.prisma.subscription_payments.findUnique({
      where: { id: paymentId },
    });
    if (!payment) {
      this.logger.warn(`markPaymentFailedFromWebhook: payment ${paymentId} not found`);
      return null;
    }

    if (this.isTerminalState(payment.state)) {
      this.logger.log(
        `markPaymentFailedFromWebhook: payment ${paymentId} already in ${payment.state}, skipping`,
      );
      return payment;
    }

    return this.handleChargeFailure(paymentId, invoiceId, reason);
  }

  private isTerminalState(state: subscription_payments['state']): boolean {
    return state === 'succeeded' || state === 'failed' || state === 'refunded' || state === 'partial_refund';
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
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_010, 'Invoice already resolved');
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
        } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      // Bypass PaymentGatewayService registry (which assumes per-store
      // credentials) and call the Wompi processor directly with platform
      // creds + SaaS metadata.
      const result = await this.wompiProcessor.processPayment(paymentData);

      if (result.success) {
        return this.handleChargeSuccess(
          payment.id,
          invoiceId,
          invoice,
          result.transactionId,
          result.gatewayResponse,
        );
      }

      return this.handleChargeFailure(payment.id, invoiceId, result.message ?? 'Charge failed');
    } catch (err) {
      return this.handleChargeFailure(
        payment.id,
        invoiceId,
        err instanceof Error ? err.message : 'Charge failed',
      );
    }
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

  async refund(invoiceId: number, amount?: number): Promise<subscription_payments> {
    const existing = await this.prisma.subscription_payments.findFirst({
      where: { invoice_id: invoiceId, state: 'succeeded' },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'No successful payment to refund');
    }

    if (!existing.gateway_reference) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'No gateway reference on payment',
      );
    }

    const refundAmount = amount ?? new Prisma.Decimal(existing.amount).toNumber();

    const refundResult = await this.gateway.refundPayment(
      existing.gateway_reference,
      refundAmount,
      'Subscription refund',
    );

    return this.prisma.$transaction(async (tx: any) => {
      const isFullRefund =
        !amount || new Prisma.Decimal(amount).greaterThanOrEqualTo(existing.amount);

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
  ): Promise<subscription_payments> {
    return this.prisma.$transaction(async (tx: any) => {
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

      // Transition commission from accrued -> pending_payout, or create it
      // if the billing service hasn't already.
      //
      // Race-safe pattern:
      //  1. updateMany with state='accrued' filter acts as a state-machine
      //     guard — idempotent: if already pending_payout/paid, the WHERE
      //     filter excludes the row and the update is a no-op.
      //  2. If updateMany affected 0 rows, the row may not exist yet
      //     (billing service hasn't accrued). Use upsert keyed on the
      //     unique invoice_id to create it directly in pending_payout, or
      //     no-op if a concurrent writer just inserted in another state.
      //  3. Catch P2002 as defense in depth against unique-violation races.
      if (invoice.partner_organization_id) {
        const splitBreakdown = invoice.split_breakdown as Record<string, unknown> | null;
        const partnerShare = splitBreakdown?.partner_share
          ? new Prisma.Decimal(splitBreakdown.partner_share as string)
          : DECIMAL_ZERO;

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          const transitioned = await tx.partner_commissions.updateMany({
            where: { invoice_id: invoiceId, state: 'accrued' },
            data: { state: 'pending_payout' },
          });

          if (transitioned.count === 0) {
            try {
              await tx.partner_commissions.upsert({
                where: { invoice_id: invoiceId },
                create: {
                  partner_organization_id: invoice.partner_organization_id,
                  invoice_id: invoiceId,
                  amount: partnerShare,
                  currency: invoice.currency,
                  state: 'pending_payout',
                  accrued_at: now,
                },
                update: {}, // no-op: preserve existing row & state
              });
            } catch (e: any) {
              if (e?.code !== 'P2002') {
                throw e;
              }
              this.logger.warn(
                `Commission upsert hit P2002 for invoice ${invoiceId}; skipped`,
              );
            }
          }
        }
      }

      return updatedPayment;
    });
  }

  private async handleChargeFailure(
    paymentId: number,
    invoiceId: number,
    reason: string,
  ): Promise<subscription_payments> {
    const updatedPayment = await this.prisma.subscription_payments.update({
      where: { id: paymentId },
      data: {
        state: 'failed',
        failure_reason: reason,
        updated_at: new Date(),
      },
    });

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
