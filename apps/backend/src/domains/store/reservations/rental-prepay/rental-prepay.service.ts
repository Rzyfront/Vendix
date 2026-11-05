import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { Prisma, booking_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PaymentLinksService } from '../../payment-links/payment-links.service';
import { PaymentRequestsService } from '../../payment-requests/payment-requests.service';
import type { PaymentRequestPaidEvent } from '../../payment-requests/payment-requests.service';
import { OrdersService } from '../../orders/orders.service';
import { OrderHistoryService } from '../../orders/order-history/order-history.service';
import { OrderFlowService } from '../../orders/order-flow/order-flow.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { getSettledOrderAmount } from '../../payments/services/payment-validator.service';
import { buildPaymentReceivedEvents } from '../../payments/utils/payment-received-event.util';
import { buildOrderSaleTaxPayload } from '../../payments/utils/order-sale-tax-payload.util';
import { resolvePaymentReceivedSaleFields } from '../../payments/utils/payment-sale-share.util';
import type { PaymentReceivedSaleFields } from '../../payments/utils/payment-sale-share.util';
import { shouldRecordCashMovement } from '../../cash-registers/movements/cash-movement-policy.util';
import { MovementsService } from '../../cash-registers/movements/movements.service';
import { SessionsService } from '../../cash-registers/sessions/sessions.service';
import { toCents } from '../../service-deposits/utils/service-deposit-math';
import { publicPaymentUrl, resolveStorePublicOrigin } from '../../../../common/utils/store-public-origin.util';

type Tx = Prisma.TransactionClient;

const PURPOSE_PREFIX = 'service_rental';

/**
 * `payment_requests` has no metadata column, so the booking id travels in the
 * purpose tag (`service_rental:<booking id>`, 15 + digits <= VarChar(30)).
 */
export function rentalPrepayPurpose(bookingId: number): string {
  return `${PURPOSE_PREFIX}:${bookingId}`;
}

/** Booking id of a rental prepay purpose, or null for any other purpose. */
export function bookingIdFromRentalPurpose(purpose: string | null | undefined): number | null {
  const match = /^service_rental:(\d+)$/.exec(purpose ?? '');
  return match ? Number(match[1]) : null;
}

export interface PrepayStationRules {
  booking_prepay_mode: string | null;
  booking_prepay_percent?: Prisma.Decimal | string | number | null;
  booking_prepay_amount?: Prisma.Decimal | string | number | null;
}

/**
 * Integer cents to charge to reserve. `full` charges the whole quote; `partial`
 * charges a percentage (half-up) or a fixed amount capped at the quote. Zero when
 * the station does not charge, or the partial rule is incomplete.
 */
export function rentalPrepayCents(station: PrepayStationRules, quotedAmount: unknown): number {
  const quotedCents = toCents(quotedAmount as number | string | null | undefined);
  if (quotedCents <= 0) return 0;
  if (station.booking_prepay_mode === 'full') return quotedCents;
  if (station.booking_prepay_mode !== 'partial') return 0;
  if (station.booking_prepay_percent != null) {
    return new Prisma.Decimal(station.booking_prepay_percent.toString())
      .mul(quotedCents)
      .div(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
  }
  if (station.booking_prepay_amount != null) {
    return Math.min(toCents(station.booking_prepay_amount as number | string), quotedCents);
  }
  return 0;
}

/** `prepay` block of the booking detail. */
export interface BookingPrepayBlock {
  paid_amount: number;
  order_total: number;
  remaining: number;
  pending_request: {
    payment_request_id: number;
    amount: number;
    status: string;
    expires_at: Date | null;
  } | null;
}

interface BookingForPayment {
  id: number;
  status: string;
  order_id: number | null;
  customer_id: number | null;
  booking_number: string;
  channel: string;
  product_id: number;
  product_variant_id: number | null;
  quoted_amount: unknown;
}

interface RegisterPrepayArgs {
  storeId: number;
  booking: BookingForPayment;
  amount: Prisma.Decimal;
  /** Accounting method of `payment.received`: wompi, bank_transfer, cash, card... */
  accountingMethod: string;
  /** Unique per logical payment: a repeated event finds it and registers nothing. */
  transactionId: string;
  storePaymentMethodId: number | null;
  bankAccountId: number | null;
  receiptS3Key?: string | null;
  receiptUploadedAt?: Date | null;
  gateway: Record<string, unknown>;
  /** In person: refuse (STATION_BOOKING_015) a payment above what the order still owes. */
  rejectIfExceedsRemaining?: boolean;
  /** Online: tell the admin when the hold was already released. */
  alertLatePayment?: boolean;
  /** Runs inside the payment transaction, after the payment row exists. */
  inTx?: (tx: Tx, ctx: { orderId: number; paymentId: number }) => Promise<void>;
}

const PAYABLE_STATUSES: string[] = ['pending', 'confirmed'];
const ORDER_SETTLED_MESSAGE = 'La orden de esta reserva ya está pagada: no hay saldo por cobrar.';

function rentalPrepayDescription(stationName: string): string {
  return `Cobro para reservar en ${stationName}`;
}

/** `openLink` transaction result: a link to share, or an order already settled (its stale link was cancelled). */
type OpenLinkOutcome =
  | {
      kind: 'link';
      staleLinkId: number | null;
      payment_path: string;
      payment_request_id: number;
      amount: number;
      expires_at: Date | null;
    }
  | { kind: 'settled'; staleLinkId: number | null };
const STATION_SELECT = {
  id: true,
  name: true,
  hold_minutes: true,
  booking_prepay_mode: true,
  booking_prepay_percent: true,
  booking_prepay_amount: true,
} as const;

/**
 * "Cobro para reservar" of a station rental (S1, S3, S15): the payment request
 * that collects the whole quote or an advance, and its settlement as a NORMAL
 * order payment (never the wallet: it is a sale, unlike the deposit). Does not
 * depend on `ReservationsService` (that one depends on this service).
 */
@Injectable()
export class RentalPrepayService {
  private readonly logger = new Logger(RentalPrepayService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly paymentRequests: PaymentRequestsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly ordersService: OrdersService,
    private readonly orderHistory: OrderHistoryService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  paymentPath(publicToken: string): string {
    return `/pagar/${publicToken}`;
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  private async alertAdmin(storeId: number, title: string, body: string, data: Record<string, unknown>) {
    try {
      const notifications = this.moduleRef?.get(NotificationsService, { strict: false });
      await notifications?.createAndBroadcast(storeId, 'payment_received', title, body, data);
    } catch (err: unknown) {
      this.logger.warn(`Admin alert not sent: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ------------------------------------------------------------- open a link

  /**
   * Admin endpoint: payment link for the booking's prepay. A pending request
   * gets a new token instead of a duplicate. A pending booking is held as
   * `payment_pending` until it is paid; a confirmed one keeps its slot untouched.
   */
  async openLink(bookingId: number): Promise<{
    payment_path: string;
    payment_url: string | null;
    payment_request_id: number;
    amount: number;
    expires_at: Date | null;
  }> {
    const storeId = this.requireStoreId();
    const userId = RequestContextService.getUserId() ?? null;
    const outcome = await this.prisma.$transaction(async (tx): Promise<OpenLinkOutcome> => {
      const booking = await tx.bookings.findFirst({
        where: { id: bookingId, store_id: storeId },
        select: { id: true, status: true, quoted_amount: true, order_id: true },
      });
      if (!booking) throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_005);
      if (!PAYABLE_STATUSES.includes(booking.status)) {
        throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_004);
      }
      const allocation = await tx.service_allocations.findFirst({
        where: { store_id: storeId, booking_id: bookingId },
        orderBy: { id: 'desc' },
        select: { id: true, state: true, station: { select: STATION_SELECT } },
      });
      const station = allocation?.station;
      if (!station || station.booking_prepay_mode === 'none') {
        throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_001);
      }
      let cents = rentalPrepayCents(station, booking.quoted_amount);
      if (cents <= 0) throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_002);
      // M-3: a booking that already has an order may have paid part (or all) of it: a link never
      // collects more than what the order still owes, so settlement can never overpay it.
      let orderSettled = false;
      if (booking.order_id != null) {
        const order = await tx.orders.findUnique({
          where: { id: booking.order_id },
          include: { payments: { select: { amount: true, state: true } } },
        });
        if (order) {
          const remainingCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
          orderSettled = remainingCents <= 0;
          cents = Math.min(cents, remainingCents);
        }
      }
      const purpose = rentalPrepayPurpose(bookingId);

      // What was already collected in person counts against the station's charge (S2): a link never asks it twice.
      const inPerson = await tx.payments.findMany({
        where: { transaction_id: { startsWith: `SVC-RENTAL-IP-${bookingId}-` }, state: 'succeeded' },
        select: { amount: true },
      });
      const inPersonCents = inPerson.reduce((sum, payment) => sum + toCents(payment.amount), 0);
      if (inPersonCents > 0) {
        cents -= inPersonCents;
        if (cents <= 0) throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_003);
      }

      const paid = await tx.payment_requests.findFirst({
        where: { store_id: storeId, purpose, status: 'paid' },
        select: { id: true },
      });
      if (paid) throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_003);

      const open = await tx.payment_requests.findFirst({
        where: { store_id: storeId, purpose, status: { in: ['pending', 'awaiting_confirmation'] } },
        select: { id: true, status: true, amount: true, payment_link_id: true, expires_at: true },
      });
      // A pending request whose amount no longer matches (the order was paid elsewhere) would still charge
      // the old amount: it is cancelled, and replaced unless nothing is owed any more.
      const stale = open?.status === 'pending' && (orderSettled || toCents(open.amount) !== cents) ? open : null;
      if (stale) {
        const cancelled = await tx.payment_requests.updateMany({
          where: { id: stale.id, status: 'pending' },
          data: { status: 'cancelled', updated_at: new Date() },
        });
        // Paid or under review meanwhile: nothing is replaced (same rule as rotating the token).
        if (cancelled.count !== 1) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_INVALID_STATE);
      }
      const staleLinkId = stale?.payment_link_id ?? null;
      if (orderSettled) {
        if (stale) return { kind: 'settled', staleLinkId };
        throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_003, ORDER_SETTLED_MESSAGE);
      }
      if (open?.status === 'awaiting_confirmation') {
        throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_AWAITING_CONFIRMATION);
      }
      if (open && !stale) {
        const { publicToken } = await this.paymentRequests.rotateTokenInTx(tx, open.id);
        return {
          kind: 'link',
          staleLinkId: null,
          payment_path: this.paymentPath(publicToken),
          payment_request_id: open.id,
          amount: cents / 100,
          expires_at: open.expires_at ?? null,
        };
      }
      if (stale) {
        // Same hold, same deadline: only the amount changes.
        const { request, publicToken } = await this.paymentRequests.createInTx(tx, {
          purpose,
          amount: cents / 100,
          description: rentalPrepayDescription(station.name),
          expires_at: stale.expires_at ?? null,
          created_by_user_id: userId,
        });
        return {
          kind: 'link',
          staleLinkId,
          payment_path: this.paymentPath(publicToken),
          payment_request_id: request.id,
          amount: cents / 100,
          expires_at: stale.expires_at ?? null,
        };
      }
      const opened = await this.openRequestInTx(tx, {
        storeId,
        bookingId,
        amount: cents / 100,
        holdMinutes: booking.status === 'pending' ? (station.hold_minutes ?? 30) : null,
        stationName: station.name,
        userId,
      });
      return {
        kind: 'link',
        staleLinkId: null,
        payment_path: this.paymentPath(opened.publicToken),
        payment_request_id: opened.paymentRequestId,
        amount: cents / 100,
        expires_at: opened.expiresAt,
      };
    });
    if (outcome.staleLinkId != null) await this.deactivateWompiLink(outcome.staleLinkId);
    if (outcome.kind === 'settled') throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_003, ORDER_SETTLED_MESSAGE);
    // The admin shares this link: it must point at the store's public domain, not the admin host.
    return {
      payment_path: outcome.payment_path,
      payment_url: publicPaymentUrl(await resolveStorePublicOrigin(this.prisma, storeId), outcome.payment_path),
      payment_request_id: outcome.payment_request_id,
      amount: outcome.amount,
      expires_at: outcome.expires_at,
    };
  }

  /** Best effort, after commit: the request is already cancelled, so a late Wompi payment settles nothing. */
  private async deactivateWompiLink(paymentLinkId: number): Promise<void> {
    try {
      await this.moduleRef?.get(PaymentLinksService, { strict: false })?.deactivate(paymentLinkId);
    } catch (err: unknown) {
      this.logger.warn(`Payment link ${paymentLinkId} not deactivated: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ------------------------------------------------------- read and in person

  /**
   * `prepay` block of the booking detail (S2): what was paid on the booking's order, what the
   * "cobro para reservar" still asks and the open request. Null when the station charges nothing and
   * nothing was paid. `remaining` is never negative and is 0 for a booking that no longer takes a charge.
   */
  async summary(bookingId: number): Promise<BookingPrepayBlock | null> {
    const storeId = this.requireStoreId();
    const booking = await this.prisma.bookings.findFirst({
      where: { id: bookingId, store_id: storeId },
      select: { id: true, status: true, quoted_amount: true, order_id: true },
    });
    if (!booking) return null;
    const [allocation, order, open] = await Promise.all([
      this.prisma.service_allocations.findFirst({
        where: { store_id: storeId, booking_id: bookingId },
        orderBy: { id: 'desc' },
        select: { station: { select: STATION_SELECT } },
      }),
      booking.order_id != null
        ? this.prisma.orders.findFirst({
            where: { id: booking.order_id, store_id: storeId },
            select: { grand_total: true, state: true, payments: { select: { amount: true, state: true } } },
          })
        : Promise.resolve(null),
      this.prisma.payment_requests.findFirst({
        where: { store_id: storeId, purpose: rentalPrepayPurpose(bookingId), status: { in: ['pending', 'awaiting_confirmation'] } },
        orderBy: { id: 'desc' },
        select: { id: true, amount: true, status: true, expires_at: true },
      }),
    ]);
    const station = allocation?.station ?? null;
    const charges = !!station && station.booking_prepay_mode !== 'none';
    const paidCents = order && order.state !== 'cancelled' ? toCents(getSettledOrderAmount(order)) : 0;
    if (!charges && paidCents === 0 && !open) return null;
    const targetCents = charges ? rentalPrepayCents(station, booking.quoted_amount) : 0;
    const totalCents = order ? toCents(order.grand_total) : toCents(booking.quoted_amount);
    const payable = PAYABLE_STATUSES.includes(booking.status) && order?.state !== 'cancelled';
    const remainingCents = payable ? Math.max(0, Math.min(targetCents - paidCents, totalCents - paidCents)) : 0;
    return {
      paid_amount: paidCents / 100,
      order_total: totalCents / 100,
      remaining: remainingCents / 100,
      pending_request: open
        ? { payment_request_id: open.id, amount: Number(open.amount), status: open.status, expires_at: open.expires_at ?? null }
        : null,
    };
  }

  /**
   * "Registrar pago" (S2): the prepay collected in person (cash, card, transfer). Same registration as a
   * paid payment request (`registerPrepayPayment`); every method needs the operator's open cash session (when the register is enabled) like any
   * counter payment, and an open payment request of the booking is cancelled (and its Wompi link
   * deactivated) once it is paid at the desk.
   */
  async registerInPerson(
    bookingId: number,
    dto: { store_payment_method_id: number; bank_account_id?: number; amount?: number; reference?: string },
  ): Promise<{ paid_amount: number; fully_paid: boolean }> {
    const storeId = this.requireStoreId();
    const userId = RequestContextService.getUserId() ?? null;
    const booking = await this.loadBookingForPayment(storeId, bookingId);
    if (!booking) throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_005);
    if (!PAYABLE_STATUSES.includes(booking.status)) throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_004);
    const block = await this.summary(bookingId);
    const remainingCents = block ? toCents(block.remaining) : 0;
    if (remainingCents <= 0) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_015);
    const amountCents = dto.amount != null ? toCents(dto.amount) : remainingCents;
    if (amountCents <= 0 || amountCents > remainingCents) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_016);
    if (booking.status === 'pending') {
      const allocation = await this.prisma.service_allocations.findFirst({
        where: { store_id: storeId, booking_id: bookingId },
        orderBy: { id: 'desc' },
        select: { state: true },
      });
      if (!allocation || !['held', 'payment_pending', 'confirmed'].includes(allocation.state)) {
        throw new VendixHttpException(ErrorCodes.RENTAL_PREPAY_004);
      }
    }

    const method = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id, store_id: storeId, state: 'enabled' },
      select: { id: true, system_payment_method: { select: { type: true, processing_mode: true } } },
    });
    const methodType = method?.system_payment_method?.type ?? null;
    const processingMode = method?.system_payment_method?.processing_mode ?? null;
    // A gateway, wallet or on-delivery method is not money received at the desk.
    if (!method || !methodType || ['wompi', 'wallet', 'cash_on_delivery'].includes(methodType) || processingMode === 'ON_DELIVERY') {
      throw new VendixHttpException(ErrorCodes.STATION_BOOKING_016);
    }
    let bankAccountId: number | null = null;
    if (dto.bank_account_id != null) {
      if (methodType !== 'bank_transfer') throw new VendixHttpException(ErrorCodes.STATION_BOOKING_016);
      const store = await this.prisma.stores.findFirst({ where: { id: storeId }, select: { organization_id: true } });
      const account = store
        ? await this.prisma.bank_accounts.findFirst({
            where: {
              id: dto.bank_account_id,
              status: 'active',
              organization_id: store.organization_id,
              OR: [{ store_id: null }, { store_id: storeId }],
            },
            select: { id: true },
          })
        : null;
      if (!account) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_016);
      bankAccountId = account.id;
    }

    // Single cash gate (S14): with the register enabled, whoever collects (any method) needs their own open session,
    // and the payment lands there as a `sale` movement, like every counter payment.
    const sessions = this.moduleRef?.get(SessionsService, { strict: false });
    if (!sessions) throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);
    await sessions.assertSessionForSales(userId ?? undefined);
    const cashSessionId = await this.openCashSessionFor(storeId, userId, methodType, processingMode);
    const movements = cashSessionId != null ? this.moduleRef?.get(MovementsService, { strict: false }) : null;
    if (cashSessionId != null && !movements) throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);

    const amount = new Prisma.Decimal(amountCents).div(100);
    const linkIds: number[] = [];
    const result = await this.registerPrepayPayment({
      storeId,
      booking,
      amount,
      accountingMethod: methodType,
      transactionId: `SVC-RENTAL-IP-${bookingId}-${randomUUID().slice(0, 8)}`,
      storePaymentMethodId: method.id,
      bankAccountId,
      gateway: { in_person: true, method: methodType, ...(dto.reference?.trim() ? { reference: dto.reference.trim() } : {}) },
      rejectIfExceedsRemaining: true,
      inTx: async (tx, ctx) => {
        if (cashSessionId != null && movements) {
          await movements.recordSaleMovement(
            cashSessionId,
            { store_id: storeId, user_id: userId as number, amount: Number(amount), payment_method: methodType, order_id: ctx.orderId, payment_id: ctx.paymentId },
            tx,
          );
        }
        linkIds.push(...(await this.cancelOpenRequestsInTx(tx, storeId, bookingId)));
      },
    });
    for (const linkId of linkIds) await this.deactivateWompiLink(linkId);
    if (!result.registered) throw new VendixHttpException(ErrorCodes.STATION_BOOKING_015);
    const after = await this.summary(bookingId);
    return { paid_amount: after?.paid_amount ?? Number(amount), fully_paid: result.fullyPaid };
  }

  /**
   * Session that must receive the money: the user's open one when the register is enabled and the method
   * moves cash flow (`shouldRecordCashMovement`); null otherwise.
   */
  private async openCashSessionFor(
    storeId: number,
    userId: number | null,
    methodType: string,
    processingMode?: string | null,
  ): Promise<number | null> {
    if (!userId || !shouldRecordCashMovement(methodType, processingMode)) return null;
    const settings = await this.prisma.store_settings.findFirst({ where: { store_id: storeId }, select: { settings: true } });
    const enabled = (settings?.settings as { pos?: { cash_register?: { enabled?: boolean } } } | null)?.pos?.cash_register?.enabled;
    if (!enabled) return null;
    const sessions = this.moduleRef?.get(SessionsService, { strict: false });
    return (await sessions?.getActiveSession(userId))?.id ?? null;
  }

  /**
   * Cancels the open (`pending`) payment requests of a booking and returns the Wompi links to deactivate
   * after commit. A transfer receipt awaiting confirmation is real money: it blocks with 409 until the
   * administrator confirms or rejects it (same rule as a deposit request).
   */
  async cancelOpenRequestsInTx(tx: Tx, storeId: number, bookingId: number): Promise<number[]> {
    const purpose = rentalPrepayPurpose(bookingId);
    const awaiting = await tx.payment_requests.findFirst({
      where: { store_id: storeId, purpose, status: 'awaiting_confirmation' },
      select: { id: true },
    });
    if (awaiting) {
      throw new VendixHttpException(
        ErrorCodes.SERVICE_DEPOSIT_010,
        'El cliente envió un comprobante que está por confirmar. Confírmalo o recházalo en Reservas → Cobros antes de continuar.',
      );
    }
    const open = await tx.payment_requests.findMany({
      where: { store_id: storeId, purpose, status: 'pending' },
      select: { id: true, payment_link_id: true },
    });
    const linkIds: number[] = [];
    for (const row of open) {
      const claimed = await tx.payment_requests.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      if (claimed.count === 1 && row.payment_link_id != null) linkIds.push(row.payment_link_id);
    }
    return linkIds;
  }

  /** Deactivates Wompi links after the transaction that cancelled their requests committed (best effort). */
  async deactivateLinks(linkIds: number[]): Promise<void> {
    for (const linkId of linkIds) await this.deactivateWompiLink(linkId);
  }

  /**
   * Money received on the booking's rental order (S3): net of refunds for a live order, or the sum of
   * what was received when the order was already cancelled (a cancel that stopped half-way resumes).
   */
  async receivedCharge(
    storeId: number,
    bookingId: number,
  ): Promise<{ orderId: number; orderState: string; receivedCents: number; methodType: string | null } | null> {
    const booking = await this.prisma.bookings.findFirst({ where: { id: bookingId, store_id: storeId }, select: { order_id: true } });
    if (!booking?.order_id) return null;
    const order = await this.prisma.orders.findFirst({
      where: { id: booking.order_id, store_id: storeId },
      select: {
        id: true,
        state: true,
        payments: {
          select: {
            amount: true,
            state: true,
            store_payment_method: { select: { system_payment_method: { select: { type: true } } } },
          },
        },
      },
    });
    if (!order) return null;
    const live = order.state !== 'cancelled';
    const counted = live ? ['succeeded', 'captured', 'partially_refunded'] : ['succeeded', 'captured', 'partially_refunded', 'refunded'];
    const rows = order.payments.filter((payment) => counted.includes(payment.state));
    const receivedCents = rows.reduce((sum, payment) => sum + toCents(payment.amount), 0);
    if (receivedCents <= 0) return null;
    const methodType = rows.find((row) => row.store_payment_method?.system_payment_method?.type)?.store_payment_method?.system_payment_method?.type ?? null;
    return { orderId: order.id, orderState: order.state, receivedCents, methodType };
  }

  /**
   * Online hold of a station that charges to reserve (A17): the slot is held as
   * `payment_pending` behind a payment page. Null when the station charges
   * nothing (then the deposit, or the plain hold, applies).
   */
  async startHoldInTx(
    tx: Tx,
    args: { storeId: number; bookingId: number; stationId: number; userId: number | null },
  ): Promise<{ publicToken: string; expiresAt: Date; amount: number } | null> {
    const station = await tx.service_stations.findFirst({
      where: { id: args.stationId, store_id: args.storeId },
      select: STATION_SELECT,
    });
    if (!station || station.booking_prepay_mode === 'none') return null;
    const booking = await tx.bookings.findFirst({
      where: { id: args.bookingId, store_id: args.storeId },
      select: { quoted_amount: true },
    });
    const cents = rentalPrepayCents(station, booking?.quoted_amount);
    if (cents <= 0) return null;
    const opened = await this.openRequestInTx(tx, {
      storeId: args.storeId,
      bookingId: args.bookingId,
      amount: cents / 100,
      holdMinutes: station.hold_minutes ?? 30,
      stationName: station.name,
      userId: args.userId,
    });
    return { publicToken: opened.publicToken, expiresAt: opened.expiresAt as Date, amount: cents / 100 };
  }

  private async openRequestInTx(
    tx: Tx,
    args: {
      storeId: number;
      bookingId: number;
      amount: number;
      holdMinutes: number | null;
      stationName: string;
      userId: number | null;
    },
  ): Promise<{ publicToken: string; paymentRequestId: number; expiresAt: Date | null }> {
    const expiresAt = args.holdMinutes != null ? new Date(Date.now() + args.holdMinutes * 60_000) : null;
    if (expiresAt) {
      await tx.service_allocations.updateMany({
        where: { store_id: args.storeId, booking_id: args.bookingId, state: { in: ['held', 'confirmed'] } },
        data: { state: 'payment_pending', expires_at: expiresAt, updated_at: new Date() },
      });
      await tx.bookings.update({
        where: { id: args.bookingId },
        data: { expires_at: expiresAt, updated_at: new Date() },
      });
    }
    const { request, publicToken } = await this.paymentRequests.createInTx(tx, {
      purpose: rentalPrepayPurpose(args.bookingId),
      amount: args.amount,
      description: rentalPrepayDescription(args.stationName),
      expires_at: expiresAt,
      created_by_user_id: args.userId,
    });
    return { publicToken, paymentRequestId: request.id, expiresAt };
  }

  // ------------------------------------------------------------ payment paid

  /**
   * `payment_request.paid` of a rental prepay: registers a normal payment on the
   * booking's order (creating the order when the online hold had none) and
   * confirms the held slot. Idempotent: the payment is keyed by the request id.
   *
   * The payment carries the store payment method, bank account and receipt the
   * request already holds (S1): the order detail reads them from the same
   * `payments` columns as any counter payment.
   *
   * Once the order is fully paid it is handed to the invoice emitter
   * (`OrderFlowService.invoicePaidBookingRentalOrder`), after commit.
   */
  async settlePaidRequest(event: PaymentRequestPaidEvent): Promise<void> {
    const bookingId = bookingIdFromRentalPurpose(event.purpose);
    if (bookingId == null) return;
    const storeId = event.store_id;
    const booking = await this.loadBookingForPayment(storeId, bookingId);
    if (!booking) return;
    if (booking.status === 'cancelled' || booking.status === 'no_show') {
      const when = booking.status === 'no_show' ? 'después de marcarse como no asistencia' : 'después de cancelarse';
      await this.alertAdmin(
        storeId,
        booking.status === 'no_show'
          ? 'Cobro para reservar recibido en una reserva sin asistencia'
          : 'Cobro para reservar recibido en una reserva cancelada',
        `El cliente pagó el cobro de la reserva ${booking.booking_number} ${when}. Devuélvelo o reagenda.`,
        { booking_id: bookingId },
      );
      return;
    }
    const method = event.method === 'wompi' ? 'wompi' : event.method === 'transfer' ? 'bank_transfer' : 'cash';
    const tag = await this.resolveRequestPaymentTag(storeId, event.payment_request_id, method);
    // S14: a transfer an administrator confirmed is cash flow of that user (the gate ran in `confirm`).
    // Wompi and customer pages carry no staff user: no movement.
    const confirmer = method !== 'wompi' ? (event.confirmed_by_user_id ?? null) : null;
    const confirmerSession = confirmer ? await this.openCashSessionFor(storeId, confirmer, method) : null;
    const movements = confirmerSession != null ? this.moduleRef?.get(MovementsService, { strict: false }) : null;
    await this.registerPrepayPayment({
      storeId,
      booking,
      amount: new Prisma.Decimal(event.amount),
      accountingMethod: method,
      transactionId: `SVC-RENTAL-PR-${event.payment_request_id}`,
      storePaymentMethodId: tag.storePaymentMethodId,
      bankAccountId: tag.bankAccountId,
      receiptS3Key: tag.receiptS3Key,
      receiptUploadedAt: tag.receiptUploadedAt,
      gateway: { payment_request_id: event.payment_request_id, method, ...(tag.reference ? { reference: tag.reference } : {}) },
      alertLatePayment: true,
      inTx: async (tx, ctx) => {
        if (confirmerSession != null && movements && confirmer) {
          await movements.recordSaleMovement(
            confirmerSession,
            { store_id: storeId, user_id: confirmer, amount: event.amount, payment_method: method, order_id: ctx.orderId, payment_id: ctx.paymentId },
            tx,
          );
        }
      },
    });
  }

  private loadBookingForPayment(storeId: number, bookingId: number): Promise<BookingForPayment | null> {
    return this.prisma.bookings.findFirst({
      where: { id: bookingId, store_id: storeId },
      select: {
        id: true,
        status: true,
        order_id: true,
        customer_id: true,
        booking_number: true,
        channel: true,
        product_id: true,
        product_variant_id: true,
        quoted_amount: true,
      },
    });
  }

  /**
   * Method, bank account and receipt a settled request leaves on the payment. A transfer carries what the
   * customer chose on the payment page (method + receipt); the account is the method's only configured
   * account (several accounts: unassigned, the admin cannot be guessed). Wompi keeps the store's Wompi method.
   */
  private async resolveRequestPaymentTag(
    storeId: number,
    paymentRequestId: number,
    method: string,
  ): Promise<{
    storePaymentMethodId: number | null;
    bankAccountId: number | null;
    receiptS3Key: string | null;
    receiptUploadedAt: Date | null;
    reference: string | null;
  }> {
    const empty = { storePaymentMethodId: null, bankAccountId: null, receiptS3Key: null, receiptUploadedAt: null, reference: null };
    if (method === 'wompi') {
      const wompi = await this.prisma.store_payment_methods.findFirst({
        where: { store_id: storeId, state: 'enabled', system_payment_method: { type: 'wompi' } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      return { ...empty, storePaymentMethodId: wompi?.id ?? null };
    }
    if (method !== 'bank_transfer') return empty;
    const request = await this.prisma.payment_requests.findFirst({
      where: { id: paymentRequestId },
      select: {
        transfer_store_payment_method_id: true,
        transfer_receipt_s3_key: true,
        transfer_submitted_at: true,
        transfer_reference: true,
      },
    });
    if (!request) return empty;
    let bankAccountId: number | null = null;
    if (request.transfer_store_payment_method_id != null) {
      const row = await this.prisma.store_payment_methods.findFirst({
        where: { id: request.transfer_store_payment_method_id, store_id: storeId },
        select: { custom_config: true },
      });
      const accounts = (row?.custom_config as { accounts?: Array<{ id?: unknown }> } | null)?.accounts;
      const ids = Array.isArray(accounts)
        ? accounts.map((a) => a?.id).filter((id): id is number => typeof id === 'number' && id > 0)
        : [];
      if (ids.length === 1 && accounts?.length === 1) bankAccountId = ids[0];
    }
    return {
      storePaymentMethodId: request.transfer_store_payment_method_id ?? null,
      bankAccountId,
      receiptS3Key: request.transfer_receipt_s3_key ?? null,
      receiptUploadedAt: request.transfer_receipt_s3_key ? (request.transfer_submitted_at ?? new Date()) : null,
      reference: request.transfer_reference ?? null,
    };
  }

  /**
   * The ONE place a prepay payment is registered on the booking's order and the booking is confirmed:
   * the settlement of a paid payment request and the in-person "Registrar pago" both call it (S2).
   * Opens the order when the booking has none, locks it, writes the payment (idempotent by
   * `transactionId`), moves the order totals, confirms a held slot, then emits `payment.received`,
   * hands a fully paid order to the invoice emitter and announces `booking.rental_prepay_paid`.
   * `inTx` runs inside the same transaction after the payment exists (cash movement, request cancel).
   */
  private async registerPrepayPayment(args: RegisterPrepayArgs): Promise<{ registered: boolean; fullyPaid: boolean }> {
    const { storeId, booking, amount, accountingMethod: method } = args;
    const bookingId = booking.id;
    const orderId = booking.order_id ?? (await this.createRentalOrder(booking));

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND store_id = ${storeId} FOR UPDATE`;
      const duplicate = await tx.payments.findFirst({ where: { transaction_id: args.transactionId }, select: { id: true } });
      if (duplicate) return null;
      const order = await tx.orders.findUnique({
        where: { id: orderId },
        include: { payments: { select: { amount: true, state: true } } },
      });
      if (!order) return null;
      // A cancelled rental order takes no payment and is never invoiced (the session was cancelled under it).
      if (order.state === 'cancelled') return { cancelledOrder: true as const };
      const remainingCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
      // An in-person charge never pays more than the order still owes (a double submit finds nothing left).
      if (args.rejectIfExceedsRemaining && toCents(amount) > remainingCents) {
        throw new VendixHttpException(ErrorCodes.STATION_BOOKING_015);
      }
      const nextRemaining = Math.max(0, remainingCents - toCents(amount));
      const now = new Date();
      const payment = await tx.payments.create({
        data: {
          order_id: orderId,
          customer_id: order.customer_id,
          amount,
          currency: order.currency ?? 'COP',
          state: 'succeeded',
          paid_at: now,
          transaction_id: args.transactionId,
          store_payment_method_id: args.storePaymentMethodId,
          bank_account_id: args.bankAccountId,
          receipt_s3_key: args.receiptS3Key ?? null,
          receipt_uploaded_at: args.receiptS3Key ? (args.receiptUploadedAt ?? now) : null,
          gateway_response: { service_rental: { booking_id: bookingId, method, ...args.gateway } },
          updated_at: now,
        },
      });
      await tx.orders.update({
        where: { id: orderId },
        data: {
          total_paid: { increment: amount },
          remaining_balance: new Prisma.Decimal(nextRemaining).div(100),
          updated_at: now,
        },
      });
      await this.orderHistory.record(tx, {
        orderId,
        storeId,
        type: 'payment_registered',
        paymentId: payment.id,
        amount: Number(amount),
      });

      // The held slot is confirmed by the payment; a released slot (late payment) is not retaken here.
      const allocation = await tx.service_allocations.findFirst({
        where: { store_id: storeId, booking_id: bookingId },
        orderBy: { id: 'desc' },
        select: { id: true, state: true },
      });
      let slotConfirmed = false;
      if (booking.status === 'pending' && allocation && ['held', 'payment_pending'].includes(allocation.state)) {
        await tx.service_allocations.updateMany({
          where: { store_id: storeId, booking_id: bookingId, state: { in: ['held', 'payment_pending'] } },
          data: { state: 'confirmed', expires_at: null, updated_at: now },
        });
        await tx.bookings.updateMany({
          where: { id: bookingId, status: 'pending' },
          data: { status: booking_status_enum.confirmed, expires_at: null, updated_at: now },
        });
        slotConfirmed = true;
      }
      if (args.inTx) await args.inTx(tx, { orderId, paymentId: payment.id });
      // A partial payment recognises only its share of the sale; with the whole order's totals the
      // auto-entry would credit more than it debits and drop the unbalanced entry.
      const sale_share = await resolvePaymentReceivedSaleFields(tx, {
        order_id: orderId,
        payment_id: payment.id,
        amount: Number(amount),
      });
      return { cancelledOrder: false as const, order, payment, fullyPaid: nextRemaining === 0, slotConfirmed, sale_share };
    });
    if (!outcome) return { registered: false, fullyPaid: false };
    if (outcome.cancelledOrder) {
      await this.alertAdmin(
        storeId,
        'Cobro para reservar recibido en una orden cancelada',
        `El cliente pagó el cobro de la reserva ${booking.booking_number} y su orden ya estaba cancelada. No se registró el pago: devuélvelo o reagenda.`,
        { booking_id: bookingId, order_id: orderId },
      );
      return { registered: false, fullyPaid: false };
    }

    await this.emitPaymentReceived(outcome.order, outcome.payment.id, amount, method, outcome.sale_share);
    if (outcome.fullyPaid) await this.invoiceRentalOrder(orderId);
    this.eventEmitter.emit('booking.rental_prepay_paid', {
      store_id: storeId,
      booking_id: bookingId,
      order_id: orderId,
      fully_paid: outcome.fullyPaid,
    });
    if (args.alertLatePayment && booking.status === 'pending' && !outcome.slotConfirmed) {
      await this.alertAdmin(
        storeId,
        'Cobro recibido, el horario ya no está libre',
        `El cliente pagó la reserva ${booking.booking_number} después de vencer el apartado. El pago quedó en la orden: reagenda o devuelve.`,
        { booking_id: bookingId, order_id: orderId },
      );
    }
    return { registered: true, fullyPaid: outcome.fullyPaid };
  }


  /**
   * D6: the rental order is a sale of its own. Once fully paid it goes to the
   * invoice emitter (lazy lookup: order-flow's module must not be imported
   * here). The payment is already committed, so a failure is only logged.
   */
  private async invoiceRentalOrder(orderId: number): Promise<void> {
    try {
      await this.moduleRef?.get(OrderFlowService, { strict: false })?.invoicePaidBookingRentalOrder(orderId);
    } catch (error) {
      this.logger.error(`[rental prepay invoice] order=${orderId}: ${(error as Error).message}`);
    }
  }

  /** An online hold has no order yet: the first payment opens it with the frozen quote. */
  private async createRentalOrder(booking: {
    id: number;
    customer_id: number | null;
    booking_number: string;
    channel: string;
    product_id: number;
    product_variant_id: number | null;
    quoted_amount: unknown;
  }): Promise<number> {
    const product = await this.prisma.products.findFirst({
      where: { id: booking.product_id },
      select: { name: true },
    });
    const unitPrice = Number(booking.quoted_amount ?? 0);
    const created = await this.ordersService.create(
      {
        customer_id: booking.customer_id ?? undefined,
        items: [
          {
            product_id: booking.product_id,
            product_variant_id: booking.product_variant_id ?? undefined,
            booking_id: booking.id,
            product_name: product?.name || 'Alquiler',
            quantity: 1,
            unit_price: unitPrice,
            total_price: unitPrice,
          },
        ],
        subtotal: unitPrice,
        total_amount: unitPrice,
        internal_notes: `Reserva ${booking.booking_number}`,
        channel: booking.channel,
        skip_schedule_validation: true,
      } as never,
      RequestContextService.getUserId() ?? undefined,
    );
    const linked = await this.prisma.bookings.findFirst({
      where: { id: booking.id },
      select: { order_id: true },
    });
    return linked?.order_id ?? (created as { id: number }).id;
  }

  /** `payment.received` of the sale payment (cash/bank/Wompi accounting, never the wallet). */
  private async emitPaymentReceived(
    order: { id: number; order_number: string; store_id: number; customer_id: number | null; subtotal_amount: unknown; tip_amount: unknown; currency: string | null },
    paymentId: number,
    amount: Prisma.Decimal,
    method: string,
    sale_share: PaymentReceivedSaleFields,
  ): Promise<void> {
    const items = await this.prisma.order_items.findMany({
      where: { order_id: order.id, cancelled_at: null },
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
      order: order as never,
      order_items: items,
    });
    const currency = order.currency ?? 'COP';
    for (const payload of buildPaymentReceivedEvents({
      order: {
        id: order.id,
        order_number: order.order_number,
        store_id: order.store_id,
        organization_id: RequestContextService.getContext()?.organization_id ?? null,
        customer_id: order.customer_id,
        subtotal_amount: order.subtotal_amount,
        tip_amount: order.tip_amount,
      },
      sale_tax,
      payments: [{ id: paymentId, amount, currency, accounting_method: method, sale_share }],
      currency,
      user_id: RequestContextService.getUserId() ?? null,
    })) {
      this.eventEmitter.emit('payment.received', payload);
    }
  }
}
