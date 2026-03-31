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
  }) {
    try {
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
  }) {
    try {
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
