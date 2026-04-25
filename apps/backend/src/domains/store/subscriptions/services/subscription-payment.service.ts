import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, subscription_payments } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PaymentGatewayService } from '../../payments/services/payment-gateway.service';
import { PaymentData, PaymentStatus } from '../../payments/interfaces/payment-processor.interface';
import { SubscriptionBillingService } from './subscription-billing.service';
import { PartnerCommissionsService } from './partner-commissions.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

const DECIMAL_ZERO = new Prisma.Decimal(0);

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
  // Core charge / refund
  // ------------------------------------------------------------------

  async charge(invoiceId: number): Promise<subscription_payments> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
      include: {
        store_subscription: {
          include: { store: { include: { store_payment_methods: { include: { system_payment_method: true } } } } },
        },
      },
    });

    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    if (invoice.state === 'paid' || invoice.state === 'void') {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_010, 'Invoice already resolved');
    }

    const paymentMethod = invoice.store_subscription.store?.store_payment_methods?.find(
      (m) => m.state === 'enabled',
    );

    if (!paymentMethod) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_PAY_001,
        'No enabled payment method for store',
      );
    }

    const total = new Prisma.Decimal(invoice.total);

    if (total.lessThanOrEqualTo(DECIMAL_ZERO)) {
      return this.handleZeroInvoice(invoiceId, invoice);
    }

    const paymentData: PaymentData = {
      orderId: invoiceId,
      amount: total.toNumber(),
      currency: invoice.currency,
      storePaymentMethodId: paymentMethod.id,
      storeId: invoice.store_id,
      metadata: {
        subscription_payment: true,
        invoice_number: invoice.invoice_number,
      },
    };

    const payment = await this.prisma.subscription_payments.create({
      data: {
        invoice_id: invoiceId,
        state: 'pending',
        amount: total,
        currency: invoice.currency,
        payment_method: paymentMethod.system_payment_method?.type ?? 'unknown',
        metadata: { store_payment_method_id: paymentMethod.id } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      const result = await this.gateway.processPayment(paymentData);

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
      if (invoice.partner_organization_id) {
        const splitBreakdown = invoice.split_breakdown as Record<string, unknown> | null;
        const partnerShare = splitBreakdown?.partner_share
          ? new Prisma.Decimal(splitBreakdown.partner_share as string)
          : DECIMAL_ZERO;

        if (partnerShare.greaterThan(DECIMAL_ZERO)) {
          const existingCommission = await tx.partner_commissions.findUnique({
            where: { invoice_id: invoiceId },
          });

          if (existingCommission && existingCommission.state === 'accrued') {
            await tx.partner_commissions.update({
              where: { id: existingCommission.id },
              data: { state: 'pending_payout' },
            });
          } else if (!existingCommission) {
            await tx.partner_commissions.create({
              data: {
                partner_organization_id: invoice.partner_organization_id,
                invoice_id: invoiceId,
                amount: partnerShare,
                currency: invoice.currency,
                state: 'pending_payout',
                accrued_at: now,
              },
            });
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
