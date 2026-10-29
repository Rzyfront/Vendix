import { HttpException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { S3Service } from '@common/services/s3.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { EmailService } from '../../../../../email/email.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { PaymentLinksService } from '../../../payment-links/payment-links.service';
import { mergeStoreSettingsWithDefaults } from '../../../settings/defaults/default-store-settings';
import { LODGING_AMENITIES } from '../../unit-types/lodging-media';
import { asPolicySnapshot } from '../../rates/lodging-cancellation-penalty';
import { LodgingReservationsService } from '../reservations.service';
import { stayNights } from '../stay-dates';
import { BookingSearchDto, CreateBookingHoldDto } from './booking-engine.dto';
import {
  amountDueNow,
  bookingConfirmationEmail,
  bookingHoldMinutes,
  holdExpiry,
  policyText,
} from './booking-engine-text';

/**
 * The Wompi link and the hold end at the same moment; a payment made in the
 * last minute can confirm a little later. The hold is released only this
 * long after it expires, so a late webhook still finds it.
 */
export const HOLD_PAYMENT_GRACE_MS = 5 * 60_000;

/** History line of a web booking waiting for its payment. */
export const WEB_HOLD_REASON = 'Reserva web: pendiente de pago en línea';
export const WEB_HOLD_EXPIRED_REASON = 'Reserva web vencida sin pago';
const WEB_HOLD_REPLACED_REASON = 'Reserva web reemplazada por una nueva del mismo huésped';

/** Payload of `lodging.reservation_payment.received` (DR bank / CR 2805). */
export interface ReservationPaymentReceivedEvent {
  store_id: number;
  reservation_payment_id: number;
  reservation_number: string;
  amount: number;
  customer_id: number;
}

interface HotelSettings {
  check_in_time: string;
  check_out_time: string;
  hold_minutes: number;
  currency: string;
}

/** A room type as the traveler sees it in the search results. */
export interface BookableRoomType {
  id: number;
  name: string;
  description: string | null;
  bed_config: string | null;
  max_adults: number;
  max_children: number;
  max_occupancy: number;
  /** Signed photo URLs. */
  images: string[];
  amenities: Array<{ code: string; label: string }>;
  available: number;
  bookable: boolean;
  unavailable_reason: string | null;
  rate_plan: { id: number; name: string } | null;
  total_amount: string;
  nightly_average: string;
  amount_due_now: string;
  deposit_percent: string;
  cancellation_policy: string | null;
}

const AMENITY_LABELS = new Map<string, string>(LODGING_AMENITIES.map((a) => [a.code, a.label]));

/**
 * Hospitality Suite (H6.6) — the hotel's own booking engine in the
 * storefront.
 *
 * The traveler searches dates and guests and sees each room type with its
 * photos, total and policy, priced like the desk (default rate plan, or the
 * room type base price) and filtered by availability and restrictions (H2.3).
 * "Reservar" holds one room as a `tentative` reservation for
 * `hospitality.booking_hold_minutes` and opens a single-use Wompi payment
 * link for the deposit (or the whole stay when the plan asks none).
 *
 * The payment is a DIRECT payment of the reservation (owner decision D3),
 * never a deposit: it lives in `lodging_reservation_payments`, not in the
 * wallet. When Wompi confirms it (`payment_link.paid`) the reservation is
 * confirmed, the payment booked DR bank / CR 2805 and the guest emailed; the
 * check-out applies it to the folio. An unpaid hold expires and frees its
 * nights (`BookingHoldExpiryJob`).
 */
@Injectable()
export class LodgingBookingEngineService {
  private readonly logger = new Logger(LodgingBookingEngineService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservations: LodgingReservationsService,
    private readonly paymentLinks: PaymentLinksService,
    private readonly s3: S3Service,
    private readonly email: EmailService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storeContextRunner: StoreContextRunner,
  ) {}

  // ---------------------------------------------------------------- search

  /**
   * Room types that fit the guests, with price, policy and availability.
   * Desk callers (Vexi, H9) pass the guest so their allotment counts, as in
   * the reservation form, and skip signing the photos they do not show.
   */
  async search(dto: BookingSearchDto, options: { customer_id?: number; with_images?: boolean } = {}) {
    const with_images = options.with_images ?? true;
    const store_id = this.requireStoreId();
    const nights = stayNights(dto.arrival_date, dto.departure_date);
    await this.assertNotPast(store_id, dto.arrival_date);
    const settings = await this.loadSettings(store_id);
    const children = dto.children ?? 0;
    const plan_id = await this.defaultPlanId();

    const types = await this.prisma.lodging_unit_types.findMany({
      where: {
        is_active: true,
        max_adults: { gte: dto.adults },
        max_children: { gte: children },
        max_occupancy: { gte: dto.adults + children },
      },
      select: {
        id: true,
        name: true,
        description: true,
        bed_config: true,
        max_adults: true,
        max_children: true,
        max_occupancy: true,
        images: true,
        amenities: true,
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });

    const room_types: BookableRoomType[] = [];
    for (const type of types) {
      const quote = await this.quoteType(type.id, dto, plan_id, options.customer_id);
      if (!quote) continue;
      const total = new Prisma.Decimal(quote.total_amount);
      const percent = new Prisma.Decimal(quote.deposit_percent);
      const reason =
        quote.restrictions.length > 0
          ? quote.restrictions.join('. ')
          : quote.available < 1
            ? 'Sin disponibilidad para esas fechas'
            : null;
      room_types.push({
        id: type.id,
        name: type.name,
        description: type.description,
        bed_config: type.bed_config,
        max_adults: type.max_adults,
        max_children: type.max_children,
        max_occupancy: type.max_occupancy,
        images: with_images
          ? (await Promise.all(type.images.map((key) => this.s3.signUrl(key)))).filter(
              (url): url is string => !!url,
            )
          : [],
        amenities: type.amenities.map((code) => ({ code, label: AMENITY_LABELS.get(code) ?? code })),
        available: Math.max(0, quote.available),
        bookable: reason === null,
        unavailable_reason: reason,
        rate_plan: quote.rate_plan,
        total_amount: total.toFixed(2),
        nightly_average: total.div(nights.length).toDecimalPlaces(2).toFixed(2),
        amount_due_now: amountDueNow(total, percent).toFixed(2),
        deposit_percent: percent.toString(),
        cancellation_policy: policyText(asPolicySnapshot(quote.cancellation_policy)),
      });
    }
    return {
      arrival_date: dto.arrival_date,
      departure_date: dto.departure_date,
      nights: nights.length,
      check_in_time: settings.check_in_time,
      check_out_time: settings.check_out_time,
      hold_minutes: settings.hold_minutes,
      currency: settings.currency,
      room_types,
    };
  }

  // ------------------------------------------------------------------ hold

  /**
   * "Reservar": holds one room as tentative and opens its Wompi payment
   * link. A guest keeps one web hold: a previous unpaid one is released.
   */
  async hold(customer_id: number, dto: CreateBookingHoldDto) {
    const store_id = this.requireStoreId();
    stayNights(dto.arrival_date, dto.departure_date);
    await this.assertNotPast(store_id, dto.arrival_date);
    const settings = await this.loadSettings(store_id);

    const previous = await this.prisma.lodging_reservations.findMany({
      where: { customer_id, status: 'tentative', hold_expires_at: { not: null } },
      select: { id: true },
    });
    for (const { id } of previous) await this.releaseWebHold(id, WEB_HOLD_REPLACED_REASON);

    const quote = await this.quoteType(dto.unit_type_id, dto, await this.defaultPlanId());
    if (!quote) throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);

    const expires_at = holdExpiry(new Date(), settings.hold_minutes);
    // Availability, capacity and restrictions are checked again under the
    // store sale lock: a full type fails here with its own message.
    const reservation = await this.reservations.create(
      {
        arrival_date: dto.arrival_date,
        departure_date: dto.departure_date,
        customer_id,
        notes: dto.notes,
        rooms: [
          {
            unit_type_id: dto.unit_type_id,
            adults: dto.adults,
            children: dto.children ?? 0,
            rate_plan_id: quote.rate_plan?.id,
          },
        ],
      },
      { expires_at, reason: WEB_HOLD_REASON },
    );
    const room = reservation.rooms[0];
    const amount = amountDueNow(
      new Prisma.Decimal(reservation.total_amount),
      new Prisma.Decimal(room.deposit_percent),
    );

    let link: { id: number; checkout_url: string } | undefined;
    try {
      const created = await this.paymentLinks.create({
        name: `Reserva ${reservation.reservation_number}`,
        description: `Pago de la reserva ${reservation.reservation_number} · ${room.unit_type.name}`,
        single_use: true,
        collect_shipping: false,
        amount_in_cents: Math.round(Number(amount) * 100),
        currency: settings.currency,
        expires_at: expires_at.toISOString(),
        redirect_url: `${dto.return_url.replace(/\/+$/, '')}/${reservation.id}`,
      });
      link = created.data;
    } catch (err: unknown) {
      this.logger.warn(
        `Booking ${reservation.reservation_number}: payment link failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!link?.id) {
      await this.releaseWebHold(reservation.id, 'No se pudo iniciar el pago en línea');
      throw new VendixHttpException(
        ErrorCodes.LODGING_BOOKING_001,
        'No pudimos iniciar el pago en línea. Intenta de nuevo o contacta al hotel.',
      );
    }
    await this.prisma.lodging_reservation_payments.create({
      data: {
        store_id,
        reservation_id: reservation.id,
        status: 'pending',
        amount,
        method: 'wompi_link',
        payment_link_id: link.id,
      },
    });
    return {
      reservation_id: reservation.id,
      reservation_number: reservation.reservation_number,
      hold_expires_at: expires_at,
      amount_due: amount.toFixed(2),
      checkout_url: link.checkout_url,
    };
  }

  // ------------------------------------------------------- traveler status

  /** The traveler's own web reservation (other customers' ones are 404). */
  async findForCustomer(id: number, customer_id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id, customer_id },
      select: {
        id: true,
        reservation_number: true,
        status: true,
        arrival_date: true,
        departure_date: true,
        total_amount: true,
        hold_expires_at: true,
        rooms: {
          where: { cancelled_at: null },
          select: { adults: true, children: true, unit_type: { select: { name: true } } },
          orderBy: { id: 'asc' },
        },
        online_payments: {
          select: {
            status: true,
            amount: true,
            payment_link: { select: { checkout_url: true } },
          },
          orderBy: { id: 'desc' },
          take: 1,
        },
      },
    });
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_BOOKING_FIND_001);
    const arrival = reservation.arrival_date.toISOString().slice(0, 10);
    const departure = reservation.departure_date.toISOString().slice(0, 10);
    const payment = reservation.online_payments[0] ?? null;
    const open = reservation.status === 'tentative' && payment?.status === 'pending';
    return {
      id: reservation.id,
      reservation_number: reservation.reservation_number,
      status: reservation.status,
      arrival_date: arrival,
      departure_date: departure,
      nights: stayNights(arrival, departure).length,
      room_type: reservation.rooms.map((room) => room.unit_type.name).join(', '),
      adults: reservation.rooms.reduce((sum, room) => sum + room.adults, 0),
      children: reservation.rooms.reduce((sum, room) => sum + room.children, 0),
      total_amount: new Prisma.Decimal(reservation.total_amount).toFixed(2),
      amount_due: payment ? new Prisma.Decimal(payment.amount).toFixed(2) : '0.00',
      paid_amount:
        payment?.status === 'completed' ? new Prisma.Decimal(payment.amount).toFixed(2) : '0.00',
      payment_status: payment?.status ?? null,
      hold_expires_at: reservation.hold_expires_at,
      checkout_url: open ? (payment?.payment_link?.checkout_url ?? null) : null,
    };
  }

  // ---------------------------------------------------------------- payment

  /** Wompi confirmed a payment link: complete the reservation it pays. */
  @OnEvent('payment_link.paid')
  async onPaymentLinkPaid(event: {
    payment_link_id: number;
    store_id: number;
    transaction_id?: string | null;
  }) {
    try {
      await this.storeContextRunner.runInStoreContext(event.store_id, () =>
        this.completePayment(event.payment_link_id, event.transaction_id ?? null),
      );
    } catch (err: unknown) {
      this.logger.error(
        `Reservation payment for link ${event.payment_link_id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Idempotent: a repeated webhook finds the payment already completed.
   * The payment is recorded even when the hold already expired or was
   * replaced (its payment `cancelled`, but the Wompi link may still be paid):
   * then the reservation stays cancelled and its history tells the desk to
   * refund it.
   */
  async completePayment(payment_link_id: number, transaction_id: string | null): Promise<boolean> {
    const store_id = this.requireStoreId();
    const pending = await this.prisma.lodging_reservation_payments.findFirst({
      where: { payment_link_id, status: { in: ['pending', 'cancelled'] } },
      select: {
        id: true,
        status: true,
        amount: true,
        reservation: { select: { id: true, reservation_number: true, customer_id: true } },
      },
    });
    if (!pending) return false;
    const now = new Date();
    const claimed = await this.prisma.lodging_reservation_payments.updateMany({
      where: { id: pending.id, status: pending.status },
      data: {
        status: 'completed',
        paid_at: now,
        transaction_id: transaction_id?.slice(0, 255) ?? null,
        updated_at: now,
      },
    });
    if (claimed.count !== 1) return false;

    const { reservation } = pending;
    const amount = Number(pending.amount);
    this.eventEmitter.emit('lodging.reservation_payment.received', {
      store_id,
      reservation_payment_id: pending.id,
      reservation_number: reservation.reservation_number,
      amount,
      customer_id: reservation.customer_id,
    } satisfies ReservationPaymentReceivedEvent);

    const settings = await this.loadSettings(store_id);
    const paidText = formatMoney(amount, settings.currency);
    const confirmed = await this.reservations.confirmHold(
      reservation.id,
      `Pago en línea recibido ${paidText} (Wompi)`,
    );
    if (!confirmed) {
      const current = await this.prisma.lodging_reservations.findFirst({
        where: { id: reservation.id },
        select: { status: true },
      });
      // The desk may have confirmed the hold by hand: the stay stands and
      // the payment counts for it; only a cancelled one is owed back.
      const lost = !current || current.status === 'cancelled' || current.status === 'no_show';
      if (current) {
        await this.prisma.lodging_reservation_events.create({
          data: {
            store_id,
            reservation_id: reservation.id,
            from_status: current.status,
            to_status: current.status,
            reason: lost
              ? `Pago en línea recibido ${paidText} con la reserva ya vencida: devuélvelo al huésped o crea la reserva de nuevo`
              : `Pago en línea recibido ${paidText} (Wompi)`,
            user_id: null,
          },
        });
      }
      if (lost) {
        this.logger.warn(`Payment ${pending.id} arrived for reservation ${reservation.id} no longer held`);
        return true;
      }
    }
    await this.sendConfirmation(reservation.id, store_id, settings, amount);
    return true;
  }

  // ----------------------------------------------------------------- expiry

  /** Unpaid web holds whose time ran out free their nights. Returns how many. */
  async expireHolds(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.lodging_reservations.findMany({
      where: {
        status: 'tentative',
        hold_expires_at: { lt: new Date(now.getTime() - HOLD_PAYMENT_GRACE_MS) },
        // A payment already confirmed wins over the clock.
        online_payments: { none: { status: 'completed' } },
      },
      select: { id: true },
    });
    let released = 0;
    for (const { id } of expired) {
      if (await this.releaseWebHold(id, WEB_HOLD_EXPIRED_REASON)) released += 1;
    }
    return released;
  }

  /** Cancels the hold (no penalty), its pending payment and its link. */
  private async releaseWebHold(reservation_id: number, reason: string): Promise<boolean> {
    const released = await this.reservations.releaseHold(reservation_id, reason);
    if (!released) return false;
    const pending = await this.prisma.lodging_reservation_payments.findMany({
      where: { reservation_id, status: 'pending' },
      select: { id: true, payment_link_id: true },
    });
    if (pending.length === 0) return true;
    const now = new Date();
    await this.prisma.lodging_reservation_payments.updateMany({
      where: { id: { in: pending.map((p) => p.id) }, status: 'pending' },
      data: { status: 'cancelled', updated_at: now },
    });
    const linkIds = pending.map((p) => p.payment_link_id).filter((id): id is number => id != null);
    if (linkIds.length > 0) {
      // The Wompi link expires with the hold; this keeps the store's list honest.
      await this.prisma.payment_links.updateMany({
        where: { id: { in: linkIds }, status: 'active' },
        data: { status: 'cancelled', updated_at: now },
      });
    }
    return true;
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Desk quote of one room of the type, priced with the default plan; a
   * type the plan does not price falls back to its base price. Null when
   * the type cannot be sold online (missing, inactive or too small).
   */
  private async quoteType(
    unit_type_id: number,
    dto: BookingSearchDto,
    plan_id: number | undefined,
    customer_id?: number,
  ) {
    const input = {
      unit_type_id,
      ...(customer_id ? { customer_id } : {}),
      arrival_date: dto.arrival_date,
      departure_date: dto.departure_date,
      adults: dto.adults,
      children: dto.children ?? 0,
    };
    try {
      return await this.reservations.quote({ ...input, rate_plan_id: plan_id });
    } catch (err: unknown) {
      const code = errorCode(err);
      if (plan_id != null && code === ErrorCodes.LODGING_RATE_PLAN_UNPRICED_001.code) {
        return this.reservations.quote(input);
      }
      if (
        code === ErrorCodes.LODGING_UNIT_TYPE_FIND_001.code ||
        code === ErrorCodes.LODGING_RESERVATION_TYPE_001.code ||
        code === ErrorCodes.LODGING_RESERVATION_CAPACITY_001.code
      ) {
        return null;
      }
      throw err;
    }
  }

  private async defaultPlanId(): Promise<number | undefined> {
    const plan = await this.prisma.lodging_rate_plans.findFirst({
      where: { is_default: true, is_active: true },
      select: { id: true },
    });
    return plan?.id;
  }

  /** The traveler cannot book a night that already passed (store date). */
  private async assertNotPast(store_id: number, arrival_date: string): Promise<void> {
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    if (arrival_date < today) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_BOOKING_001,
        'La llegada no puede ser una fecha pasada',
      );
    }
  }

  private async loadSettings(store_id: number): Promise<HotelSettings> {
    const row = await this.prisma.store_settings.findFirst({
      where: { store_id },
      select: { settings: true },
    });
    const settings = mergeStoreSettingsWithDefaults(row?.settings);
    const hospitality = (settings?.hospitality ?? {}) as {
      check_in_time?: string;
      check_out_time?: string;
      booking_hold_minutes?: number;
    };
    return {
      check_in_time: hospitality.check_in_time || '15:00',
      check_out_time: hospitality.check_out_time || '12:00',
      hold_minutes: bookingHoldMinutes(hospitality.booking_hold_minutes),
      currency: settings?.general?.currency || 'COP',
    };
  }

  /** Never throws: a failed email must not undo a confirmed payment. */
  private async sendConfirmation(
    reservation_id: number,
    store_id: number,
    settings: HotelSettings,
    paid: number,
  ): Promise<void> {
    try {
      const reservation = await this.prisma.lodging_reservations.findFirst({
        where: { id: reservation_id },
        select: {
          reservation_number: true,
          arrival_date: true,
          departure_date: true,
          total_amount: true,
          customer: { select: { email: true, first_name: true } },
          store: { select: { name: true } },
          rooms: {
            where: { cancelled_at: null },
            select: {
              adults: true,
              children: true,
              cancellation_policy_snapshot: true,
              unit_type: { select: { name: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
      });
      const to = reservation?.customer.email;
      if (!reservation || !to) return;
      const arrival = reservation.arrival_date.toISOString().slice(0, 10);
      const departure = reservation.departure_date.toISOString().slice(0, 10);
      const total = Number(reservation.total_amount);
      const room = reservation.rooms[0];
      const message = bookingConfirmationEmail({
        guest_name: reservation.customer.first_name?.trim() || 'Hola',
        store_name: reservation.store?.name ?? 'el hotel',
        reservation_number: reservation.reservation_number,
        arrival_date: arrival,
        departure_date: departure,
        nights: stayNights(arrival, departure).length,
        room_type: reservation.rooms.map((r) => r.unit_type.name).join(', '),
        adults: room?.adults ?? 1,
        children: room?.children ?? 0,
        total: formatMoney(total, settings.currency),
        paid: formatMoney(paid, settings.currency),
        balance: formatMoney(Math.max(0, total - paid), settings.currency),
        check_in_time: settings.check_in_time,
        check_out_time: settings.check_out_time,
        policy: policyText(asPolicySnapshot(room?.cancellation_policy_snapshot)),
      });
      const result = await this.email.sendEmail(to, message.subject, message.html, message.text);
      if (!result.success) {
        this.logger.error(`Booking confirmation for reservation ${reservation_id} not sent: ${result.error}`);
      }
    } catch (err: unknown) {
      this.logger.error(
        `Booking confirmation for reservation ${reservation_id} (store ${store_id}) failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const code = (err as { errorCode?: unknown }).errorCode;
  return typeof code === 'string' ? code : undefined;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
