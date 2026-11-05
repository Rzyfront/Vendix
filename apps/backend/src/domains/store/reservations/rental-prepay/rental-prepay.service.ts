import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
   * Once the order is fully paid it is handed to the invoice emitter
   * (`OrderFlowService.invoicePaidBookingRentalOrder`), after commit.
   */
  async settlePaidRequest(event: PaymentRequestPaidEvent): Promise<void> {
    const bookingId = bookingIdFromRentalPurpose(event.purpose);
    if (bookingId == null) return;
    const storeId = event.store_id;
    const booking = await this.prisma.bookings.findFirst({
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
    const orderId = booking.order_id ?? (await this.createRentalOrder(booking));
    const method = event.method === 'wompi' ? 'wompi' : event.method === 'transfer' ? 'bank_transfer' : 'cash';
    const amount = new Prisma.Decimal(event.amount);
    const transactionId = `SVC-RENTAL-PR-${event.payment_request_id}`;

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} AND store_id = ${storeId} FOR UPDATE`;
      const duplicate = await tx.payments.findFirst({ where: { transaction_id: transactionId }, select: { id: true } });
      if (duplicate) return null;
      const order = await tx.orders.findUnique({
        where: { id: orderId },
        include: { payments: { select: { amount: true, state: true } } },
      });
      if (!order) return null;
      // A cancelled rental order takes no payment and is never invoiced (the session was cancelled under it).
      if (order.state === 'cancelled') return { cancelledOrder: true as const };
      const remainingCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
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
          transaction_id: transactionId,
          gateway_response: {
            service_rental: { booking_id: bookingId, payment_request_id: event.payment_request_id, method },
          },
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
      // A partial payment recognises only its share of the sale; with the whole order's totals the
      // auto-entry would credit more than it debits and drop the unbalanced entry.
      const sale_share = await resolvePaymentReceivedSaleFields(tx, {
        order_id: orderId,
        payment_id: payment.id,
        amount: Number(amount),
      });
      return { cancelledOrder: false as const, order, payment, fullyPaid: nextRemaining === 0, slotConfirmed, sale_share };
    });
    if (!outcome) return;
    if (outcome.cancelledOrder) {
      await this.alertAdmin(
        storeId,
        'Cobro para reservar recibido en una orden cancelada',
        `El cliente pagó el cobro de la reserva ${booking.booking_number} y su orden ya estaba cancelada. No se registró el pago: devuélvelo o reagenda.`,
        { booking_id: bookingId, order_id: orderId },
      );
      return;
    }

    await this.emitPaymentReceived(outcome.order, outcome.payment.id, amount, method, outcome.sale_share);
    if (outcome.fullyPaid) await this.invoiceRentalOrder(orderId);
    this.eventEmitter.emit('booking.rental_prepay_paid', {
      store_id: storeId,
      booking_id: bookingId,
      order_id: orderId,
      fully_paid: outcome.fullyPaid,
    });
    if (booking.status === 'pending' && !outcome.slotConfirmed) {
      await this.alertAdmin(
        storeId,
        'Cobro recibido, el horario ya no está libre',
        `El cliente pagó la reserva ${booking.booking_number} después de vencer el apartado. El pago quedó en la orden: reagenda o devuelve.`,
        { booking_id: bookingId, order_id: orderId },
      );
    }
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
