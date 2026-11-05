import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { WalletBalanceService } from '../wallet/services/wallet-balance.service';
import { MovementsService } from '../cash-registers/movements/movements.service';
import { OrderHistoryService } from '../orders/order-history/order-history.service';
import { resolvePaymentReceivedSaleFields } from '../payments/utils/payment-sale-share.util';
import { getSettledOrderAmount } from '../payments/services/payment-validator.service';
import type {
  PaymentReceivedEventOrder,
  PaymentReceivedEventPaymentInput,
} from '../payments/utils/payment-received-event.util';
import {
  applicableCents,
  centsToAmount,
  depositBalance,
  toCents,
  ServiceDepositRow,
  ServiceDepositTotals,
} from './utils/service-deposit-math';

type Tx = Prisma.TransactionClient;

/** Payload of `service_deposit.received` (booked DR cash/bank, CR 2805). */
export interface ServiceDepositReceivedEvent {
  store_id: number;
  organization_id?: number;
  deposit_id: number;
  amount: number;
  payment_method_type: string;
  customer_id: number;
  booking_id: number | null;
  session_id: number | null;
  user_id: number | null;
}

/** Payload of `service_deposit.refunded` (booked DR 2805, CR cash/bank). */
export type ServiceDepositRefundedEvent = ServiceDepositReceivedEvent;

/**
 * What the caller needs to emit `payment.received` after commit, through
 * `buildPaymentReceivedEvents` (`accounting_method: 'wallet'` books DR 2805).
 */
export interface ServiceDepositPaymentReceived {
  payment_id: number;
  amount: number;
  currency: string;
  accounting_method: 'wallet';
  order: PaymentReceivedEventOrder;
  payment: PaymentReceivedEventPaymentInput;
}

export interface ReceiveDepositInput {
  store_id: number;
  customer_id: number | null | undefined;
  booking_id?: number | null;
  session_id?: number | null;
  amount: number;
  /** Canonical method type: cash, bank_transfer, card, wompi... */
  method: string;
  store_payment_method_id?: number | null;
  request_id: string;
  user_id: number | null;
}

export interface CreatePendingDepositInput {
  store_id: number;
  customer_id: number | null | undefined;
  booking_id?: number | null;
  session_id?: number | null;
  amount: number;
  method: string;
  store_payment_method_id?: number | null;
  payment_request_id: number;
  request_id: string;
  user_id: number | null;
}

export type CompletePendingReason = 'not_found' | 'already_completed' | 'cancelled';

export interface ApplyDepositInput {
  store_id: number;
  order_id: number;
  booking_id?: number | null;
  session_id?: number | null;
  user_id: number | null;
  /** Throw instead of returning `applied: false` when nothing can be applied. */
  strict?: boolean;
}

export interface MoveDepositInput {
  store_id: number;
  customer_id: number;
  booking_id?: number | null;
  session_id?: number | null;
  /** Defaults to the whole balance. */
  amount?: number;
  request_id: string;
  user_id: number | null;
}

export interface RefundDepositInput extends MoveDepositInput {
  /** How the money leaves: cash, bank_transfer, card... */
  method: string;
  store_payment_method_id?: number | null;
}

export interface DepositBalance {
  received: number;
  applied: number;
  refunded: number;
  released: number;
  balance: number;
}

const toBalance = (totals: ServiceDepositTotals): DepositBalance => ({
  received: centsToAmount(totals.received_cents),
  applied: centsToAmount(totals.applied_cents),
  refunded: centsToAmount(totals.refunded_cents),
  released: centsToAmount(totals.released_cents),
  balance: centsToAmount(totals.balance_cents),
});

/**
 * Consumable deposit of a station (cavas, canchas, fincas de día): a ledger
 * (`service_deposits`) tied to a booking or a station session. The money lives
 * in the customer's wallet (PUC 2805, customer advances); the ledger says how
 * much of it belongs to the deposit. Every `*InTx` method runs inside the
 * caller's transaction and returns the event to announce AFTER commit.
 *
 * Modeled on the lodging deposits (`LodgingDepositsService`) and the folio
 * `applyDeposit`.
 */
@Injectable()
export class ServiceDepositsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly wallets: WalletService,
    private readonly walletBalance: WalletBalanceService,
    private readonly movements: MovementsService,
    private readonly orderHistory: OrderHistoryService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------ read

  /** Ledger balance of a booking and/or session (completed rows only). */
  async balanceOf(target: { bookingId?: number | null; sessionId?: number | null }): Promise<DepositBalance> {
    const store_id = this.requireStoreId();
    return this.balanceOfIn(this.prisma, store_id, target);
  }

  /** Same as `balanceOf`, inside the caller's transaction. */
  async balanceOfInTx(
    tx: Tx,
    target: { bookingId?: number | null; sessionId?: number | null; store_id: number },
  ): Promise<DepositBalance> {
    return this.balanceOfIn(tx, target.store_id, target);
  }

  /** The deposits of a booking now belong to its session too (arrival). */
  async linkBookingToSessionInTx(tx: Tx, bookingId: number, sessionId: number, store_id?: number): Promise<number> {
    const store = store_id ?? this.requireStoreId();
    const result = await tx.service_deposits.updateMany({
      where: { store_id: store, booking_id: bookingId, session_id: null },
      data: { session_id: sessionId, updated_at: new Date() },
    });
    return result.count;
  }

  // --------------------------------------------------------------- receive

  /**
   * An idempotency key belongs to ONE booking (or session). A retry of the same
   * target passes; a key already used by another target is a stale form and is
   * rejected before any money or payment request is created (M-2a).
   */
  async assertRequestFreeInTx(
    tx: Tx,
    input: { store_id: number; request_id: string; booking_id?: number | null; session_id?: number | null },
  ): Promise<void> {
    const existing = await tx.service_deposits.findFirst({
      where: { store_id: input.store_id, request_id: input.request_id },
      select: { id: true, booking_id: true, session_id: true },
    });
    if (existing) this.assertSameTarget(existing, input);
  }

  private assertSameTarget(
    existing: { booking_id: number | null; session_id: number | null },
    input: { booking_id?: number | null; session_id?: number | null },
  ): void {
    const same =
      input.booking_id != null
        ? existing.booking_id === input.booking_id
        : input.session_id != null
          ? existing.session_id === input.session_id
          : true;
    if (!same) {
      throw new VendixHttpException(
        ErrorCodes.SERVICE_DEPOSIT_004,
        'Este anticipo ya quedó registrado en otra reserva. Vuelve a abrir el formulario para registrar uno nuevo.',
      );
    }
  }

  /** One completed `received` row and its wallet credit. Idempotent by `request_id`. */
  async receiveInTx(
    tx: Tx,
    input: ReceiveDepositInput,
  ): Promise<{ created: boolean; deposit: { id: number }; event: ServiceDepositReceivedEvent | null }> {
    const duplicate = await tx.service_deposits.findFirst({
      where: { store_id: input.store_id, request_id: input.request_id },
      select: { id: true, booking_id: true, session_id: true },
    });
    if (duplicate) {
      this.assertSameTarget(duplicate, input);
      return { created: false, deposit: { id: duplicate.id }, event: null };
    }

    const customer_id = this.assertCustomer(input.customer_id);
    this.assertTarget(input);
    const cents = this.assertAmount(input.amount);
    const amount = centsToAmount(cents);
    const wallet = await this.wallets.getOrCreateWallet(customer_id);

    const credit = await this.walletBalance.creditInTransaction(tx, wallet.id, amount, {
      reference_type: 'service_deposit',
      reference_id: input.booking_id ?? input.session_id ?? undefined,
      description: this.describe('Anticipo', input),
      created_by: input.user_id ?? undefined,
    });
    const deposit = await tx.service_deposits.create({
      data: {
        store_id: input.store_id,
        booking_id: input.booking_id ?? null,
        session_id: input.session_id ?? null,
        customer_id,
        kind: 'received',
        status: 'completed',
        amount,
        method: input.method,
        store_payment_method_id: input.store_payment_method_id ?? null,
        wallet_transaction_id: credit.transaction.id,
        request_id: input.request_id,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
    await this.recordCash(tx, 'in', input.user_id, {
      store_id: input.store_id,
      amount,
      method: input.method,
      deposit_id: deposit.id,
      reference: this.describe('Anticipo', input),
    });
    return {
      created: true,
      deposit,
      event: this.eventOf(input.store_id, deposit.id, amount, input.method, customer_id, input, input.user_id),
    };
  }

  /** A deposit waiting for a payment request (Wompi / transfer). Not money yet. */
  async createPendingInTx(
    tx: Tx,
    input: CreatePendingDepositInput,
  ): Promise<{ created: boolean; deposit: { id: number } }> {
    const duplicate = await tx.service_deposits.findFirst({
      where: { store_id: input.store_id, request_id: input.request_id },
      select: { id: true, booking_id: true, session_id: true },
    });
    if (duplicate) {
      this.assertSameTarget(duplicate, input);
      return { created: false, deposit: { id: duplicate.id } };
    }

    const customer_id = this.assertCustomer(input.customer_id);
    this.assertTarget(input);
    const amount = centsToAmount(this.assertAmount(input.amount));
    const deposit = await tx.service_deposits.create({
      data: {
        store_id: input.store_id,
        booking_id: input.booking_id ?? null,
        session_id: input.session_id ?? null,
        customer_id,
        kind: 'received',
        status: 'pending',
        amount,
        method: input.method,
        store_payment_method_id: input.store_payment_method_id ?? null,
        payment_request_id: input.payment_request_id,
        request_id: input.request_id,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
    return { created: true, deposit };
  }

  /**
   * Claim a pending deposit (idempotent `updateMany` pending -> completed) and
   * credit the wallet. A repeated webhook finds it already completed.
   */
  async completePendingInTx(
    tx: Tx,
    target: { deposit_id?: number; payment_request_id?: number; store_id?: number; user_id?: number | null },
  ): Promise<{ claimed: boolean; reason?: CompletePendingReason; event: ServiceDepositReceivedEvent | null }> {
    const store_id = target.store_id ?? this.requireStoreId();
    const where: Prisma.service_depositsWhereInput = { store_id, kind: 'received' };
    if (target.deposit_id != null) where.id = target.deposit_id;
    else if (target.payment_request_id != null) where.payment_request_id = target.payment_request_id;
    else throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_003);

    const row = await tx.service_deposits.findFirst({
      where,
      select: {
        id: true,
        status: true,
        amount: true,
        method: true,
        customer_id: true,
        booking_id: true,
        session_id: true,
      },
    });
    if (!row) return { claimed: false, reason: 'not_found', event: null };
    if (row.status === 'completed') return { claimed: false, reason: 'already_completed', event: null };
    if (row.status === 'cancelled') return { claimed: false, reason: 'cancelled', event: null };

    const claimed = await tx.service_deposits.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'completed', updated_at: new Date() },
    });
    if (claimed.count !== 1) return { claimed: false, reason: 'already_completed', event: null };

    const amount = Number(row.amount);
    const method = row.method ?? 'wompi';
    const wallet = await this.wallets.getOrCreateWallet(row.customer_id);
    const credit = await this.walletBalance.creditInTransaction(tx, wallet.id, amount, {
      reference_type: 'service_deposit',
      reference_id: row.booking_id ?? row.session_id ?? undefined,
      description: this.describe('Anticipo', row, ` (${method})`),
      created_by: target.user_id ?? undefined,
    });
    await tx.service_deposits.update({
      where: { id: row.id },
      data: { wallet_transaction_id: credit.transaction.id },
    });
    await this.recordCash(tx, 'in', target.user_id ?? null, {
      store_id,
      amount,
      method,
      deposit_id: row.id,
      reference: this.describe('Anticipo', row),
    });
    return {
      claimed: true,
      event: this.eventOf(store_id, row.id, amount, method, row.customer_id, row, target.user_id ?? null),
    };
  }

  // ----------------------------------------------------------------- apply

  /**
   * Apply the deposit to an order: amount = min(deposit balance, order
   * remaining, wallet available), in cents. A succeeded wallet payment, the
   * wallet debit, an `applied` row and the order paid totals, in one go. The
   * caller emits `payment.received` after commit (no accounting here: the
   * money already sits in 2805 and `payment.received` with the wallet method
   * drains it).
   */
  async applyToOrderInTx(
    tx: Tx,
    input: ApplyDepositInput,
  ): Promise<{
    applied: boolean;
    amount: number;
    payment_id: number | null;
    deposit_id: number | null;
    payment_received: ServiceDepositPaymentReceived | null;
  }> {
    this.assertTarget(input);
    const nothing = { applied: false, amount: 0, payment_id: null, deposit_id: null, payment_received: null };
    const locked: Array<{ id: number }> = await tx.$queryRaw`
      SELECT id FROM orders WHERE id = ${input.order_id} AND store_id = ${input.store_id} FOR UPDATE
    `;
    if (!locked.length) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_005);
    const order = await tx.orders.findUnique({
      where: { id: input.order_id },
      include: { payments: { select: { amount: true, state: true } } },
    });
    if (!order || order.store_id !== input.store_id) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_005);
    if (!order.customer_id) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_002);

    const held = await this.balanceOfIn(tx, input.store_id, input);
    const settledCents = toCents(getSettledOrderAmount(order));
    const remainingCents = toCents(order.grand_total) - settledCents;
    const wallet = await tx.wallets.findFirst({
      where: { store_id: input.store_id, customer_id: order.customer_id },
      select: { id: true, balance: true, held_balance: true },
    });
    const availableCents = wallet ? toCents(wallet.balance) - toCents(wallet.held_balance) : 0;
    const cents = applicableCents({
      balance_cents: toCents(held.balance),
      remaining_cents: remainingCents,
      available_cents: availableCents,
    });
    if (!wallet || cents <= 0) {
      if (!input.strict) return nothing;
      if (toCents(held.balance) <= 0) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_004);
      if (remainingCents <= 0) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_005);
      throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_006);
    }

    const amount = centsToAmount(cents);
    const now = new Date();
    const appliedCount = await tx.service_deposits.findMany({
      where: this.targetWhere(input.store_id, input, { kind: 'applied' }),
      select: { id: true },
    });
    const ref = input.session_id ?? input.booking_id;
    const currency = order.currency ?? 'COP';
    const payment = await tx.payments.create({
      data: {
        order_id: order.id,
        customer_id: order.customer_id,
        amount,
        currency,
        state: 'succeeded',
        paid_at: now,
        // `payments.transaction_id` is unique table-wide and booking/session ids come from separate sequences,
        // so a booking-only apply (no-show retain) gets its own prefix. Still deterministic per logical payment.
        transaction_id: `${input.session_id ? 'SVC' : 'RSV'}-${ref}-DEPOSIT-${appliedCount.length + 1}`,
        gateway_response: {
          service_deposit: {
            booking_id: input.booking_id ?? null,
            session_id: input.session_id ?? null,
            created_by_user_id: input.user_id,
            accounting: 'customer_advance',
            source: 'deposit',
          },
        },
        updated_at: now,
      },
    });
    const debit = await this.walletBalance.debitInTransaction(tx, wallet.id, amount, {
      reference_type: 'service_deposit',
      reference_id: ref ?? undefined,
      description: `Anticipo aplicado a la cuenta ${order.order_number}`,
      created_by: input.user_id ?? undefined,
      expected_store_id: input.store_id,
      expected_customer_id: order.customer_id,
    });
    const deposit = await tx.service_deposits.create({
      data: {
        store_id: input.store_id,
        booking_id: input.booking_id ?? null,
        session_id: input.session_id ?? null,
        customer_id: order.customer_id,
        kind: 'applied',
        status: 'completed',
        amount,
        wallet_transaction_id: debit.transaction.id,
        payment_id: payment.id,
        request_id: `apply:${payment.id}`,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
    await tx.orders.update({
      where: { id: order.id },
      data: {
        total_paid: { increment: amount },
        remaining_balance: new Prisma.Decimal(Math.max(0, remainingCents - cents)).div(100),
        updated_at: now,
      },
    });
    await this.orderHistory.record(tx, {
      orderId: order.id,
      storeId: input.store_id,
      type: 'payment_registered',
      paymentId: payment.id,
      amount,
    });

    // A partial application must carry ITS share of the sale: with the whole order totals the
    // entry (DR partial amount, CR full sale) never balances and is dropped silently (H-1).
    const sale_share = await resolvePaymentReceivedSaleFields(tx, {
      order_id: order.id,
      payment_id: payment.id,
      amount,
    });
    const paymentInput: PaymentReceivedEventPaymentInput = {
      id: payment.id,
      amount,
      currency,
      accounting_method: 'wallet',
      sale_share,
    };
    return {
      applied: true,
      amount,
      payment_id: payment.id,
      deposit_id: deposit.id,
      payment_received: {
        payment_id: payment.id,
        amount,
        currency,
        accounting_method: 'wallet',
        payment: paymentInput,
        order: {
          id: order.id,
          order_number: order.order_number,
          store_id: order.store_id,
          organization_id: RequestContextService.getContext()?.organization_id ?? null,
          customer_id: order.customer_id,
          subtotal_amount: order.subtotal_amount,
          tip_amount: order.tip_amount,
        },
      },
    };
  }

  // ---------------------------------------------------- refund and release

  /** Money back to the customer: wallet debit, `refunded` row, cash out when cash. */
  async refundInTx(
    tx: Tx,
    input: RefundDepositInput,
  ): Promise<{ created: boolean; deposit: { id: number } | null; amount: number; event: ServiceDepositRefundedEvent | null }> {
    const duplicate = await tx.service_deposits.findFirst({
      where: { store_id: input.store_id, request_id: input.request_id },
      select: { id: true, amount: true },
    });
    if (duplicate) return { created: false, deposit: { id: duplicate.id }, amount: Number(duplicate.amount), event: null };

    this.assertTarget(input);
    const held = await this.balanceOfIn(tx, input.store_id, input);
    const cents = this.movableCents(input, held);
    const wallet = await tx.wallets.findFirst({
      where: { store_id: input.store_id, customer_id: input.customer_id },
      select: { id: true, balance: true, held_balance: true },
    });
    const available = wallet ? toCents(wallet.balance) - toCents(wallet.held_balance) : 0;
    if (!wallet || available < cents) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_006);

    const amount = centsToAmount(cents);
    const debit = await this.walletBalance.debitInTransaction(tx, wallet.id, amount, {
      reference_type: 'service_deposit',
      reference_id: input.booking_id ?? input.session_id ?? undefined,
      description: this.describe('Devolución de anticipo', input),
      created_by: input.user_id ?? undefined,
      expected_store_id: input.store_id,
      expected_customer_id: input.customer_id,
    });
    const deposit = await tx.service_deposits.create({
      data: {
        store_id: input.store_id,
        booking_id: input.booking_id ?? null,
        session_id: input.session_id ?? null,
        customer_id: input.customer_id,
        kind: 'refunded',
        status: 'completed',
        amount,
        method: input.method,
        store_payment_method_id: input.store_payment_method_id ?? null,
        wallet_transaction_id: debit.transaction.id,
        request_id: input.request_id,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
    await this.recordCash(tx, 'out', input.user_id, {
      store_id: input.store_id,
      amount,
      method: input.method,
      deposit_id: deposit.id,
      reference: this.describe('Devolución de anticipo', input),
    });
    return {
      created: true,
      deposit,
      amount,
      event: this.eventOf(input.store_id, deposit.id, amount, input.method, input.customer_id, input, input.user_id),
    };
  }

  /**
   * The leftover stays as customer credit: a `released` row only. The money is
   * already wallet balance on 2805, so no entry and no event are due.
   */
  async releaseInTx(
    tx: Tx,
    input: MoveDepositInput,
  ): Promise<{ created: boolean; deposit: { id: number } | null; amount: number }> {
    const duplicate = await tx.service_deposits.findFirst({
      where: { store_id: input.store_id, request_id: input.request_id },
      select: { id: true, amount: true },
    });
    if (duplicate) return { created: false, deposit: { id: duplicate.id }, amount: Number(duplicate.amount) };

    this.assertTarget(input);
    const held = await this.balanceOfIn(tx, input.store_id, input);
    const amount = centsToAmount(this.movableCents(input, held));
    const deposit = await tx.service_deposits.create({
      data: {
        store_id: input.store_id,
        booking_id: input.booking_id ?? null,
        session_id: input.session_id ?? null,
        customer_id: input.customer_id,
        kind: 'released',
        status: 'completed',
        amount,
        request_id: input.request_id,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
    return { created: true, deposit, amount };
  }

  // ---------------------------------------------------------------- events

  /** After the transaction commits, so accounting reads the committed row. */
  announceReceived(event: ServiceDepositReceivedEvent | null | undefined): void {
    if (event) this.eventEmitter.emit('service_deposit.received', event);
  }

  announceRefunded(event: ServiceDepositRefundedEvent | null | undefined): void {
    if (event) this.eventEmitter.emit('service_deposit.refunded', event);
  }

  // --------------------------------------------------------------- helpers

  private async balanceOfIn(
    client: Pick<Tx, 'service_deposits'>,
    store_id: number,
    target: { bookingId?: number | null; sessionId?: number | null; booking_id?: number | null; session_id?: number | null },
  ): Promise<DepositBalance> {
    const booking_id = target.bookingId ?? target.booking_id ?? null;
    const session_id = target.sessionId ?? target.session_id ?? null;
    const either = [
      ...(booking_id != null ? [{ booking_id }] : []),
      ...(session_id != null ? [{ session_id }] : []),
    ];
    if (either.length === 0) return toBalance(depositBalance([]));
    const rows = await client.service_deposits.findMany({
      where: { store_id, OR: either },
      select: { kind: true, status: true, amount: true },
    });
    return toBalance(depositBalance(rows as ServiceDepositRow[]));
  }

  private targetWhere(
    store_id: number,
    target: { booking_id?: number | null; session_id?: number | null },
    extra: Prisma.service_depositsWhereInput = {},
  ): Prisma.service_depositsWhereInput {
    const either = [
      ...(target.booking_id != null ? [{ booking_id: target.booking_id }] : []),
      ...(target.session_id != null ? [{ session_id: target.session_id }] : []),
    ];
    return { store_id, OR: either, ...extra };
  }

  /** Requested amount (default: all) in cents, never above the deposit balance. */
  private movableCents(input: { amount?: number }, held: DepositBalance): number {
    const balance = toCents(held.balance);
    const cents = input.amount == null ? balance : this.assertAmount(input.amount);
    if (cents <= 0 || cents > balance) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_004);
    return cents;
  }

  private assertAmount(raw: number): number {
    const cents = toCents(raw);
    if (!(cents > 0)) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_001);
    return cents;
  }

  private assertCustomer(customer_id: number | null | undefined): number {
    if (!customer_id) throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_002);
    return customer_id;
  }

  private assertTarget(target: { booking_id?: number | null; session_id?: number | null }): void {
    if (target.booking_id == null && target.session_id == null) {
      throw new VendixHttpException(ErrorCodes.SERVICE_DEPOSIT_003, 'El anticipo necesita una reserva o una sesión');
    }
  }

  private describe(
    label: string,
    target: { booking_id?: number | null; session_id?: number | null },
    suffix = '',
  ): string {
    const where =
      target.session_id != null ? `sesión ${target.session_id}` : `reserva ${target.booking_id}`;
    return `${label} ${where}${suffix}`;
  }

  private eventOf(
    store_id: number,
    deposit_id: number,
    amount: number,
    method: string,
    customer_id: number,
    target: { booking_id?: number | null; session_id?: number | null },
    user_id: number | null,
  ): ServiceDepositReceivedEvent {
    return {
      store_id,
      deposit_id,
      amount,
      payment_method_type: method,
      customer_id,
      booking_id: target.booking_id ?? null,
      session_id: target.session_id ?? null,
      user_id,
    };
  }

  /**
   * Staff-recorded money (S14): any method that moves the user's cash flow (`shouldRecordCashMovement`) is
   * registered in the acting user's session, inside the tx. Without a staff user (Wompi webhook, customer
   * pages) nothing is recorded.
   */
  private async recordCash(
    tx: Tx,
    direction: 'in' | 'out',
    user_id: number | null,
    data: { store_id: number; amount: number; method: string; deposit_id: number; reference: string },
  ): Promise<void> {
    if (!user_id) return;
    await this.movements.recordModuleCashMovement(tx, {
      store_id: data.store_id,
      user_id,
      direction,
      amount: data.amount,
      payment_method: data.method,
      include_non_cash: true,
      source_type: 'service_deposit',
      source_id: data.deposit_id,
      reference: data.reference,
      notes: direction === 'in' ? 'Anticipo consumible' : 'Devolución de anticipo consumible',
    });
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}
