import { lodging_reservation_status_enum } from '@prisma/client';
import { daysBetweenDateStrings } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { addDays, NIGHT_HOLDING_STATUSES } from '../reservation-status';
import { isSellableHousekeeping } from '../../housekeeping/housekeeping-status';

/** Widest window the rack accepts (two months of nights). */
export const MAX_RACK_NIGHTS = 62;

/** Stays drawn on the rack: nights still held plus finished stays. */
export const RACK_STATUSES: lodging_reservation_status_enum[] = [
  ...NIGHT_HOLDING_STATUSES,
  'checked_out',
];

export interface RackUnitInput {
  id: number;
  unit_type_id: number;
  code: string;
  floor: string | null;
  housekeeping_status: string;
  is_active: boolean;
}

export interface RackTypeInput {
  id: number;
  name: string;
  /** H1.6 — rooms the type may sell above its active rooms. */
  overbooking_allowance: number;
}

export interface RackRoomInput {
  id: number;
  unit_type_id: number;
  unit_id: number | null;
  arrival_date: Date;
  departure_date: Date;
  reservation: {
    id: number;
    reservation_number: string;
    status: lodging_reservation_status_enum;
    customer: { first_name: string | null; last_name: string | null };
  };
}

export interface RackSoldNightInput {
  unit_type_id: number;
  night_date: Date;
  count: number;
}

/** One reservation room drawn as a bar, clipped to the window. */
export interface RackBar {
  reservation_room_id: number;
  reservation_id: number;
  reservation_number: string;
  status: lodging_reservation_status_enum;
  guest: string;
  unit_id: number | null;
  arrival_date: string;
  departure_date: string;
  /** Index of the first visible night (0 = `from`). */
  start: number;
  /** Visible nights. */
  span: number;
  /** The stay began before the window / goes on after it. */
  continues_before: boolean;
  continues_after: boolean;
  /** Row of the type's "Sin asignar" block (0 for assigned bars). */
  lane: number;
}

export interface RackType {
  id: number;
  name: string;
  units: Omit<RackUnitInput, 'unit_type_id'>[];
  /** Active rooms of the type. */
  capacity: number;
  overbooking_allowance: number;
  /** Rooms of the type sold on each night; above `capacity` = overbooked. */
  sold: number[];
  /** H2.5 — rooms held for allotments on each night (not for public sale). */
  held: number[];
  /** Rooms of the type still for sale on each night (overbooking included). */
  free: number[];
  /** Rows the unassigned bars need (0 = no "Sin asignar" row). */
  unassigned_lanes: number;
  bars: RackBar[];
}

export interface Rack {
  from: string;
  to: string;
  nights: string[];
  types: RackType[];
}

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/** Nights `[from, to)` of the window; rejects empty or too wide ranges. */
export function rackNights(from: string, to: string): string[] {
  const count = daysBetweenDateStrings(from, to);
  if (!(count >= 1 && count <= MAX_RACK_NIGHTS)) {
    throw new VendixHttpException(ErrorCodes.LODGING_RACK_RANGE_001);
  }
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

/**
 * Hospitality Suite (H1.3) — occupancy rack: rows are rooms grouped by type,
 * columns are nights `[from, to)`. Stays crossing the window edges are
 * clipped and flagged; unassigned stays stack in the fewest lanes of their
 * type's "Sin asignar" row. Pure, so the edges are testable.
 */
export function buildRack(input: {
  from: string;
  to: string;
  types: RackTypeInput[];
  units: RackUnitInput[];
  rooms: RackRoomInput[];
  sold: RackSoldNightInput[];
  /** H2.5 — allotment rooms held per night `[from, to)`, by type id. */
  held?: Map<number, number[]>;
}): Rack {
  const nights = rackNights(input.from, input.to);
  const nightIndex = new Map(nights.map((night, i) => [night, i]));

  const types = input.types.map<RackType>((type) => {
    const units = input.units.filter((u) => u.unit_type_id === type.id);
    // H5.1 — rooms out of order/service are not sellable capacity.
    const capacity = units.filter(
      (u) => u.is_active && isSellableHousekeeping(u.housekeeping_status),
    ).length;
    const allowance = Math.max(0, type.overbooking_allowance);
    const sold = nights.map(() => 0);
    for (const night of input.sold) {
      const i = nightIndex.get(toDateOnly(night.night_date));
      if (night.unit_type_id === type.id && i !== undefined) sold[i] += night.count;
    }
    const held = input.held?.get(type.id) ?? nights.map(() => 0);
    const free = sold.map((count, i) => Math.max(0, capacity + allowance - count - held[i]));
    const bars = input.rooms
      .filter((room) => room.unit_type_id === type.id)
      .map((room) => toBar(room, input.from, nights.length))
      .filter((bar): bar is RackBar => bar !== null)
      .sort((a, b) => a.start - b.start || a.reservation_room_id - b.reservation_room_id);
    return {
      id: type.id,
      name: type.name,
      units: units.map(({ unit_type_id: _type, ...unit }) => unit),
      capacity,
      overbooking_allowance: allowance,
      sold,
      held,
      free,
      unassigned_lanes: packUnassigned(bars),
      bars,
    };
  });

  return { from: input.from, to: input.to, nights, types };
}

function toBar(room: RackRoomInput, from: string, windowNights: number): RackBar | null {
  const arrival = toDateOnly(room.arrival_date);
  const departure = toDateOnly(room.departure_date);
  const first = daysBetweenDateStrings(from, arrival);
  const end = daysBetweenDateStrings(from, departure);
  const start = Math.max(0, first);
  const stop = Math.min(windowNights, end);
  if (stop <= start) return null;
  const { customer } = room.reservation;
  return {
    reservation_room_id: room.id,
    reservation_id: room.reservation.id,
    reservation_number: room.reservation.reservation_number,
    status: room.reservation.status,
    guest: [customer.first_name, customer.last_name].filter(Boolean).join(' '),
    unit_id: room.unit_id,
    arrival_date: arrival,
    departure_date: departure,
    start,
    span: stop - start,
    continues_before: first < 0,
    continues_after: end > windowNights,
    lane: 0,
  };
}

/** First-fit lanes for unassigned bars (sorted by start). Returns the lane count. */
function packUnassigned(bars: RackBar[]): number {
  const laneEnds: number[] = [];
  for (const bar of bars) {
    if (bar.unit_id !== null) continue;
    let lane = laneEnds.findIndex((end) => end <= bar.start);
    if (lane === -1) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = bar.start + bar.span;
    bar.lane = lane;
  }
  return laneEnds.length;
}
