import { Injectable } from '@nestjs/common';
import { lodging_reservation_status_enum, Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import {
  dateOnlyString,
  localDateString,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from '../stay-dates';

const FRONT_DESK_SELECT = {
  id: true,
  reservation_number: true,
  status: true,
  arrival_date: true,
  departure_date: true,
  customer: { select: { first_name: true, last_name: true } },
  rooms: {
    where: { cancelled_at: null },
    select: {
      adults: true,
      children: true,
      unit_type: { select: { name: true } },
      unit: { select: { code: true } },
    },
    orderBy: { id: 'asc' },
  },
  folio: {
    select: {
      id: true,
      status: true,
      order: { select: { id: true, grand_total: true, total_paid: true } },
    },
  },
} satisfies Prisma.lodging_reservationsSelect;

type FrontDeskReservation = Prisma.lodging_reservationsGetPayload<{
  select: typeof FRONT_DESK_SELECT;
}>;

export interface FrontDeskRow {
  id: number;
  reservation_number: string;
  status: lodging_reservation_status_enum;
  arrival_date: string;
  departure_date: string;
  guest_name: string;
  /** "101 · Doble, Sin asignar · Suite". */
  rooms: string;
  /** Active rooms without a physical room yet: check-in must pick them first. */
  unassigned_rooms: number;
  adults: number;
  children: number;
  folio_id: number | null;
  /** Folio balance (charges − payments); null without a folio. */
  balance: string | null;
}

export interface FrontDeskBoard {
  /** Store business day the board is for (`YYYY-MM-DD`). */
  business_date: string;
  arrivals: FrontDeskRow[];
  departures: FrontDeskRow[];
  in_house: FrontDeskRow[];
}

/**
 * Splits the candidate reservations into the three front desk lists of the
 * store business day `today`:
 * - arrivals: confirmed, arriving today or earlier (a late arrival is still
 *   checked in until the no-show job moves it).
 * - departures: in house, leaving today or earlier (overdue check-outs).
 * - in house: every checked-in reservation, departures included.
 */
export function buildFrontDesk(
  reservations: FrontDeskReservation[],
  today: string,
): FrontDeskBoard {
  const rows = reservations.map(toRow);
  return {
    business_date: today,
    arrivals: rows.filter((r) => r.status === 'confirmed' && r.arrival_date <= today),
    departures: rows.filter((r) => r.status === 'checked_in' && r.departure_date <= today),
    in_house: rows.filter((r) => r.status === 'checked_in'),
  };
}

function toRow(reservation: FrontDeskReservation): FrontDeskRow {
  const order = reservation.folio?.order;
  return {
    id: reservation.id,
    reservation_number: reservation.reservation_number,
    status: reservation.status,
    arrival_date: dateOnlyString(reservation.arrival_date),
    departure_date: dateOnlyString(reservation.departure_date),
    guest_name: [reservation.customer.first_name, reservation.customer.last_name]
      .filter(Boolean)
      .join(' '),
    rooms: reservation.rooms
      .map((room) => `${room.unit?.code ?? 'Sin asignar'} · ${room.unit_type.name}`)
      .join(', '),
    unassigned_rooms: reservation.rooms.filter((room) => !room.unit).length,
    adults: reservation.rooms.reduce((sum, room) => sum + room.adults, 0),
    children: reservation.rooms.reduce((sum, room) => sum + room.children, 0),
    folio_id: reservation.folio?.id ?? null,
    balance: order
      ? new Prisma.Decimal(order.grand_total).minus(order.total_paid).toFixed(2)
      : null,
  };
}

/**
 * Hospitality Suite (H3.3) — front desk board: today's arrivals, departures
 * and guests in house. "Today" is the store business day in its time zone,
 * never the UTC date.
 */
@Injectable()
export class LodgingFrontDeskService {
  constructor(private readonly prisma: StorePrismaService) {}

  async board(): Promise<FrontDeskBoard> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    const reservations = await this.prisma.lodging_reservations.findMany({
      where: {
        OR: [
          { status: 'confirmed', arrival_date: { lte: dateOnlyToDb(today) } },
          { status: 'checked_in' },
        ],
      },
      select: FRONT_DESK_SELECT,
      orderBy: [{ arrival_date: 'asc' }, { id: 'asc' }],
    });
    return buildFrontDesk(reservations, today);
  }
}
