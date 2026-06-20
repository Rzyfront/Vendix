import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { AccountsReceivableService } from '../accounts-receivable.service';

@Injectable()
export class ArEventsListener {
  private readonly logger = new Logger(ArEventsListener.name);

  constructor(
    private readonly ar_service: AccountsReceivableService,
    private readonly prisma: StorePrismaService,
  ) {}

  // ─── CREDIT SALE CREATED ───────────────────────────────────
  @OnEvent('credit_sale.created')
  async handleCreditSaleCreated(event: {
    order_id: number;
    customer_id: number;
    total_amount: number;
    document_number?: string;
    organization_id: number;
    store_id: number;
    due_date?: Date;
    /**
     * Source discriminator. The dispatch-route settlement flow emits
     * `credit_sale.created` with `source_type='dispatch_route'` AFTER it
     * has already created the AR row in the dispatch route's own service.
     * Without this guard, the listener would create a SECOND AR with
     * `source_id=null` (because dispatch notes have no order_id), leading
     * to phantom receivables.
     */
    source_type?: string;
  }) {
    try {
      // The dispatch-route flow has its own CashSettlementService that
      // creates the AR row directly. Skip the duplicate here.
      if (event.source_type === 'dispatch_route') return;

      const ar = await this.ar_service.createFromEvent({
        customer_id: event.customer_id,
        source_type: 'credit_sale',
        source_id: event.order_id,
        document_number: event.document_number,
        original_amount: event.total_amount,
        due_date: event.due_date,
        organization_id: event.organization_id,
        store_id: event.store_id,
      });

      this.logger.log(
        `AR #${ar.id} created for credit_sale order #${event.order_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create AR for credit_sale #${event.order_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── PAYMENT RECEIVED ─────────────────────────────────────
  @OnEvent('payment.received')
  async handlePaymentReceived(event: {
    payment_id: number;
    order_id: number;
    amount: number;
    payment_method?: string;
    store_id: number;
    organization_id: number;
    user_id?: number;
    /**
     * Optional source discriminator. The dispatch-route settlement flow
     * emits `payment.received` with `source_type='dispatch_route'` but no
     * `order_id` — that event is handled by
     * `PaymentFromDispatchRouteListener`, not here. Without this guard
     * the listener was matching the wrong AR row (where
     * `source_id IS NULL`) and trying to apply a 100k settlement onto a
     * 20k receivable, throwing 400 and corrupting the route close.
     */
    source_type?: string;
  }) {
    try {
      // The dispatch-route settlement flow has its own dedicated listener
      // (PaymentFromDispatchRouteListener) and emits with order_id=null
      // and source_type='dispatch_route'. Bailing out here keeps the AR
      // listener strictly for legacy / POS / order-level payments.
      if (event.source_type === 'dispatch_route' || !event.order_id) return;

      const ar = await this.prisma.accounts_receivable.findFirst({
        where: {
          source_id: event.order_id,
          source_type: { in: ['credit_sale', 'order'] },
          status: { in: ['open', 'partial', 'overdue'] },
        },
      });

      if (!ar) return; // No AR for this order — skip silently

      await this.ar_service.registerPayment(
        ar.id,
        {
          amount: event.amount,
          payment_id: event.payment_id,
          payment_method: event.payment_method,
        },
        event.user_id || 0,
      );

      this.logger.log(
        `Payment of $${event.amount} registered on AR #${ar.id} from payment #${event.payment_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update AR for payment #${event.payment_id}: ${error.message}`,
        error.stack,
      );
    }
  }

  // ─── INSTALLMENT PAYMENT RECEIVED ─────────────────────────
  @OnEvent('installment_payment.received')
  async handleInstallmentPaymentReceived(event: {
    payment_id: number;
    order_id?: number;
    credit_id?: number;
    amount: number;
    payment_method?: string;
    store_id: number;
    organization_id: number;
    user_id?: number;
  }) {
    try {
      const source_id = event.order_id || event.credit_id;
      if (!source_id) return;

      const ar = await this.prisma.accounts_receivable.findFirst({
        where: {
          source_id,
          status: { in: ['open', 'partial', 'overdue'] },
        },
      });

      if (!ar) return;

      await this.ar_service.registerPayment(
        ar.id,
        {
          amount: event.amount,
          payment_id: event.payment_id,
          payment_method: event.payment_method,
        },
        event.user_id || 0,
      );

      this.logger.log(
        `Installment payment of $${event.amount} registered on AR #${ar.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update AR for installment payment: ${error.message}`,
        error.stack,
      );
    }
  }
}
