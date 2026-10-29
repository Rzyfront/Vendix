import { HttpException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { SettingsService } from '../../../settings/settings.service';
import { PaymentLinksService } from '../../../payment-links/payment-links.service';
import { depositRequired } from '../../rates/lodging-cancellation-penalty';
import { CollectDepositDto, DepositLinkDto } from './deposits.dto';
import { depositTotals, settleDeposit } from './lodging-deposit-math';

/** Payment methods the desk registers by hand (same set as the folio). */
const MANUAL_METHODS = new Set(['cash', 'bank_transfer', 'card']);

/** A deposit is taken before check-in; afterwards the guest pays the folio (D3). */
const COLLECTABLE_STATUSES = new Set(['tentative', 'confirmed']);

const SETTLED_STATUSES = new Set(['cancelled', 'no_show']);

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  bank_transfer: 'Transferencia',
  wompi_link: 'Link Wompi',
};

type Tx = Prisma.TransactionClient;

/** Payload of `lodging.deposit.received` (booked DR cash/bank, CR 2805). */
export interface DepositReceivedEvent {
  store_id: number;
  deposit_id: number;
  reservation_number: string;
  amount: number;
  payment_method_type: string;
  customer_id: number;
  user_id: number | null;
}

/** Payload of `lodging.deposit.retained` (booked DR 2805, CR penalty income). */
export interface DepositRetainedEvent {
  store_id: number;
  deposit_id: number;
  reservation_number: string;
  amount: number;
  customer_id: number;
  user_id: number | null;
}

/**
 * Payload of `lodging.reservation_payment.retained` (H6.6): part of an online
 * reservation payment kept as a penalty, booked DR 2805 / CR penalty income.
 */
export interface OnlinePaymentRetainedEvent {
  store_id: number;
  reservation_payment_id: number;
  reservation_number: string;
  amount: number;
  customer_id: number;
  user_id: number | null;
}

/** H6.6 — outcome of a cancelled / no-show reservation paid online. */
export interface OnlinePaymentSettlement {
  retained: OnlinePaymentRetainedEvent[];
  /** Kept as penalty, in total. */
  retained_total: number;
  /** Still owed back to the guest ("por devolver"). */
  owed: number;
}

const money = (value: Prisma.Decimal) => Number(value.toFixed(2));

/**
 * Hospitality Suite (H3.5) — deposits of a reservation (owner decision D3).
 *
 * A deposit is a customer ADVANCE, never a folio payment: it credits the
 * holder's wallet with a `lodging_deposits` ledger row, and is booked
 * DR cash/bank / CR 2805 (`lodging.deposit.received`), not as revenue. It is
 * taken before check-in at the desk (cash, card, transfer) or with a Wompi
 * payment link that credits the wallet when Wompi confirms it.
 *
 * Afterwards the deposit is either applied to the folio ("Anticipo aplicado",
 * `LodgingFolioService.applyDeposit`) or, on a cancellation or no-show with a
 * penalty, retained up to the penalty (`retainInTx`), booked DR 2805 / CR
 * penalty income. What the penalty leaves over stays in the wallet, owed back
 * to the guest ("por devolver").
 */
@Injectable()
export class LodgingDepositsService {
  private readonly logger = new Logger(LodgingDepositsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly wallets: WalletService,
    private readonly walletBalance: WalletBalanceService,
    private readonly cashSessions: SessionsService,
    private readonly settings: SettingsService,
    private readonly paymentLinks: PaymentLinksService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  // ------------------------------------------------------------------ read

  /** "Depósito requerido 30 % · $225.000", what was received and its movements. */
  async summary(reservation_id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservation_id },
      select: {
        id: true,
        reservation_number: true,
        status: true,
        cancellation_penalty_amount: true,
        cancellation_penalty_detail: true,
        rooms: { select: { deposit_percent: true, total_amount: true, cancelled_at: true } },
      },
    });
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    const rows = await this.prisma.lodging_deposits.findMany({
      where: { reservation_id },
      select: {
        id: true,
        kind: true,
        status: true,
        amount: true,
        method: true,
        created_at: true,
        payment_link: { select: { checkout_url: true } },
      },
      orderBy: { id: 'asc' },
    });
    const totals = depositTotals(rows);
    const required = depositRequired(
      reservation.rooms
        .filter((room) => !room.cancelled_at)
        .map((room) => ({
          deposit_percent: new Prisma.Decimal(room.deposit_percent ?? 0),
          total: new Prisma.Decimal(room.total_amount),
        })),
    );
    const pending = new Prisma.Decimal(required.amount).sub(totals.received);

    let settlement: null | Record<string, number | string | null> = null;
    if (SETTLED_STATUSES.has(reservation.status)) {
      const penalty = new Prisma.Decimal(reservation.cancellation_penalty_amount ?? 0);
      if (penalty.gt(0) || totals.received.gt(0)) {
        const collect = penalty.sub(totals.retained);
        settlement = {
          penalty: money(penalty),
          penalty_detail: reservation.cancellation_penalty_detail,
          retained: money(totals.retained),
          to_collect: money(collect.isNegative() ? new Prisma.Decimal(0) : collect),
          to_refund: money(totals.balance),
        };
      }
    }

    return {
      reservation_id: reservation.id,
      reservation_number: reservation.reservation_number,
      required,
      received: money(totals.received),
      applied: money(totals.applied),
      retained: money(totals.retained),
      balance: money(totals.balance),
      pending: pending.gt(0) ? money(pending) : 0,
      can_collect: COLLECTABLE_STATUSES.has(reservation.status),
      movements: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        amount: Number(row.amount),
        method: row.method,
        method_label:
          row.kind === 'applied'
            ? 'Aplicado a la cuenta'
            : row.kind === 'retained'
              ? 'Retenido por penalidad'
              : (METHOD_LABELS[row.method ?? ''] ?? 'Depósito'),
        checkout_url: row.payment_link?.checkout_url ?? null,
        created_at: row.created_at,
      })),
      settlement,
    };
  }

  /**
   * H2.4 quote + H3.5: how a penalty would be covered by the deposit held,
   * so the cancel dialog says "retenido $225.000 · por cobrar $25.000".
   */
  async quoteSettlement(reservation_id: number, penalty: Prisma.Decimal | null) {
    const rows = await this.prisma.lodging_deposits.findMany({
      where: { reservation_id },
      select: { kind: true, status: true, amount: true },
    });
    const { balance } = depositTotals(rows);
    // Same cap as `retainInTx`: only what the wallet still has free is kept.
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservation_id },
      select: { customer_id: true },
    });
    const wallet = reservation
      ? await this.prisma.wallets.findFirst({
          where: { customer_id: reservation.customer_id },
          select: { balance: true, held_balance: true },
        })
      : null;
    const available = wallet
      ? new Prisma.Decimal(wallet.balance).sub(new Prisma.Decimal(wallet.held_balance))
      : new Prisma.Decimal(0);
    const settlement = settleDeposit(penalty, balance, available);
    return {
      deposit_balance: balance.toFixed(2),
      deposit_retained: settlement.retained.toFixed(2),
      to_collect: settlement.to_collect.toFixed(2),
      to_refund: settlement.to_refund.toFixed(2),
    };
  }

  // -------------------------------------------------------------- receive

  /** "Cobrar depósito" at the desk: cash, card or transfer into the wallet. */
  async collect(reservation_id: number, dto: CollectDepositDto) {
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    if (!user_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    // Double click: the first request already registered this deposit.
    const existing = await this.prisma.lodging_deposits.findFirst({
      where: { request_id: dto.request_id },
      select: { reservation_id: true },
    });
    if (existing) {
      if (existing.reservation_id !== reservation_id) {
        throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'Solicitud de depósito repetida');
      }
      return this.summary(reservation_id);
    }

    const reservation = await this.loadCollectable(reservation_id);
    const method = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id, state: 'enabled' },
      select: { id: true, system_payment_method: { select: { type: true } } },
    });
    const methodType = method?.system_payment_method?.type ?? null;
    if (!method || !methodType || !MANUAL_METHODS.has(methodType)) {
      throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'Elige efectivo, tarjeta o transferencia');
    }
    // Same cash gate as every sale: with the register on, the cashier needs
    // an open session before taking money.
    await this.cashSessions.assertSessionForSales(user_id);
    const cashSessionId = methodType === 'cash' ? await this.cashSessionId(user_id) : null;
    const wallet = await this.wallets.getOrCreateWallet(reservation.customer_id);

    const emitted = await this.prisma.$transaction(
      async (tx) => {
        await this.lockReservation(tx, reservation_id, store_id);
        const duplicate = await tx.lodging_deposits.findFirst({
          where: { store_id, request_id: dto.request_id },
          select: { id: true },
        });
        if (duplicate) return null;
        const amount = await this.assertAmount(tx, reservation_id, reservation.total_amount, dto.amount);
        const deposit = await this.receiveInTx(tx, {
          store_id,
          reservation_id,
          reservation_number: reservation.reservation_number,
          wallet_id: wallet.id,
          amount,
          method: methodType,
          store_payment_method_id: method.id,
          payment_link_id: null,
          request_id: dto.request_id,
          user_id,
        });
        if (cashSessionId) {
          // A deposit has no order yet: it enters the register as a cash_in
          // (not a sale), and its accounting is the deposit's own entry.
          await tx.cash_register_movements.create({
            data: {
              session_id: cashSessionId,
              store_id,
              user_id,
              type: 'cash_in',
              amount,
              payment_method: 'cash',
              reference: `Depósito reserva ${reservation.reservation_number}`,
              notes: 'Depósito de reserva (anticipo)',
            },
          });
        }
        return {
          store_id,
          deposit_id: deposit.id,
          reservation_number: reservation.reservation_number,
          amount: Number(amount),
          payment_method_type: methodType,
          customer_id: reservation.customer_id,
          user_id,
        } satisfies DepositReceivedEvent;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    // After commit, so the accounting listener reads the committed deposit.
    if (emitted) this.eventEmitter.emit('lodging.deposit.received', emitted);
    return this.summary(reservation_id);
  }

  /**
   * "Cobrar depósito" → "Link Wompi": a single-use link for the amount; the
   * deposit stays pending and is credited when Wompi confirms the payment.
   */
  async createLink(reservation_id: number, dto: DepositLinkDto) {
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;
    const reservation = await this.loadCollectable(reservation_id);

    // The pending row is created first, under the reservation lock, so it
    // counts against the cap: two clicks or two desks cannot both pass it.
    const pending = await this.prisma.$transaction(
      async (tx) => {
        await this.lockReservation(tx, reservation_id, store_id);
        if (dto.request_id) {
          const duplicate = await tx.lodging_deposits.findFirst({
            where: { store_id, request_id: dto.request_id },
            select: { id: true },
          });
          if (duplicate) return null;
        }
        const amount = await this.assertAmount(tx, reservation_id, reservation.total_amount, dto.amount);
        return tx.lodging_deposits.create({
          data: {
            store_id,
            reservation_id,
            kind: 'received',
            status: 'pending',
            amount,
            method: 'wompi_link',
            request_id: dto.request_id ?? null,
            created_by_user_id: user_id,
          },
          select: { id: true, amount: true },
        });
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    if (!pending) return this.summary(reservation_id);

    let link: { id: number } | undefined;
    let failure: string | null = null;
    try {
      const created = await this.paymentLinks.create({
        name: `Depósito reserva ${reservation.reservation_number}`,
        description: `Depósito de la reserva ${reservation.reservation_number}`,
        single_use: true,
        collect_shipping: false,
        amount_in_cents: Math.round(Number(pending.amount) * 100),
        currency: 'COP',
      });
      link = created.data;
      if (!link?.id) failure = 'No se pudo crear el link de pago';
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        await this.cancelPendingRow(pending.id);
        throw err;
      }
      // Gateway errors (bad keys, Wompi down) reach the desk as a message, not a 500.
      failure = `Wompi no creó el link: ${err instanceof Error ? err.message : 'error desconocido'}`;
    }
    if (failure || !link?.id) {
      await this.cancelPendingRow(pending.id);
      throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, failure ?? 'No se pudo crear el link de pago');
    }
    await this.prisma.lodging_deposits.update({
      where: { id: pending.id },
      data: { payment_link_id: link.id, updated_at: new Date() },
    });
    return this.summary(reservation_id);
  }

  /** A link that was never created frees its share of the cap. */
  private async cancelPendingRow(id: number): Promise<void> {
    await this.prisma.lodging_deposits.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'cancelled', updated_at: new Date() },
    });
  }

  /**
   * Cancellation or no-show: the pending Wompi links of the reservation stop
   * counting and cannot be credited anymore. Returns their link ids so the
   * caller deactivates them after commit (`deactivateLinks`).
   */
  async cancelPendingLinksInTx(tx: Tx, reservation_id: number): Promise<number[]> {
    const rows = await tx.lodging_deposits.findMany({
      where: { reservation_id, kind: 'received', status: 'pending' },
      select: { id: true, payment_link_id: true },
    });
    if (rows.length === 0) return [];
    await tx.lodging_deposits.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, status: 'pending' },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    return rows.map((row) => row.payment_link_id).filter((id): id is number => id != null);
  }

  /** Best effort: a link that cannot be deactivated is only logged. */
  async deactivateLinks(link_ids: readonly number[]): Promise<void> {
    for (const id of link_ids) {
      try {
        await this.paymentLinks.deactivate(id);
      } catch (err: unknown) {
        this.logger.warn(`Payment link ${id} not deactivated: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /** Wompi confirmed a payment link: credit the pending deposit it collects. */
  @OnEvent('payment_link.paid')
  async onPaymentLinkPaid(event: { payment_link_id: number; store_id: number }) {
    try {
      await this.storeContextRunner.runInStoreContext(event.store_id, () =>
        this.completeLinkDeposit(event.payment_link_id),
      );
    } catch (err: unknown) {
      this.logger.error(
        `Deposit for payment link ${event.payment_link_id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Idempotent: a repeated webhook finds the deposit already completed. */
  async completeLinkDeposit(payment_link_id: number): Promise<boolean> {
    const store_id = this.requireStoreId();
    const pending = await this.prisma.lodging_deposits.findFirst({
      where: { payment_link_id, kind: 'received', status: 'pending' },
      select: {
        id: true,
        amount: true,
        reservation: { select: { id: true, reservation_number: true, customer_id: true } },
      },
    });
    if (!pending) {
      const cancelled = await this.prisma.lodging_deposits.findFirst({
        where: { payment_link_id, kind: 'received', status: 'cancelled' },
        select: { id: true, reservation_id: true },
      });
      if (cancelled) {
        // Paid after the reservation was cancelled: not credited, refund by hand.
        this.logger.error(
          `Payment link ${payment_link_id} paid after deposit ${cancelled.id} was cancelled (reservation ${cancelled.reservation_id}): refund it manually`,
        );
      }
      return false;
    }
    const wallet = await this.wallets.getOrCreateWallet(pending.reservation.customer_id);

    const emitted = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.lodging_deposits.updateMany({
          where: { id: pending.id, status: 'pending' },
          data: { status: 'completed', updated_at: new Date() },
        });
        if (claimed.count !== 1) return null;
        const credit = await this.walletBalance.creditInTransaction(
          tx,
          wallet.id,
          Number(pending.amount),
          {
            reference_type: 'lodging_deposit',
            reference_id: pending.reservation.id,
            description: `Depósito reserva ${pending.reservation.reservation_number} (link Wompi)`,
          },
        );
        await tx.lodging_deposits.update({
          where: { id: pending.id },
          data: { wallet_transaction_id: credit.transaction.id },
        });
        return {
          store_id,
          deposit_id: pending.id,
          reservation_number: pending.reservation.reservation_number,
          amount: Number(pending.amount),
          payment_method_type: 'wompi',
          customer_id: pending.reservation.customer_id,
          user_id: null,
        } satisfies DepositReceivedEvent;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    if (!emitted) return false;
    this.eventEmitter.emit('lodging.deposit.received', emitted);
    this.logger.log(`Deposit ${pending.id} credited from payment link ${payment_link_id}`);
    return true;
  }

  // --------------------------------------------------------------- retain

  /**
   * Cancellation or no-show with a penalty: keeps from the deposit held up to
   * the penalty, inside the status change transaction. Returns the event to
   * announce after commit, or null when nothing was retained.
   */
  async retainInTx(
    tx: Tx,
    input: {
      store_id: number;
      reservation_id: number;
      reservation_number: string;
      customer_id: number;
      penalty: Prisma.Decimal | null;
      user_id: number | null;
    },
  ): Promise<DepositRetainedEvent | null> {
    if (!input.penalty || input.penalty.lte(0)) return null;
    const rows = await tx.lodging_deposits.findMany({
      where: { store_id: input.store_id, reservation_id: input.reservation_id },
      select: { kind: true, status: true, amount: true },
    });
    const { balance } = depositTotals(rows);
    if (balance.lte(0)) return null;
    const wallet = await tx.wallets.findFirst({
      where: { store_id: input.store_id, customer_id: input.customer_id },
      select: { id: true, balance: true, held_balance: true },
    });
    if (!wallet) return null;
    const available = new Prisma.Decimal(wallet.balance).sub(new Prisma.Decimal(wallet.held_balance));
    const { retained } = settleDeposit(input.penalty, balance, available);
    if (retained.lte(0)) return null;

    const debit = await this.walletBalance.debitInTransaction(tx, wallet.id, Number(retained), {
      reference_type: 'lodging_deposit',
      reference_id: input.reservation_id,
      description: `Penalidad reserva ${input.reservation_number} (depósito retenido)`,
      created_by: input.user_id ?? undefined,
      expected_store_id: input.store_id,
      expected_customer_id: input.customer_id,
    });
    const deposit = await tx.lodging_deposits.create({
      data: {
        store_id: input.store_id,
        reservation_id: input.reservation_id,
        kind: 'retained',
        status: 'completed',
        amount: retained,
        wallet_transaction_id: debit.transaction.id,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
    return {
      store_id: input.store_id,
      deposit_id: deposit.id,
      reservation_number: input.reservation_number,
      amount: Number(retained),
      customer_id: input.customer_id,
      user_id: input.user_id,
    };
  }

  /** After the status change commits, so accounting reads the committed row. */
  announceRetained(event: DepositRetainedEvent | null): void {
    if (event) this.eventEmitter.emit('lodging.deposit.retained', event);
  }

  // ------------------------------------------------ online payment (H6.6)

  /**
   * H6.6 — a reservation paid online is cancelled or marked no-show. The web
   * payment is a direct payment, never a deposit (D3): no wallet. Its open
   * part (not applied to a folio nor kept yet) covers what the deposit left
   * of `penalty`, booked DR 2805 / CR penalty income after commit
   * (`announceOnlineRetained`); the rest is owed back to the guest.
   */
  async settleOnlinePaymentsInTx(
    tx: Tx,
    input: {
      store_id: number;
      reservation_id: number;
      reservation_number: string;
      customer_id: number;
      penalty: Prisma.Decimal;
      user_id: number | null;
    },
  ): Promise<OnlinePaymentSettlement> {
    const rows = await tx.lodging_reservation_payments.findMany({
      where: { store_id: input.store_id, reservation_id: input.reservation_id, status: 'completed' },
      select: { id: true, amount: true, applied_amount: true, retained_amount: true },
      orderBy: { id: 'asc' },
    });
    let left = input.penalty.gt(0) ? input.penalty : new Prisma.Decimal(0);
    let kept = new Prisma.Decimal(0);
    let owed = new Prisma.Decimal(0);
    const retained: OnlinePaymentRetainedEvent[] = [];
    const now = new Date();
    for (const row of rows) {
      const open = new Prisma.Decimal(row.amount).sub(row.applied_amount).sub(row.retained_amount);
      if (open.lte(0)) continue;
      const keep = Prisma.Decimal.min(open, left);
      if (keep.gt(0)) {
        await tx.lodging_reservation_payments.update({
          where: { id: row.id },
          data: { retained_amount: { increment: keep }, updated_at: now },
        });
        retained.push({
          store_id: input.store_id,
          reservation_payment_id: row.id,
          reservation_number: input.reservation_number,
          amount: money(keep),
          customer_id: input.customer_id,
          user_id: input.user_id,
        });
        left = left.sub(keep);
        kept = kept.add(keep);
      }
      owed = owed.add(open.sub(keep));
    }
    return { retained, retained_total: money(kept), owed: money(owed) };
  }

  /** After the status change commits, so accounting reads the committed row. */
  announceOnlineRetained(events: OnlinePaymentRetainedEvent[]): void {
    for (const event of events) this.eventEmitter.emit('lodging.reservation_payment.retained', event);
  }

  // -------------------------------------------------------------- helpers

  /** One `received` row and its wallet credit, in the caller's transaction. */
  private async receiveInTx(
    tx: Tx,
    input: {
      store_id: number;
      reservation_id: number;
      reservation_number: string;
      wallet_id: number;
      amount: Prisma.Decimal;
      method: string;
      store_payment_method_id: number | null;
      payment_link_id: number | null;
      request_id: string | null;
      user_id: number | null;
    },
  ) {
    const credit = await this.walletBalance.creditInTransaction(tx, input.wallet_id, Number(input.amount), {
      reference_type: 'lodging_deposit',
      reference_id: input.reservation_id,
      description: `Depósito reserva ${input.reservation_number} (${METHOD_LABELS[input.method] ?? input.method})`,
      created_by: input.user_id ?? undefined,
    });
    return tx.lodging_deposits.create({
      data: {
        store_id: input.store_id,
        reservation_id: input.reservation_id,
        kind: 'received',
        status: 'completed',
        amount: input.amount,
        method: input.method,
        store_payment_method_id: input.store_payment_method_id,
        payment_link_id: input.payment_link_id,
        wallet_transaction_id: credit.transaction.id,
        request_id: input.request_id,
        created_by_user_id: input.user_id,
      },
      select: { id: true },
    });
  }

  private async loadCollectable(reservation_id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservation_id },
      select: { id: true, reservation_number: true, status: true, customer_id: true, total_amount: true },
    });
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    if (!COLLECTABLE_STATUSES.has(reservation.status)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_DEPOSIT_001,
        reservation.status === 'checked_in'
          ? 'El huésped ya está en casa: registra un pago del folio'
          : 'La reserva ya no admite depósitos',
      );
    }
    return reservation;
  }

  /** Positive, in cents, and never above what the stay still lacks. */
  private async assertAmount(
    client: Pick<Tx, 'lodging_deposits'>,
    reservation_id: number,
    total_amount: Prisma.Decimal,
    raw: number,
  ): Promise<Prisma.Decimal> {
    const amount = new Prisma.Decimal(raw).toDecimalPlaces(2);
    if (amount.lte(0)) {
      throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'El depósito debe ser mayor a cero');
    }
    const rows = await client.lodging_deposits.findMany({
      where: { reservation_id },
      select: { kind: true, status: true, amount: true },
    });
    // A pending Wompi link is not money yet, but it reserves its share of the cap.
    const pendingLinks = rows
      .filter((row) => row.kind === 'received' && row.status === 'pending')
      .reduce((sum, row) => sum.add(new Prisma.Decimal(row.amount)), new Prisma.Decimal(0));
    const room = new Prisma.Decimal(total_amount).sub(depositTotals(rows).received).sub(pendingLinks);
    if (amount.gt(room)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_DEPOSIT_001,
        `El depósito supera el total de la reserva (máximo ${room.toFixed(2)})`,
      );
    }
    return amount;
  }

  private async lockReservation(tx: Tx, reservation_id: number, store_id: number) {
    const locked: Array<{ id: number }> = await tx.$queryRaw`
      SELECT id FROM lodging_reservations WHERE id = ${reservation_id} AND store_id = ${store_id} FOR UPDATE
    `;
    if (!locked.length) throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
  }

  /** Open register session of the cashier when the store uses the register. */
  private async cashSessionId(user_id: number): Promise<number | null> {
    const settings = await this.settings.getSettings();
    if (!(settings as { pos?: { cash_register?: { enabled?: boolean } } })?.pos?.cash_register?.enabled) {
      return null;
    }
    const session = await this.cashSessions.getActiveSession(user_id);
    if (!session) throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);
    return session.id;
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}
