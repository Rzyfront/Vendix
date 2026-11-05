import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, booking_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ServiceDepositsService } from '../service-deposits/service-deposits.service';
import type { ServiceDepositPaymentReceived } from '../service-deposits/service-deposits.service';
import { toCents } from '../service-deposits/utils/service-deposit-math';
import { PaymentRequestsService } from '../payment-requests/payment-requests.service';
import type { PaymentRequestPaidEvent } from '../payment-requests/payment-requests.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { ShippingTaxService } from '../shipping/services/shipping-tax.service';
import { SettingsService } from '../settings/settings.service';
import { OrderFlowService } from '../orders/order-flow/order-flow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ServiceAllocationCoordinator } from './service-allocation-coordinator.service';
import { buildPaymentReceivedEvents } from '../payments/utils/payment-received-event.util';
import { buildOrderSaleTaxPayload } from '../payments/utils/order-sale-tax-payload.util';
import {
  buildSessionTaxedLine,
  writeSessionOrderTotals,
} from '../service-sessions/utils/session-order-lines.util';
import type { BookingDepositDto, DepositDecisionDto } from './dto';

type Tx = Prisma.TransactionClient;

/** Name of the fixed invoice line that keeps a retained deposit (D12, A2). */
export const RESERVATION_FEE_LINE_NAME = 'Gastos de reserva';
export const RESERVATION_FEE_LINE_KIND = 'reservation_fee';
const PAYMENT_REQUEST_PURPOSE = 'service_deposit';
/** Statuses that still allow a deposit decision. */
const DECIDABLE_STATUSES: string[] = ['pending', 'confirmed', 'arriving', 'attending'];

export interface BookingDepositBlock {
  required: number | null;
  received: number;
  balance: number;
  pending_request: {
    payment_request_id: number;
    amount: number;
    status: string;
    expires_at: Date | null;
  } | null;
  decision_due_at: Date | null;
}

/**
 * Deposit side of a station booking: taking it (desk or payment link), holding
 * the slot while it is unpaid, deciding what happens with it (retain, refund,
 * credit) and showing it on the booking detail. It never calls back into
 * `ReservationsService` (that one depends on this service).
 *
 * Nothing here charges or closes anything on its own (D4): every money movement
 * is an explicit action of the administrator.
 */
@Injectable()
export class ReservationDepositsService {
  private readonly logger = new Logger(ReservationDepositsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly deposits: ServiceDepositsService,
    private readonly paymentRequests: PaymentRequestsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly moduleRef: ModuleRef,
    private readonly allocationCoordinator: ServiceAllocationCoordinator,
  ) {}

  // ---------------------------------------------------------------- helpers

  /** Lazy lookup: these services live in modules that must not be imported here (DI cycles). */
  private lazy<T>(token: new (...args: never[]) => T): T | null {
    try {
      return this.moduleRef.get(token, { strict: false });
    } catch {
      return null;
    }
  }

  paymentPath(publicToken: string): string {
    return `/pagar/${publicToken}`;
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  /** The station that holds (or held) the booking and its deposit rules. */
  async stationRulesOfBooking(client: Pick<Tx, 'service_allocations'>, storeId: number, bookingId: number) {
    const allocation = await client.service_allocations.findFirst({
      where: { store_id: storeId, booking_id: bookingId },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        state: true,
        start_at: true,
        expires_at: true,
        station: {
          select: {
            id: true,
            deposit_policy: true,
            deposit_amount: true,
            hold_minutes: true,
            cancel_refund_hours: true,
            leftover_policy: true,
            reservation_fee_tax_category_id: true,
          },
        },
      },
    });
    return allocation ?? null;
  }

  /** Admin alert, best effort: a notification must never break the money flow. */
  private async alertAdmin(storeId: number, type: string, title: string, body: string, data: Record<string, unknown>) {
    try {
      const notifications = this.lazy(NotificationsService);
      await notifications?.createAndBroadcast(storeId, type, title, body, data);
    } catch (err: unknown) {
      this.logger.warn(`Admin alert not sent: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ------------------------------------------------------------ read model

  /** Announces the desk deposit received; call it after the booking transaction committed. */
  announceDeposit(started: { event: Parameters<ServiceDepositsService['announceReceived']>[0] } | null | undefined): void {
    if (started) this.deposits.announceReceived(started.event);
  }

  /** `deposit` block of the booking detail; null when the booking never had one. */
  async summary(bookingId: number, decisionDueAt: Date | null): Promise<BookingDepositBlock | null> {
    const store_id = this.requireStoreId();
    const [rows, allocation] = await Promise.all([
      this.prisma.service_deposits.findMany({
        where: { store_id, booking_id: bookingId, kind: 'received', status: 'pending' },
        select: { amount: true, payment_request_id: true },
      }),
      this.stationRulesOfBooking(this.prisma, store_id, bookingId),
    ]);
    const balance = await this.deposits.balanceOf({ bookingId });
    const policy = allocation?.station.deposit_policy ?? 'none';
    const pendingRow = rows.find((row) => row.payment_request_id != null) ?? null;
    if (policy === 'none' && balance.received === 0 && !pendingRow) return null;
    const request = pendingRow?.payment_request_id
      ? await this.prisma.payment_requests.findFirst({
          where: { id: pendingRow.payment_request_id },
          select: { id: true, status: true, expires_at: true },
        })
      : null;
    return {
      required:
        policy !== 'none' && allocation?.station.deposit_amount != null
          ? Number(allocation.station.deposit_amount)
          : null,
      received: balance.received,
      balance: balance.balance,
      pending_request:
        pendingRow && request
          ? {
              payment_request_id: request.id,
              amount: Number(pendingRow.amount),
              status: request.status,
              expires_at: request.expires_at,
            }
          : null,
      decision_due_at: decisionDueAt,
    };
  }

  // ------------------------------------------------- take it with a booking

  /**
   * Inside the booking transaction, after the slot was allocated: validates the
   * station rules against `deposit` and takes it. Returns what the caller emits
   * or answers after commit, or null when the booking carries no deposit.
   */
  async startInTx(
    tx: Tx,
    args: {
      storeId: number;
      bookingId: number;
      customerId: number | null | undefined;
      stationId: number;
      deposit?: BookingDepositDto | null;
      userId: number | null;
    },
  ): Promise<{
    mode: 'desk' | 'link';
    publicToken: string | null;
    event: Parameters<ServiceDepositsService['announceReceived']>[0];
  } | null> {
    const station = await tx.service_stations.findFirst({
      where: { id: args.stationId, store_id: args.storeId },
      select: { deposit_policy: true, deposit_amount: true, hold_minutes: true, name: true },
    });
    const policy = station?.deposit_policy ?? 'none';
    const deposit = args.deposit;
    if (!deposit) {
      if (policy === 'required') throw new VendixHttpException(ErrorCodes.STATION_BOOKING_001);
      return null;
    }
    if (policy === 'none') throw new VendixHttpException(ErrorCodes.STATION_BOOKING_002);
    if (!args.customerId) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_008);
    if (toCents(deposit.amount) < toCents(station?.deposit_amount)) {
      throw new VendixHttpException(ErrorCodes.STATION_BOOKING_003);
    }

    if (deposit.mode === 'desk') {
      const received = await this.deposits.receiveInTx(tx, {
        store_id: args.storeId,
        customer_id: args.customerId,
        booking_id: args.bookingId,
        amount: deposit.amount,
        method: deposit.method ?? 'cash',
        store_payment_method_id: deposit.store_payment_method_id ?? null,
        request_id: deposit.request_id,
        user_id: args.userId,
      });
      // The money is in: the booking is reserved right away.
      await tx.bookings.update({
        where: { id: args.bookingId },
        data: { status: booking_status_enum.confirmed, updated_at: new Date() },
      });
      return { mode: 'desk', publicToken: null, event: received.event };
    }

    const link = await this.openLinkInTx(tx, {
      storeId: args.storeId,
      bookingId: args.bookingId,
      customerId: args.customerId,
      amount: deposit.amount,
      method: deposit.method ?? 'wompi',
      storePaymentMethodId: deposit.store_payment_method_id ?? null,
      requestId: deposit.request_id,
      holdMinutes: station?.hold_minutes ?? 30,
      description: `Anticipo de reserva en ${station?.name ?? 'la estación'}`,
      userId: args.userId,
    });
    return { mode: 'link', publicToken: link.publicToken, event: null };
  }

  /**
   * Holds the slot as `payment_pending` until `now + hold_minutes` (D11) and
   * opens the payment request plus its pending ledger row.
   */
  async openLinkInTx(
    tx: Tx,
    args: {
      storeId: number;
      bookingId: number;
      customerId: number;
      amount: number;
      method: string;
      storePaymentMethodId: number | null;
      requestId: string;
      holdMinutes: number;
      description: string;
      userId: number | null;
    },
  ): Promise<{ publicToken: string; paymentRequestId: number; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + args.holdMinutes * 60_000);
    await tx.service_allocations.updateMany({
      where: { store_id: args.storeId, booking_id: args.bookingId, state: { in: ['held', 'confirmed'] } },
      data: { state: 'payment_pending', expires_at: expiresAt, updated_at: new Date() },
    });
    await tx.bookings.update({
      where: { id: args.bookingId },
      data: { expires_at: expiresAt, updated_at: new Date() },
    });
    const { request, publicToken } = await this.paymentRequests.createInTx(tx, {
      purpose: PAYMENT_REQUEST_PURPOSE,
      amount: args.amount,
      description: args.description,
      expires_at: expiresAt,
      created_by_user_id: args.userId,
    });
    await this.deposits.createPendingInTx(tx, {
      store_id: args.storeId,
      customer_id: args.customerId,
      booking_id: args.bookingId,
      amount: args.amount,
      method: args.method,
      store_payment_method_id: args.storePaymentMethodId,
      payment_request_id: request.id,
      request_id: args.requestId,
      user_id: args.userId,
    });
    return { publicToken, paymentRequestId: request.id, expiresAt };
  }

  /**
   * Ecommerce hold of a station that requires a deposit (S3, A12): the slot is
   * held as `payment_pending` and a payment request opens. Null when the
   * station asks for no mandatory deposit (the plain hold applies).
   */
  async startHoldInTx(
    tx: Tx,
    args: { storeId: number; bookingId: number; customerId: number; stationId: number; userId: number | null },
  ): Promise<{ publicToken: string; expiresAt: Date; amount: number } | null> {
    const station = await tx.service_stations.findFirst({
      where: { id: args.stationId, store_id: args.storeId },
      select: { deposit_policy: true, deposit_amount: true, hold_minutes: true, name: true },
    });
    if (station?.deposit_policy !== 'required' || station.deposit_amount == null) return null;
    const amount = Number(station.deposit_amount);
    const link = await this.openLinkInTx(tx, {
      storeId: args.storeId,
      bookingId: args.bookingId,
      customerId: args.customerId,
      amount,
      method: 'wompi',
      storePaymentMethodId: null,
      requestId: `hold:${args.bookingId}`,
      holdMinutes: station.hold_minutes ?? 30,
      description: `Anticipo de reserva en ${station.name}`,
      userId: args.userId,
    });
    return { publicToken: link.publicToken, expiresAt: link.expiresAt, amount };
  }

  /** New public link of a booking whose deposit request is still pending. */
  async rotateLink(bookingId: number): Promise<{ payment_path: string; payment_request_id: number }> {
    const store_id = this.requireStoreId();
    const pending = await this.prisma.service_deposits.findFirst({
      where: { store_id, booking_id: bookingId, kind: 'received', status: 'pending', payment_request_id: { not: null } },
      select: { payment_request_id: true },
    });
    if (!pending?.payment_request_id) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_007);
    const requestId = pending.payment_request_id;
    const { publicToken } = await this.prisma.$transaction((tx) => this.paymentRequests.rotateTokenInTx(tx, requestId));
    return { payment_path: this.paymentPath(publicToken), payment_request_id: requestId };
  }

  // ------------------------------------------------------------ payment paid

  /**
   * `payment_request.paid` of a booking deposit: claims the pending ledger row,
   * credits the wallet, confirms the booking and its allocation. A payment that
   * arrives after the hold was released (late Wompi, A9) tries to take the same
   * slot back in its own transaction; if that fails the money stays as wallet
   * credit and the administrator is told.
   */
  async settlePaidRequest(event: PaymentRequestPaidEvent): Promise<void> {
    const storeId = event.store_id;
    const row = await this.prisma.service_deposits.findFirst({
      where: { store_id: storeId, payment_request_id: event.payment_request_id, kind: 'received' },
      select: { id: true, status: true, booking_id: true, customer_id: true },
    });
    if (!row?.booking_id) return; // another consumer's request
    const bookingId = row.booking_id;
    const method = event.method === 'wompi' ? 'wompi' : event.method === 'transfer' ? 'bank_transfer' : 'cash';

    const outcome = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.bookings.findFirst({
        where: { id: bookingId, store_id: storeId },
        select: { id: true, status: true },
      });
      const allocation = await this.stationRulesOfBooking(tx, storeId, bookingId);
      if (!booking) return null;
      const holdAlive =
        booking.status !== 'cancelled' &&
        !!allocation &&
        ['payment_pending', 'confirmed'].includes(allocation.state);

      // A released hold cancelled the row: the money still arrived, so revive it to complete it.
      await tx.service_deposits.updateMany({
        where: { id: row.id, status: 'cancelled' },
        data: { status: 'pending', updated_at: new Date() },
      });
      await tx.service_deposits.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { method, updated_at: new Date() },
      });
      const completed = await this.deposits.completePendingInTx(tx, { deposit_id: row.id, store_id: storeId });
      if (!completed.claimed) return { claimed: false as const, holdAlive, event: null };

      if (holdAlive) {
        await tx.service_allocations.updateMany({
          where: { store_id: storeId, booking_id: bookingId, state: 'payment_pending' },
          data: { state: 'confirmed', expires_at: null, updated_at: new Date() },
        });
        await tx.bookings.updateMany({
          where: { id: bookingId, status: 'pending' },
          data: { status: booking_status_enum.confirmed, expires_at: null, updated_at: new Date() },
        });
      }
      return { claimed: true as const, holdAlive, event: completed.event };
    });

    if (!outcome?.claimed) return;
    this.deposits.announceReceived(outcome.event);
    if (outcome.holdAlive) {
      this.eventEmitter.emit('booking.deposit_paid', { store_id: storeId, booking_id: bookingId });
      return;
    }
    await this.retakeSlotAfterLatePayment(storeId, bookingId);
  }

  /** Late payment: same slot again, in its own transaction (a failed statement aborts a shared one). */
  private async retakeSlotAfterLatePayment(storeId: number, bookingId: number): Promise<void> {
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, store_id: storeId },
      select: {
        id: true,
        booking_number: true,
        product_id: true,
        product_variant_id: true,
        provider_id: true,
        date: true,
        end_date: true,
        start_time: true,
        end_time: true,
        is_open_ended: true,
      },
    });
    const previous = await this.stationRulesOfBooking(this.prisma, storeId, bookingId);
    let retaken = false;
    if (booking && previous) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.allocationCoordinator.allocateBooking(tx, {
            storeId,
            bookingId,
            productId: booking.product_id,
            productVariantId: booking.product_variant_id,
            stationId: previous.station.id,
            providerId: booking.provider_id,
            date: booking.date.toISOString().slice(0, 10),
            startTime: booking.start_time,
            endTime: booking.is_open_ended ? undefined : booking.end_time,
            endDate: booking.end_date ? booking.end_date.toISOString().slice(0, 10) : null,
            isOpenEnded: booking.is_open_ended,
            state: 'confirmed',
            excludeBookingId: bookingId,
          });
          await tx.bookings.update({
            where: { id: bookingId },
            data: { status: booking_status_enum.confirmed, expires_at: null, updated_at: new Date() },
          });
        });
        retaken = true;
      } catch (err: unknown) {
        this.logger.warn(
          `Late deposit of booking ${bookingId}: slot not available again (${err instanceof Error ? err.message : err})`,
        );
      }
    }
    await this.alertAdmin(
      storeId,
      'payment_received',
      retaken ? 'Anticipo recibido fuera de plazo' : 'Anticipo recibido, el horario ya no está libre',
      retaken
        ? `La reserva ${booking?.booking_number ?? bookingId} recuperó su horario con el pago tardío.`
        : `El cliente pagó el anticipo de la reserva ${booking?.booking_number ?? bookingId} después de vencer el apartado y el horario ya no está disponible. El dinero quedó como saldo a favor del cliente.`,
      { booking_id: bookingId, retaken },
    );
  }

  // ------------------------------------------------------------- hold expiry

  /**
   * Releases the unpaid holds past `expires_at`: cancels the booking, the
   * pending ledger rows and the payment requests. A request awaiting the
   * administrator's confirmation of a receipt is left alone (A9).
   */
  async expireOverdueHolds(now = new Date()): Promise<number> {
    const store_id = this.requireStoreId();
    const rows = await this.prisma.service_deposits.findMany({
      where: {
        store_id,
        kind: 'received',
        status: 'pending',
        booking_id: { not: null },
        payment_request_id: { not: null },
        booking: { status: 'pending', expires_at: { lt: now } },
      },
      select: { id: true, booking_id: true, payment_request_id: true },
      take: 100,
    });
    let released = 0;
    for (const row of rows) {
      const request = await this.prisma.payment_requests.findFirst({
        where: { id: row.payment_request_id! },
        select: { id: true, status: true, payment_link_id: true },
      });
      if (!request || request.status === 'awaiting_confirmation') continue;
      const bookingId = row.booking_id!;
      try {
        const claimed = await this.prisma.$transaction(async (tx) => {
          const booking = await tx.bookings.updateMany({
            where: { id: bookingId, store_id, status: 'pending', expires_at: { lt: now } },
            data: { status: booking_status_enum.cancelled, expires_at: null, updated_at: now },
          });
          if (booking.count !== 1) return false;
          await this.allocationCoordinator.releaseBooking(tx, store_id, bookingId, 'expired');
          await tx.service_deposits.updateMany({
            where: { id: row.id, status: 'pending' },
            data: { status: 'cancelled', updated_at: now },
          });
          // `expired` (not cancelled): a Wompi payment already in flight can still settle it (A9).
          await tx.payment_requests.updateMany({
            where: { id: request.id, status: 'pending' },
            data: { status: 'expired', updated_at: now },
          });
          return true;
        });
        if (!claimed) continue;
        released += 1;
        if (request.payment_link_id) {
          try {
            await this.lazy(PaymentLinksService)?.deactivate(request.payment_link_id);
          } catch (err: unknown) {
            this.logger.warn(`Payment link ${request.payment_link_id} not deactivated: ${err instanceof Error ? err.message : err}`);
          }
        }
        this.eventEmitter.emit('booking.hold_expired', { store_id, booking_id: bookingId });
      } catch (err: unknown) {
        this.logger.error(`Hold of booking ${bookingId} not released: ${err instanceof Error ? err.message : err}`);
      }
    }
    return released;
  }

  // --------------------------------------------------------------- no-show

  /**
   * Auto-no-show guard: a booking with a deposit balance never closes alone.
   * It gets `deposit_decision_due_at` (once) and the administrator is told.
   * Returns true when the booking was deferred.
   */
  async deferNoShowIfDeposit(bookingId: number): Promise<boolean> {
    const store_id = this.requireStoreId();
    const balance = await this.deposits.balanceOf({ bookingId });
    if (balance.balance <= 0) return false;
    const claimed = await this.prisma.bookings.updateMany({
      where: { id: bookingId, store_id, deposit_decision_due_at: null },
      data: { deposit_decision_due_at: new Date(), updated_at: new Date() },
    });
    if (claimed.count === 1) {
      await this.alertAdmin(
        store_id,
        'booking_no_show',
        'Anticipo por decidir',
        'Una reserva con anticipo no se presentó: decide si retienes el anticipo, reagendas, devuelves o dejas saldo a favor.',
        { booking_id: bookingId, balance: balance.balance },
      );
    }
    return true;
  }

  // ----------------------------------------------------- close with deposit

  /** Closes the booking in the caller's transaction: slot released, status set. */
  private async closeBookingInTx(tx: Tx, storeId: number, bookingId: number, target: 'cancelled' | 'no_show') {
    await this.allocationCoordinator.releaseBooking(tx, storeId, bookingId, target === 'cancelled' ? 'cancelled' : 'released');
    await tx.bookings.update({
      where: { id: bookingId },
      data: { status: target as booking_status_enum, expires_at: null, deposit_decision_due_at: null, updated_at: new Date() },
    });
  }

  /** Cancels the unpaid deposit rows and requests of a booking being closed. */
  private async cancelPendingInTx(tx: Tx, storeId: number, bookingId: number) {
    const pending = await tx.service_deposits.findMany({
      where: { store_id: storeId, booking_id: bookingId, kind: 'received', status: 'pending' },
      select: { id: true, payment_request_id: true },
    });
    for (const row of pending) {
      await tx.service_deposits.updateMany({ where: { id: row.id, status: 'pending' }, data: { status: 'cancelled', updated_at: new Date() } });
      if (row.payment_request_id) {
        await tx.payment_requests.updateMany({
          where: { id: row.payment_request_id, status: { in: ['pending', 'awaiting_confirmation'] } },
          data: { status: 'cancelled', updated_at: new Date() },
        });
      }
    }
    return pending.length;
  }

  /**
   * Cancel (A1). Returns null when the booking has nothing to decide (the plain
   * cancel then runs). With a deposit balance: before the station's refund
   * window the leftover is refunded or credited and the booking is cancelled in
   * one transaction; inside the window the administrator decides (409).
   */
  async cancelWithDeposit(
    bookingId: number,
    options: { leftover_action?: 'refund' | 'credit'; refund_method?: string; request_id?: string },
  ): Promise<{ closed: true } | null> {
    const store_id = this.requireStoreId();
    const [balance, pendingCount] = await Promise.all([
      this.deposits.balanceOf({ bookingId }),
      this.prisma.service_deposits.count({ where: { store_id, booking_id: bookingId, kind: 'received', status: 'pending' } }),
    ]);
    if (balance.balance <= 0 && pendingCount === 0) return null;
    if (balance.balance <= 0) {
      // Only an unpaid request: cancel it with the booking.
      await this.prisma.$transaction((tx) => this.cancelPendingInTx(tx, store_id, bookingId));
      return null;
    }

    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, store_id },
      select: { id: true, status: true, customer_id: true },
    });
    if (!booking || !DECIDABLE_STATUSES.includes(booking.status)) return null; // the state machine answers
    const allocation = await this.stationRulesOfBooking(this.prisma, store_id, bookingId);
    const hours = allocation?.station.cancel_refund_hours;
    const refundable =
      hours != null && !!allocation && allocation.start_at.getTime() - Date.now() >= hours * 3_600_000;
    if (!refundable) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_004);

    const action = options.leftover_action ?? 'credit';
    await this.moveLeftoverAndClose(store_id, booking, action, 'cancelled', {
      request_id: options.request_id ?? `cancel:${bookingId}`,
      refund_method: options.refund_method,
    });
    return { closed: true };
  }

  /** Refund / credit the whole balance and close the booking, atomically; events after commit. */
  private async moveLeftoverAndClose(
    storeId: number,
    booking: { id: number; customer_id: number | null },
    action: 'refund' | 'credit',
    target: 'cancelled' | 'no_show',
    options: { request_id: string; refund_method?: string; store_payment_method_id?: number },
  ) {
    if (!booking.customer_id) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_008);
    const userId = RequestContextService.getUserId() ?? null;
    const refunded = await this.prisma.$transaction(async (tx) => {
      const base = {
        store_id: storeId,
        customer_id: booking.customer_id!,
        booking_id: booking.id,
        request_id: options.request_id,
        user_id: userId,
      };
      let event: Parameters<ServiceDepositsService['announceRefunded']>[0] = null;
      if (action === 'refund') {
        const refund = await this.deposits.refundInTx(tx, {
          ...base,
          method: options.refund_method ?? 'cash',
          store_payment_method_id: options.store_payment_method_id ?? null,
        });
        event = refund.event;
      } else {
        await this.deposits.releaseInTx(tx, base);
      }
      await this.cancelPendingInTx(tx, storeId, booking.id);
      await this.closeBookingInTx(tx, storeId, booking.id, target);
      return event;
    });
    this.deposits.announceRefunded(refunded);
  }

  // --------------------------------------------------------------- decision

  /**
   * S17 decision over the deposit of a booking that did not show up (or was
   * cancelled late): `retain` bills it as the fixed "Gastos de reserva" line and
   * marks the no-show; `refund` / `credit` return it and cancel the booking.
   * `reschedule` is handled by `ReservationsService` (it owns the move).
   */
  async decide(bookingId: number, dto: DepositDecisionDto): Promise<{ action: DepositDecisionDto['action'] }> {
    const store_id = this.requireStoreId();
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, store_id },
      select: { id: true, status: true, customer_id: true, booking_number: true },
    });
    if (!booking) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_005);
    if (!DECIDABLE_STATUSES.includes(booking.status)) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_006);
    const balance = await this.deposits.balanceOf({ bookingId });
    if (balance.balance <= 0) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_005);

    if (dto.action === 'refund' || dto.action === 'credit') {
      await this.moveLeftoverAndClose(store_id, booking, dto.action, 'cancelled', {
        request_id: dto.request_id,
        refund_method: dto.refund_method,
        store_payment_method_id: dto.store_payment_method_id,
      });
      this.emitClosed('booking.cancelled', store_id, booking);
      return { action: dto.action };
    }
    if (dto.action !== 'retain') throw new VendixHttpException(ErrorCodes.STATION_BOOKING_009);
    if (!booking.customer_id) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_008);

    const station = (await this.stationRulesOfBooking(this.prisma, store_id, bookingId))?.station;
    const taxes = this.lazy(ShippingTaxService);
    const currency = (await this.lazy(SettingsService)?.getStoreCurrency()) ?? 'COP';
    const userId = RequestContextService.getUserId() ?? null;

    const result = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const order = await tx.orders.create({
        data: {
          store_id,
          created_by_user_id: userId,
          customer_id: booking.customer_id,
          order_number: `RSV-${booking.id}`,
          state: 'finished',
          channel: 'pos',
          delivery_type: 'direct_delivery',
          currency,
          subtotal_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          discount_amount: 0,
          grand_total: 0,
          total_paid: 0,
          remaining_balance: 0,
          updated_at: now,
        },
        select: { id: true },
      });
      // Tax of the fee line is always inclusive; no category = no tax until the accountant decides (A3).
      const rows = taxes
        ? await taxes.taxRowsForCategory(tx, {
            tax_category_id: station?.reservation_fee_tax_category_id ?? null,
            tax_is_inclusive: true,
            store_id,
          })
        : [];
      await tx.order_items.create({
        data: {
          order_id: order.id,
          product_id: null,
          product_name: RESERVATION_FEE_LINE_NAME,
          quantity: 1,
          item_type: 'service',
          service_line_kind: RESERVATION_FEE_LINE_KIND,
          updated_at: now,
          ...buildSessionTaxedLine(balance.balance, 1, rows),
        },
      });
      await writeSessionOrderTotals(tx, order.id, now);
      const applied = await this.deposits.applyToOrderInTx(tx, {
        store_id,
        order_id: order.id,
        booking_id: booking.id,
        user_id: userId,
        strict: true,
      });
      await this.closeBookingInTx(tx, store_id, booking.id, 'no_show');
      return { orderId: order.id, paymentReceived: applied.payment_received };
    });
    await this.emitPaymentReceived(result.orderId, result.paymentReceived, currency, userId);
    await this.invoiceFeeOrder(result.orderId);
    this.emitClosed('booking.no_show', store_id, booking);
    return { action: 'retain' };
  }

  /**
   * The fee order is born paid: hand it to the POS invoice emitter. The
   * decision is already committed, so an emitter failure is only logged (the
   * invoice can be issued later from the order).
   */
  private async invoiceFeeOrder(orderId: number): Promise<void> {
    try {
      await this.lazy(OrderFlowService)?.invoicePaidReservationFeeOrder(orderId);
    } catch (error) {
      this.logger.error(`[reservation fee invoice] order=${orderId}: ${(error as Error).message}`);
    }
  }

  /** `payment.received` of the fee order (wallet method books DR 2805), after commit. */
  private async emitPaymentReceived(
    orderId: number,
    received: ServiceDepositPaymentReceived | null,
    currency: string,
    userId: number | null,
  ) {
    if (!received) return;
    const order = await this.prisma.orders.findFirst({ where: { id: orderId } });
    if (!order) return;
    const items = await this.prisma.order_items.findMany({
      where: { order_id: orderId, cancelled_at: null },
      select: {
        total_price: true,
        quantity: true,
        tax_amount_item: true,
        weight: true,
        price_unit_quantity: true,
        item_type: true,
        order_item_taxes: { select: { tax_type: true, tax_amount: true, tax_rate: true } },
      },
    });
    const sale_tax = buildOrderSaleTaxPayload({
      product_tax_rows: items.flatMap((item) =>
        (item.order_item_taxes || []).map((tax) => ({ ...tax, taxable_amount: Number(item.total_price || 0) })),
      ),
      order,
      order_items: items,
    });
    for (const payload of buildPaymentReceivedEvents({
      order: received.order,
      sale_tax,
      payments: [received.payment],
      currency,
      user_id: userId,
    })) {
      this.eventEmitter.emit('payment.received', payload);
    }
  }

  private emitClosed(
    event: 'booking.cancelled' | 'booking.no_show',
    storeId: number,
    booking: { id: number; booking_number: string },
  ) {
    this.eventEmitter.emit(event, { store_id: storeId, booking_id: booking.id, booking_number: booking.booking_number });
  }
}
