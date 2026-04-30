import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from './subscription-state.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

const DECIMAL_ZERO = new Prisma.Decimal(0);

@Injectable()
export class SubscriptionManualPaymentService {
  private readonly logger = new Logger(SubscriptionManualPaymentService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async recordManualPayment(
    invoiceId: number,
    opts: {
      bankReference: string;
      paidAt: Date;
      amount: Prisma.Decimal;
      recordedByUserId: number;
    },
  ): Promise<void> {
    return this.prisma.$transaction(async (tx: any) => {
      const invoice = await tx.subscription_invoices.findUnique({
        where: { id: invoiceId },
        include: { store_subscription: true },
      });
      if (!invoice) {
        throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
      }
      if (invoice.state === 'paid') {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_010,
          'Invoice already paid',
        );
      }

      const paidAmount = opts.amount;
      const invoiceTotal = new Prisma.Decimal(invoice.total);
      const excess = paidAmount.greaterThan(invoiceTotal)
        ? paidAmount.minus(invoiceTotal)
        : DECIMAL_ZERO;

      await tx.subscription_payments.create({
        data: {
          invoice_id: invoiceId,
          state: 'succeeded',
          amount: paidAmount,
          currency: invoice.currency,
          payment_method: 'manual',
          gateway_reference: opts.bankReference,
          paid_at: opts.paidAt,
          metadata: {
            manual_payment: true,
            recorded_by_user_id: opts.recordedByUserId,
            bank_reference: opts.bankReference,
            excess_amount: excess.greaterThan(DECIMAL_ZERO) ? excess.toFixed(2) : null,
          } as Prisma.InputJsonValue,
        },
      });

      await tx.subscription_invoices.update({
        where: { id: invoiceId },
        data: {
          state: 'paid',
          amount_paid: paidAmount,
          updated_at: new Date(),
        },
      });

      // Apply excess as pending_credit for next invoice (RNC-13)
      if (excess.greaterThan(DECIMAL_ZERO)) {
        const sub = invoice.store_subscription;
        const metadata = sub.metadata as Record<string, unknown> | null ?? {};
        const existingCreditRaw = metadata['pending_credit'];
        const existingCredit =
          typeof existingCreditRaw === 'string' ||
          typeof existingCreditRaw === 'number'
            ? new Prisma.Decimal(existingCreditRaw)
            : DECIMAL_ZERO;
        await tx.store_subscriptions.update({
          where: { id: sub.id },
          data: {
            metadata: {
              ...metadata,
              pending_credit: existingCredit.plus(excess).toFixed(2),
            } as Prisma.InputJsonValue,
          },
        });
        this.logger.log(
          `Excess payment $${excess.toFixed(2)} for invoice ${invoiceId} → pending_credit on sub ${sub.id}`,
        );
      }

      // Try promoting the subscription state (recovery from dunning etc.)
      if (invoice.store_id) {
        try {
          await this.stateService.transitionInTx(
            tx,
            invoice.store_id,
            'active',
            {
              reason: `manual_payment_invoice_${invoiceId}`,
              triggeredByUserId: opts.recordedByUserId,
              payload: { manual_payment: true, invoice_id: invoiceId },
            },
          );
        } catch (err) {
          this.logger.warn(
            `State promotion failed for manual payment invoice ${invoiceId}: ${(err as Error).message}`,
          );
        }
      }

      await tx.subscription_events.create({
        data: {
          store_subscription_id: invoice.store_subscription_id,
          type: 'manual_payment',
          payload: {
            invoice_id: invoiceId,
            invoice_number: invoice.invoice_number,
            bank_reference: opts.bankReference,
            amount: paidAmount.toFixed(2),
            excess: excess.greaterThan(DECIMAL_ZERO) ? excess.toFixed(2) : null,
            recorded_by_user_id: opts.recordedByUserId,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }

  async getInvoiceForManualPayment(invoiceId: number): Promise<{
    id: number;
    invoice_number: string;
    total: string;
    store_subscription_id: number;
    store_id: number;
    state: string;
  } | null> {
    const invoice = await this.prisma.subscription_invoices.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        invoice_number: true,
        total: true,
        store_subscription_id: true,
        store_id: true,
        state: true,
      },
    });
    if (!invoice) return null;
    if (invoice.state === 'paid' || invoice.state === 'void') return null;
    return {
      ...invoice,
      total: invoice.total.toFixed(2),
    };
  }
}
