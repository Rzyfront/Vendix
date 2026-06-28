import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

interface PaymentReceivedInput {
  store_id: number;
  organization_id?: number;
  route_id: number;
  stop_id: number;
  dispatch_note_id: number;
  customer_id: number;
  sales_order_id: number | null;
  amount: number;
  payment_method: string;
  user_id: number | undefined;
  withholding_breakdown?: { retefuente?: number; reteiva?: number; reteica?: number };
}

interface CreditSaleInput {
  store_id: number;
  route_id: number;
  stop_id: number;
  dispatch_note_id: number;
  customer_id: number;
  sales_order_id: number | null;
  amount: number;
  user_id: number | undefined;
}

interface RefundInput {
  store_id: number;
  route_id: number;
  stop_id: number;
  dispatch_note_id: number;
  sales_order_id: number | null;
  amount: number;
  user_id: number | undefined;
  reason: string;
}

interface WithholdingInput {
  store_id: number;
  organization_id?: number;
  route_id: number;
  stop_id: number;
  dispatch_note_id: number;
  customer_id: number;
  sales_order_id: number | null;
  net_amount: number;
  breakdown: { retefuente?: number; reteiva?: number; reteica?: number };
  user_id: number | undefined;
}

/**
 * Emits domain events that are already handled by existing listeners
 * (accounting, accounts-receivable, notifications). Reusing them means
 * the dispatch route gets auto-entries, AR rows, and notifications
 * for free, without duplicating logic.
 */
@Injectable()
export class CashSettlementService {
  private readonly logger = new Logger(CashSettlementService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async emitPaymentReceived(input: PaymentReceivedInput) {
    // Resolve organization_id from store if missing
    let organization_id = input.organization_id;
    if (!organization_id) {
      const store = await this.prisma.stores.findUnique({
        where: { id: input.store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id;
    }
    if (!organization_id) {
      this.logger.warn(`[emitPaymentReceived] No organization_id for store ${input.store_id}`);
    }

    // Persist cash_register_movements if payment_method is cash
    if (input.payment_method === 'cash' && input.user_id) {
      const session = await this.findOpenCashSession(
        input.store_id,
        input.user_id,
      );
      if (session) {
        const movement = await this.prisma.cash_register_movements.create({
          data: {
            session_id: session.id,
            store_id: input.store_id,
            user_id: input.user_id,
            type: 'sale',
            amount: input.amount,
            payment_method: 'cash',
            reference: `dispatch_route:${input.route_id}:stop:${input.stop_id}`,
            notes: `Recaudo planilla #${input.route_id} parada #${input.stop_id}`,
          },
        });
        this.eventEmitter.emit('cash_register.movement', {
          movement_id: movement.id,
          session_id: session.id,
          store_id: input.store_id,
          organization_id,
          type: 'sale',
          amount: input.amount,
          reference: movement.reference,
          notes: movement.notes,
          user_id: input.user_id,
        });
      } else {
        this.logger.warn(
          `[emitPaymentReceived] No open cash session for store ${input.store_id} user ${input.user_id} — cash movement not recorded`,
        );
      }
    }

    // Emit payment.received so existing listeners create auto-entries, AR, notifications
    // NOTE: `order_id` is intentionally null for dispatch_route. The legacy
    // sales_orders id is carried separately as `sales_order_id` to avoid being
    // mistaken for the COD `orders.id`. The COD payment bridge
    // (PaymentFromDispatchRouteListener) resolves the real orders.id from
    // dispatch_notes.order_id via `dispatch_note_id`, never from this field.
    this.eventEmitter.emit('payment.received', {
      payment_id: null,
      source_type: 'dispatch_route',
      source_id: input.route_id,
      stop_id: input.stop_id,
      store_id: input.store_id,
      organization_id,
      order_id: null,
      sales_order_id: input.sales_order_id,
      dispatch_note_id: input.dispatch_note_id,
      amount: input.amount,
      subtotal_amount: input.amount,
      tax_amount: 0,
      tax_breakdown: [],
      withholding_breakdown: input.withholding_breakdown
        ? Object.entries(input.withholding_breakdown)
            .filter(([_, v]) => Number(v) > 0)
            .map(([code, amount]) => ({ code, amount: Number(amount) }))
        : [],
      discount_amount: 0,
      currency: 'COP',
      payment_method: input.payment_method,
      user_id: input.user_id,
    });
  }

  async emitCreditSale(input: CreditSaleInput) {
    // Sin crédito / pago parcial en ruta: el pago es total o no hay pago. La
    // liquidación de paradas ya nunca produce credit_amount > 0, así que esta
    // rama queda muerta. La protegemos como defensa en profundidad para que un
    // monto residual jamás genere un accounts_receivable ni emita
    // 'credit_sale.created' por una venta a crédito en ruta. NO toca las demás
    // emisiones (payment.received / refund.completed / withholding).
    if (!(input.amount > 0)) {
      return null;
    }

    const store = await this.prisma.stores.findUnique({
      where: { id: input.store_id },
      select: { organization_id: true },
    });
    const organization_id = store?.organization_id;
    if (!organization_id) {
      this.logger.warn(`[emitCreditSale] No organization_id for store ${input.store_id}`);
      return null;
    }

    const today = new Date();
    const due_date = new Date(today);
    due_date.setDate(due_date.getDate() + 30);

    // Create accounts_receivable row (real schema: original_amount, paid_amount, balance, issue_date, due_date, status)
    const ar = await this.prisma.accounts_receivable.create({
      data: {
        store_id: input.store_id,
        organization_id,
        customer_id: input.customer_id,
        source_type: 'dispatch_route',
        source_id: input.sales_order_id || input.dispatch_note_id,
        original_amount: input.amount,
        paid_amount: 0,
        balance: input.amount,
        issue_date: today,
        due_date,
        status: 'open',
        notes: `Parada #${input.stop_id} de planilla #${input.route_id}`,
      },
    });

    this.eventEmitter.emit('credit_sale.created', {
      source_type: 'dispatch_route',
      source_id: input.route_id,
      stop_id: input.stop_id,
      order_id: input.sales_order_id,
      accounts_receivable_id: ar.id,
      organization_id,
      store_id: input.store_id,
      total_amount: input.amount,
      customer_id: input.customer_id,
      user_id: input.user_id,
    });

    return ar;
  }

  async emitRefundCompleted(input: RefundInput) {
    // refunds table requires order_id NOT NULL. For dispatch_route changes, we
    // bypass the refunds table and just emit refund.completed event for
    // accounting listeners (the cash_register_movement with type='refund' is
    // the actual ledger entry).
    if (input.sales_order_id && input.user_id) {
      try {
        const refund = await this.prisma.refunds.create({
          data: {
            order_id: input.sales_order_id,
            customer_id: null,
            amount: input.amount,
            subtotal_refund: input.amount,
            tax_refund: 0,
            shipping_refund: 0,
            currency: 'COP',
            reason: input.reason,
            state: 'completed',
            refund_method: 'cash_on_route',
            processed_by_user_id: input.user_id,
            requested_at: new Date(),
            processed_at: new Date(),
          },
        });
        this.eventEmitter.emit('refund.completed', {
          refund_id: refund.id,
          source_type: 'dispatch_route_change',
          source_id: input.stop_id,
          route_id: input.route_id,
          dispatch_note_id: input.dispatch_note_id,
          store_id: input.store_id,
          amount: input.amount,
          subtotal: input.amount,
          tax: 0,
          tax_amount: 0,
          tax_breakdown: [],
          shipping: 0,
          is_full_refund: false,
          user_id: input.user_id,
        });
        return refund;
      } catch (err) {
        this.logger.warn(
          `[emitRefundCompleted] Could not persist refund row, emitting event only: ${(err as Error).message}`,
        );
      }
    } else {
      // No sales_order_id — still emit for accounting to record the change.
      this.eventEmitter.emit('refund.completed', {
        source_type: 'dispatch_route_change',
        source_id: input.stop_id,
        route_id: input.route_id,
        dispatch_note_id: input.dispatch_note_id,
        store_id: input.store_id,
        amount: input.amount,
        subtotal: input.amount,
        tax: 0,
        tax_amount: 0,
        tax_breakdown: [],
        shipping: 0,
        is_full_refund: false,
        user_id: input.user_id,
      });
    }
    return null;
  }

  /**
   * Persists withholding SUFFERED by the store when a withholding-agent customer
   * retains part of the payment in the route. Role is 'suffered' (an asset/credit
   * the store can offset against its own tax, NOT an expense).
   *
   * IMPORTANT: We deliberately do NOT emit 'withholding.applied' here. That event's
   * accounting listener books a withholding-PAYABLE expense entry, which is correct
   * only for withholding PRACTICED on purchases (role='practiced'). For suffered
   * withholding the store is the retained party, so we only persist the calculation
   * row; the figure does not represent a cash shortfall in the route settlement.
   *
   * Concept resolution is defensive: if the organization has no active
   * withholding_concepts for a given type, we skip that row and warn instead of
   * failing the route closure — incomplete fiscal config must not block logistics.
   */
  async emitWithholding(input: WithholdingInput) {
    let organization_id = input.organization_id;
    if (!organization_id) {
      const store = await this.prisma.stores.findUnique({
        where: { id: input.store_id },
        select: { organization_id: true },
      });
      organization_id = store?.organization_id;
    }
    if (!organization_id) {
      this.logger.warn(
        `[emitWithholding] No organization_id for store ${input.store_id} — withholding not persisted`,
      );
      return [];
    }

    const base = Number(input.net_amount);
    if (!(base > 0)) {
      this.logger.warn(
        `[emitWithholding] Non-positive net_amount (${base}) for stop ${input.stop_id} — skipped`,
      );
      return [];
    }

    const year = new Date().getFullYear();
    const types: Array<'retefuente' | 'reteiva' | 'reteica'> = [
      'retefuente',
      'reteiva',
      'reteica',
    ];
    const created: Array<{ id: number; withholding_type: string; amount: number }> = [];

    for (const type of types) {
      const amount = Number(input.breakdown?.[type] || 0);
      if (!(amount > 0)) continue;

      // Resolve an active concept for this org + withholding_type (FK is NOT NULL).
      const concept = await this.prisma.withholding_concepts.findFirst({
        where: {
          organization_id,
          withholding_type: type,
          is_active: true,
        },
        orderBy: { id: 'asc' },
      });
      if (!concept) {
        this.logger.warn(
          `[emitWithholding] No active withholding_concepts for org ${organization_id} type '${type}' — row skipped (stop ${input.stop_id}, amount ${amount})`,
        );
        continue;
      }

      const row = await this.prisma.withholding_calculations.create({
        data: {
          organization_id,
          store_id: input.store_id,
          customer_id: input.customer_id,
          concept_id: concept.id,
          role: 'suffered',
          counterparty_type: 'customer',
          withholding_type: type,
          base_amount: base,
          withholding_rate: amount / base,
          withholding_amount: amount,
          uvt_value_used: 0,
          year,
        },
      });
      created.push({ id: row.id, withholding_type: type, amount });
    }

    if (created.length) {
      this.logger.log(
        `[emitWithholding] Persisted ${created.length} suffered withholding row(s) for stop ${input.stop_id}: ${created
          .map((c) => `${c.withholding_type}=${c.amount}`)
          .join(', ')}`,
      );
    }
    return created;
  }

  private async findOpenCashSession(store_id: number, opened_by: number) {
    return this.prisma.cash_register_sessions.findFirst({
      where: {
        store_id,
        status: 'open',
        opened_by,
      },
      orderBy: { opened_at: 'desc' },
    });
  }
}
