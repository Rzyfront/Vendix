import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { SubscriptionStateService } from './subscription-state.service';
import { SubscriptionPaymentService } from './subscription-payment.service';
import { SubscriptionResolverService } from './subscription-resolver.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

const DECIMAL_ZERO = new Prisma.Decimal(0);

@Injectable()
export class SubscriptionManualPaymentService {
  private readonly logger = new Logger(SubscriptionManualPaymentService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly eventEmitter: EventEmitter2,
    private readonly resolver: SubscriptionResolverService,
  ) {}

  async recordManualPayment(
    invoiceId: number,
    opts: {
      bankReference: string;
      paidAt: Date;
      amount: Prisma.Decimal;
      recordedByUserId: number;
      /** Base period end handed to the reactivation seam (optional). */
      periodEnd?: Date;
      /** Plan whose billing cycle governs the derived period (optional). */
      planId?: number;
      /** Merged into payment metadata and the `manual_payment` event payload. */
      extraMetadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const result = await this.prisma.$transaction(async (tx: any) => {
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

      const payment = await tx.subscription_payments.create({
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
            ...(opts.extraMetadata ?? {}),
            excess_amount: excess.greaterThan(DECIMAL_ZERO)
              ? excess.toFixed(2)
              : null,
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
        const metadata = (sub.metadata as Record<string, unknown> | null) ?? {};
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

      // Promote the subscription through the single reactivation seam. NO
      // try/catch: if the store cannot be left operational the whole
      // transaction (payment + invoice) must abort, never report a success on
      // a store that stays blocked.
      let operational: { finalState: string; path: string[] } | null = null;
      const fromState: string | null =
        invoice.store_subscription?.state ?? null;
      if (invoice.store_id) {
        operational = await this.stateService.ensureOperationalInTx(
          tx,
          invoice.store_id,
          {
            reason: `manual_payment_invoice_${invoiceId}`,
            triggeredByUserId: opts.recordedByUserId,
            periodEnd: opts.periodEnd,
            planId: opts.planId,
            payload: {
              manual_payment: true,
              invoice_id: invoiceId,
              ...(opts.extraMetadata ?? {}),
            },
          },
        );
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
            ...(opts.extraMetadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });

      return {
        operational,
        fromState,
        paymentId: payment.id,
        subscriptionId: invoice.store_subscription_id,
        storeId: invoice.store_id,
      };
    });

    // Post-commit side effects of the reactivation (same pattern as
    // `ensureOperational`): cache invalidation + state-changed event.
    if (result.storeId && result.operational?.path.length) {
      try {
        await this.resolver.invalidate(result.storeId);
      } catch (error) {
        this.logger.warn(
          `resolver.invalidate failed for manual payment invoice ${invoiceId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      try {
        this.eventEmitter.emit('subscription.state.changed', {
          storeId: result.storeId,
          fromState: result.fromState,
          toState: result.operational.finalState,
          reason: `manual_payment_invoice_${invoiceId}`,
          triggeredByUserId: opts.recordedByUserId,
          path: result.operational.path,
        });
      } catch (error) {
        this.logger.warn(
          `subscription.state.changed emit failed for manual payment invoice ${invoiceId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    try {
      await this.paymentService.enqueueCommissionAccrualPostCommit(invoiceId);
    } catch (error) {
      this.logger.error(
        `COMMISSION_ENQUEUE_FAILED manual payment invoice ${invoiceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      this.eventEmitter.emit('subscription.payment.succeeded', {
        invoiceId,
        paymentId: result.paymentId,
        subscriptionId: result.subscriptionId,
        storeId: result.storeId,
        source: 'manual_payment',
      });
    } catch (error) {
      this.logger.warn(
        `subscription.payment.succeeded emit failed for manual payment invoice ${invoiceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // DEFECTO 9 — el pago manual pasa por el MISMO gate.
    //
    // Una consignación registrada por el administrador nunca deja tarjeta: no
    // pasa por `handleChargeSuccess`, ni por
    // `autoRegisterPaymentMethodFromGateway`, ni por el gate. La transición a
    // `active` de más arriba (y la ventana de reactivación que cuelga de ella)
    // devolvía la tienda a operar con `auto_renew` como estuviera, así que la
    // tienda salía "activa con autopago" y sin nada con qué renovar — el mismo
    // final del incidente, por otra puerta.
    //
    // Fuera de la transacción a propósito: el gate abre la suya y correrlo dentro
    // de esta pelearía con el `FOR UPDATE` que ya tomó `transitionInTx`. El aviso
    // también debe salir después del commit.
    if (result.storeId) {
      try {
        await this.paymentService.pauseAutoRenewForMissingCredential({
          subscriptionId: result.subscriptionId,
          storeId: result.storeId,
          source: 'manual_payment',
          triggeredByJob: 'manual-payment',
          auditSource: 'manual_payment_no_credential',
          eventKey: `manual-${invoiceId}-${result.paymentId}`,
          payload: { invoice_id: invoiceId, payment_id: result.paymentId },
        });
      } catch (error) {
        this.logger.error(
          `AUTO_RENEW_GATE_FAILED manual payment invoice ${invoiceId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
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
