import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { shouldRecordCashMovement } from '../../cash-registers/movements/cash-movement-policy.util';
import type { Prisma } from '@prisma/client';

export interface PaymentReceivedInput {
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

export interface RecordedCashMovementEvent {
  movement_id: number;
  session_id: number;
  store_id: number;
  organization_id: number | null;
  type: 'sale';
  amount: number;
  reference: string | null;
  notes: string | null;
  user_id: number;
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
    private readonly sessions: SessionsService,
  ) {}

  /**
   * @deprecated D8: el recaudo en ruta ya NO registra movimiento de caja por
   * parada; los movimientos se registran al cierre de la planilla contra la
   * sesión elegida (`recordRouteCloseMovements`). Sin callers de producción.
   * Se conserva solo por compatibilidad con specs/rutas en vuelo.
   */
  async recordCashMovement(
    tx: any,
    input: PaymentReceivedInput,
  ): Promise<RecordedCashMovementEvent | null> {
    if (input.payment_method !== 'cash' || !input.user_id) return null;
    const session = await this.findOpenCashSession(input.store_id, input.user_id);
    if (!session) {
      await this.sessions.assertSessionForSales(input.user_id);
      return null;
    }
    const locked = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM cash_register_sessions
      WHERE id = ${session.id} AND store_id = ${input.store_id} AND status = 'open'
      FOR UPDATE
    `;
    if (locked.length !== 1) {
      throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);
    }
    const movement = await tx.cash_register_movements.create({
      data: {
        session_id: session.id,
        store_id: input.store_id,
        user_id: input.user_id,
        type: 'sale',
        amount: input.amount,
        payment_method: 'cash',
        reference: `dispatch_route:${input.route_id}:stop:${input.stop_id}`,
        notes: `Recaudo ruta #${input.route_id} parada #${input.stop_id}`,
      },
    });
    const store = await tx.stores.findUnique({
      where: { id: input.store_id },
      select: { organization_id: true },
    });
    return {
      movement_id: movement.id,
      session_id: session.id,
      store_id: input.store_id,
      organization_id: input.organization_id ?? store?.organization_id ?? null,
      type: 'sale',
      amount: input.amount,
      reference: movement.reference,
      notes: movement.notes,
      user_id: input.user_id,
    };
  }

  /**
   * ¿La tienda exige caja? Misma lectura que `SessionsService.assertSessionForSales`
   * (`pos.cash_register.enabled`): sin usuario esa función lanza
   * CASH_SESSION_REQUIRED_001 si y solo si la caja está habilitada, así que se
   * reutiliza sin duplicar la lectura de settings ni tocar el módulo.
   */
  async isCashRegisterRequired(): Promise<boolean> {
    try {
      await this.sessions.assertSessionForSales();
      return false;
    } catch (error) {
      if (
        error instanceof VendixHttpException &&
        error.errorCode === ErrorCodes.CASH_SESSION_REQUIRED_001.code
      ) {
        return true;
      }
      throw error;
    }
  }

  /** Sesiones de caja abiertas de la tienda (picker del cierre de planilla). */
  async listOpenSessions(store_id: number) {
    const rows = await this.prisma.cash_register_sessions.findMany({
      where: { store_id, status: 'open' },
      orderBy: { opened_at: 'desc' },
      select: {
        id: true,
        cash_register_id: true,
        opened_at: true,
        register: { select: { id: true, name: true } },
        opened_by_user: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
    return rows.map((r: any) => ({
      id: r.id,
      register_id: r.cash_register_id,
      register_name: r.register?.name ?? null,
      opened_by: {
        id: r.opened_by_user?.id,
        name:
          `${r.opened_by_user?.first_name ?? ''} ${r.opened_by_user?.last_name ?? ''}`.trim(),
      },
      opened_at: r.opened_at,
    }));
  }

  /**
   * D10: asienta el recaudo de la ruta en la sesión elegida, un movimiento
   * `sale` por método de pago, dentro de la tx de cierre (la sesión ya viene
   * bloqueada FOR UPDATE por el llamador).
   *
   * - Solo paradas delivered/partial, no prepagas, con `collected_amount` > 0.
   *   El anticipo NO se suma: es dinero que no recibió el conductor en ruta (B20).
   * - El método es el real de la parada; si falta con cobro > 0 se lanza
   *   `PAY_METHOD_MISCONFIGURED` (nunca se asume `'cash'`, B26), y los métodos
   *   que no mueven el cajón (wompi, wallet, contra entrega) se omiten (B08).
   * - Excluye paradas con movimiento legado `dispatch_route:{id}:stop:{stopId}`
   *   (rutas en vuelo con código previo).
   * - Idempotente por `reference` (`dispatch_route:{id}:close:{method}`).
   * - NO emite `cash_register.movement`: el listener solo entiende
   *   cash_in/cash_out y trataría un `sale` como retiro; el asiento del
   *   recaudo ya lo genera `payment.received` (igual que POS, que tampoco lo
   *   emite para sus movimientos `sale`).
   */
  async recordRouteCloseMovements(
    tx: any,
    input: {
      store_id: number;
      route_id: number;
      route_number: string;
      session_id: number;
      responsible_user_id: number;
      stops: Array<{
        id: number;
        result?: string | null;
        is_prepaid: boolean;
        payment_method?: string | null;
        collected_amount?: unknown;
        anticipo_amount?: unknown;
      }>;
    },
  ) {
    const eligible = input.stops.filter(
      (s) =>
        (s.result === 'delivered' || s.result === 'partial') && !s.is_prepaid,
    );
    if (eligible.length === 0) return [];

    const legacyRefs = eligible.map(
      (s) => `dispatch_route:${input.route_id}:stop:${s.id}`,
    );
    const legacy = await tx.cash_register_movements.findMany({
      where: { store_id: input.store_id, reference: { in: legacyRefs } },
      select: { reference: true },
    });
    const legacySet = new Set<string>(legacy.map((m: any) => m.reference));

    const byMethod = new Map<string, { amount: number; stops: number }>();
    for (const s of eligible) {
      if (legacySet.has(`dispatch_route:${input.route_id}:stop:${s.id}`)) continue;
      const amount = Number(s.collected_amount || 0);
      if (!(amount > 0)) continue;
      // Lanza PAY_METHOD_MISCONFIGURED si el método falta (política B26).
      if (!shouldRecordCashMovement(s.payment_method)) continue;
      const method = s.payment_method as string;
      const cur = byMethod.get(method) ?? { amount: 0, stops: 0 };
      cur.amount += amount;
      cur.stops += 1;
      byMethod.set(method, cur);
    }

    const created: Array<{
      id: number;
      payment_method: string;
      amount: number;
      reference: string;
    }> = [];
    for (const [method, agg] of byMethod) {
      const amount = Math.round(agg.amount * 100) / 100;
      if (!(amount > 0)) continue;
      const reference = `dispatch_route:${input.route_id}:close:${method}`;
      const existing = await tx.cash_register_movements.findFirst({
        where: { store_id: input.store_id, reference },
        select: { id: true },
      });
      if (existing) continue;
      const movement = await tx.cash_register_movements.create({
        data: {
          session_id: input.session_id,
          store_id: input.store_id,
          user_id: input.responsible_user_id,
          type: 'sale',
          amount,
          payment_method: method,
          reference,
          notes: `Recaudo ruta ${input.route_number} (${agg.stops} paradas)`,
          // B04/B20: origen del movimiento. El índice único parcial es por
          // (tienda, source_type, source_id, tipo): una fila `sale` por método
          // exige un source_type distinto por método (el efectivo, el que
          // cuenta en el arqueo, queda como `dispatch_route`).
          source_type:
            method === 'cash'
              ? 'dispatch_route'
              : `dispatch_route_${method}`.slice(0, 40),
          source_id: input.route_id,
        } as Prisma.cash_register_movementsUncheckedCreateInput,
      });
      created.push({ id: movement.id, payment_method: method, amount, reference });
    }
    return created;
  }

  emitCashMovementRecorded(event: RecordedCashMovementEvent | null): void {
    if (event) this.eventEmitter.emit('cash_register.movement', event);
  }

  async emitPaymentReceived(
    input: PaymentReceivedInput,
    _options: { cashMovementHandled?: boolean } = {},
  ) {
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

    // D8: NO se registra `cash_register_movements` aquí. El recaudo en ruta se
    // asienta en caja al CERRAR la planilla (`recordRouteCloseMovements`), contra
    // la sesión que el usuario elige. `options.cashMovementHandled` se conserva
    // por compatibilidad de firma y ya no tiene efecto.

    // Credit-sale orders (payment_form '2') are booked by the
    // `installment_payment.received` that the order-flow bridge emits (DR Caja /
    // CR CxC). Flag the event so the accounting listener skips its "venta
    // directa" entry. COD payloads stay byte-identical (no extra key).
    let isCreditOrderCollection = false;
    let accountingOrderId: number | null = null;
    if (input.dispatch_note_id) {
      try {
        const note = await this.prisma.dispatch_notes.findFirst({
          where: { id: input.dispatch_note_id, store_id: input.store_id },
          select: { order: { select: { id: true, payment_form: true } } },
        });
        isCreditOrderCollection = note?.order?.payment_form === '2';
        // Real orders.id for the accounting listener (invoice-branch lookup).
        // `order_id` stays null on the event on purpose.
        if (!isCreditOrderCollection && note?.order?.id) {
          accountingOrderId = note.order.id;
        }
      } catch (error) {
        // Never break the already-committed settlement: fall back to the
        // legacy (unflagged) payload.
        this.logger.warn(
          `[emitPaymentReceived] could not resolve order payment_form for note #${input.dispatch_note_id}: ${(error as Error).message}`,
        );
      }
    }

    // Emit payment.received so existing listeners create auto-entries, AR, notifications
    // NOTE: `order_id` is intentionally null for dispatch_route. The legacy
    // sales_orders id is carried separately as `sales_order_id` to avoid being
    // mistaken for the COD `orders.id`. The COD payment bridge
    // (PaymentFromDispatchRouteListener) resolves the real orders.id from
    // dispatch_notes.order_id via `dispatch_note_id`, never from this field.
    const withholdingLines = input.withholding_breakdown
      ? Object.entries(input.withholding_breakdown)
          .filter(([_, v]) => Number(v) > 0)
          .map(([code, amount]) => ({
            code,
            amount: Number(amount),
            // Shape expected by the accounting `resolveWithholdingLines`
            // (the route only knows the tax type and the amount).
            withholding_type: code,
            concept_code: code,
            rate: 0,
            base: 0,
            role: 'suffered' as const,
            account_role: `withholding.suffered.${code}_receivable`,
          }))
      : [];
    const withholdingTotal = withholdingLines.reduce(
      (sum, l) => sum + l.amount,
      0,
    );

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
      // With withholding the sale value is cash + retention; without it the
      // payload stays byte-identical to the legacy one.
      subtotal_amount:
        withholdingTotal > 0
          ? Math.round((input.amount + withholdingTotal) * 100) / 100
          : input.amount,
      tax_amount: 0,
      tax_breakdown: [],
      withholding_breakdown: withholdingLines,
      discount_amount: 0,
      currency: 'COP',
      payment_method: input.payment_method,
      user_id: input.user_id,
      ...(isCreditOrderCollection ? { credit_order_collection: true } : {}),
      ...(accountingOrderId != null
        ? { accounting_order_id: accountingOrderId }
        : {}),
    });
  }

  // NOTA: `emitCreditSale` fue eliminado. En ruta DSD no hay venta a crédito:
  // una parada se entrega solo con pago total (o es prepaga), y si el cliente no
  // paga la parada se marca `rejected`. Por eso la liquidación nunca genera
  // `accounts_receivable` ni emite `credit_sale.created`. El gate de negocio
  // vive en `RouteFlowService.settleStop` (DISPATCH_ROUTE_PARTIAL_DISABLED).

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

  private async findOpenCashSession(store_id: number, opened_by: number, db: any = this.prisma) {
    return db.cash_register_sessions.findFirst({
      where: {
        store_id,
        status: 'open',
        opened_by,
      },
      orderBy: { opened_at: 'desc' },
    });
  }
}
