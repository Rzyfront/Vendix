import { CancellationPolicy } from '../../rates/interfaces/rate-plan.interface';

/** H2.4 — policy a room keeps from its plan when sold. */
export type CancellationPolicySnapshot = Pick<
  CancellationPolicy,
  'id' | 'name' | 'rules' | 'no_show_penalty'
>;

/** Hospitality Suite (H1.1) — lifecycle of a stay reservation. */
export type LodgingReservationStatus =
  | 'tentative'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show';

export const RESERVATION_STATUS_LABELS: Record<LodgingReservationStatus, string> = {
  tentative: 'Tentativa',
  confirmed: 'Confirmada',
  checked_in: 'En casa',
  checked_out: 'Salida',
  cancelled: 'Cancelada',
  no_show: 'No-show',
};

export interface LodgingReservationRoom {
  id: number;
  unit_type_id: number;
  unit_id: number | null;
  arrival_date?: string;
  departure_date?: string;
  adults: number;
  children: number;
  total_amount: string;
  unit_type: { id: number; name: string };
  /** Physical room once assigned (H1.4). */
  unit?: { id: number; code: string } | null;
  /** Set when this room was cancelled alone (H1.5); null = active. */
  cancelled_at?: string | null;
  /** H2.1 — plan it was sold with; null = room type base price. */
  rate_plan?: { id: number; name: string } | null;
  /** H2.1 — sold nights with their price (detail only). */
  nights?: NightRate[];
  /** H2.4 — policy and deposit in force when booking (null = no policy). */
  cancellation_policy_snapshot?: CancellationPolicySnapshot | null;
  deposit_percent?: string;
}

/** Price of one night (`night_date` date-only ISO or `YYYY-MM-DD`). */
export interface NightRate {
  night_date: string;
  rate_amount: string;
}

const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/**
 * H2.1 — per-night breakdown: "jue $250.000 · vie $320.000 = $570.000".
 * `format` renders money (CurrencyFormatService).
 */
export function formatNightBreakdown(
  nights: NightRate[],
  format: (amount: number) => string,
): string {
  if (nights.length === 0) return '';
  const parts = nights.map((n) => {
    const day = WEEKDAY_SHORT[new Date(`${n.night_date.slice(0, 10)}T00:00:00Z`).getUTCDay()];
    return `${day} ${format(Number(n.rate_amount))}`;
  });
  const total = nights.reduce((sum, n) => sum + Number(n.rate_amount), 0);
  return `${parts.join(' · ')} = ${format(total)}`;
}

/** Reservation as returned by the store API (dates are date-only ISO). */
export interface LodgingReservation {
  id: number;
  reservation_number: string;
  status: LodgingReservationStatus;
  arrival_date: string;
  departure_date: string;
  total_amount: string;
  notes: string | null;
  customer: {
    id: number;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    /** H3.1 — prefills the holder in the guest register. */
    document_type?: string | null;
    document_number?: string | null;
  };
  rooms: LodgingReservationRoom[];
  created_at?: string;
  /** H2.4 — deposit asked for the active rooms; `percent` only when all share it. */
  deposit?: { percent: string | null; amount: string };
  /** H2.4 — penalty computed when cancelled or no-show ("1 noche"). */
  cancellation_penalty_amount?: string | null;
  cancellation_penalty_detail?: string | null;
  /** Status history, oldest first (detail only). */
  events?: LodgingReservationEvent[];
  /** H3.2 — guest folio opened at check-in (detail only). */
  folio?: LodgingFolio | null;
  /** H6.6 — web (Wompi) payments of the booking engine (detail only). */
  online_payments?: LodgingOnlinePayment[];
}

export interface LodgingOnlinePayment {
  id: number;
  amount: string;
  status: 'pending' | 'completed' | 'cancelled';
  paid_at: string | null;
  applied_amount: string;
}

/** H3.2 — running account of a stay: its charges live in a draft order. */
export interface LodgingFolio {
  id: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  order: { id: number; order_number: string; grand_total: string };
}

export const FOLIO_STATUS_LABELS: Record<LodgingFolio['status'], string> = {
  open: 'Abierto',
  closed: 'Cerrado',
};

/** H3.2 — check-in: rooms picked now and the dirty-room confirmation. */
export interface CheckInRequest {
  rooms?: { room_id: number; unit_id: number }[];
  confirm_dirty?: boolean;
}

/** One status change of a reservation (H1.2). `user` null = automatic. */
export interface LodgingReservationEvent {
  id: number;
  from_status: LodgingReservationStatus | null;
  to_status: LodgingReservationStatus;
  reason: string | null;
  created_at: string;
  user: { id: number; first_name: string; last_name: string | null } | null;
}

/** List search: guest/number text, status and stay range (`YYYY-MM-DD`). */
export interface ReservationListQuery {
  search?: string;
  status?: LodgingReservationStatus | '';
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export interface ReservationListResult {
  data: LodgingReservation[];
  total: number;
  page: number;
  totalPages: number;
}

/** Today's front desk numbers (store date). */
export interface ReservationStats {
  arrivals_today: number;
  in_house: number;
  occupied_tonight: number;
  active_units: number;
  occupancy_percent: number;
}

/** H3.3 — one reservation of the front desk board. Dates are `YYYY-MM-DD`. */
export interface FrontDeskRow {
  id: number;
  reservation_number: string;
  status: LodgingReservationStatus;
  arrival_date: string;
  departure_date: string;
  guest_name: string;
  /** "101 · Doble, Sin asignar · Suite". */
  rooms: string;
  adults: number;
  children: number;
  folio_id: number | null;
  /** Folio balance (charges − payments) as a decimal string; null without a folio. */
  balance: string | null;
}

/** H3.3 — today's arrivals, departures and guests in house (store business day). */
export interface FrontDeskBoard {
  business_date: string;
  arrivals: FrontDeskRow[];
  departures: FrontDeskRow[];
  in_house: FrontDeskRow[];
}

/** Stay to price: dates are `YYYY-MM-DD`, departure exclusive. */
export interface ReservationQuoteRequest {
  unit_type_id: number;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children?: number;
  /** H2.1 — rate plan; omitted = room type base price. */
  rate_plan_id?: number;
  /** H2.5 — holder: an agency or company also sees its allotment rooms. */
  customer_id?: number;
}

export interface ReservationQuote {
  unit_type: { id: number; name: string };
  available: number;
  /** H1.6 — active rooms, most rooms sold on a night and overbooking allowance. */
  units: number;
  sold: number;
  /** H2.5 — rooms held for other customers' allotments (not for sale). */
  held: number;
  overbooking_allowance: number;
  nights: number;
  /** H2.1 — plan applied (null = base price) and the price of each night. */
  rate_plan: { id: number; name: string } | null;
  night_rates: NightRate[];
  total_amount: string;
  /** H2.4 — policy and deposit percent of the plan. */
  cancellation_policy: CancellationPolicySnapshot | null;
  deposit_percent: string;
  /** H2.3 — restrictions the stay breaks ("No se admiten llegadas el 8-dic"). */
  restrictions: string[];
}

/** One room of a new reservation: type and occupancy (H1.5). */
export interface ReservationRoomRequest {
  unit_type_id: number;
  adults: number;
  children?: number;
  rate_plan_id?: number;
}

/** New reservation of one or more rooms sharing the stay dates. */
export interface CreateReservationRequest {
  arrival_date: string;
  departure_date: string;
  rooms: ReservationRoomRequest[];
  customer_id: number;
  notes?: string;
  /** H2.3 — reason to sell despite the restrictions (needs rates:write). */
  restriction_override_reason?: string;
}

/** Date-only ISO from the API (`2026-11-10T00:00:00.000Z`) → `2026-11-10`. */
export function toDateOnly(value: string): string {
  return value.slice(0, 10);
}

/** Nights between two `YYYY-MM-DD` dates (departure night not counted). */
export function countNights(arrival: string, departure: string): number {
  const ms = Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

/** One reservation room drawn on the rack (H1.3), clipped to the window. */
export interface RackBar {
  reservation_room_id: number;
  reservation_id: number;
  reservation_number: string;
  status: LodgingReservationStatus;
  guest: string;
  unit_id: number | null;
  arrival_date: string;
  departure_date: string;
  /** Index of the first visible night (0 = `from`). */
  start: number;
  span: number;
  continues_before: boolean;
  continues_after: boolean;
  /** Row of the type's "Sin asignar" block. */
  lane: number;
}

/** H5.3 — why a room is out of sale without a reservation. */
export type InventoryBlockReason = 'maintenance' | 'owner_use' | 'ical';

export const INVENTORY_BLOCK_REASON_LABELS: Record<InventoryBlockReason, string> = {
  maintenance: 'Mantenimiento',
  owner_use: 'Uso del propietario',
  ical: 'Calendario externo',
};

/** H5.3 — active block drawn on its room row, clipped to the window. */
export interface RackBlock {
  id: number;
  unit_id: number;
  reason: InventoryBlockReason;
  notes: string | null;
  from_date: string;
  /** Day the room returns to sale (exclusive). */
  to_date: string;
  start: number;
  span: number;
  continues_before: boolean;
  continues_after: boolean;
}

/** H5.3 — new block: nights `[from_date, to_date)`. */
export interface CreateInventoryBlockRequest {
  unit_id: number;
  from_date: string;
  to_date: string;
  reason: Exclude<InventoryBlockReason, 'ical'>;
  notes?: string;
}

export interface RackUnit {
  id: number;
  code: string;
  floor: string | null;
  housekeeping_status: string;
  is_active: boolean;
}

export interface RackType {
  id: number;
  name: string;
  units: RackUnit[];
  /** Active rooms of the type. */
  capacity: number;
  /** H1.6 — rooms the type may sell above `capacity`. */
  overbooking_allowance: number;
  /** Rooms sold per night; above `capacity` the night is overbooked. */
  sold: number[];
  /** H2.5 — rooms held for allotments per night (not for public sale). */
  held: number[];
  /** H5.3 — sellable rooms blocked per night (maintenance, owner use). */
  blocked: number[];
  /** Rooms still for sale per night of the window (overbooking included). */
  free: number[];
  unassigned_lanes: number;
  bars: RackBar[];
  blocks: RackBlock[];
}

/** Occupancy rack: rooms grouped by type × nights `[from, to)`. */
export interface Rack {
  from: string;
  to: string;
  nights: string[];
  types: RackType[];
}

/** Change of a reservation room (H1.4): room and/or stay dates. */
export interface RoomChangeRequest {
  unit_id?: number;
  arrival_date?: string;
  departure_date?: string;
}

/** One side of a room change quote. */
export interface RoomChangeSide {
  unit: { id: number; code: string } | null;
  unit_type: { id: number; name: string };
  arrival_date: string;
  departure_date: string;
  nights: number;
  total_amount: string;
}

/** Validated change with its price difference, before confirming. */
export interface RoomChangeQuote {
  reservation_room_id: number;
  reservation_id: number;
  current: RoomChangeSide;
  proposed: RoomChangeSide;
  /** proposed − current total (negative = cheaper). */
  difference: string;
}

/** H3.5 — one movement of the reservation deposit (wallet advance, not a folio payment). */
export interface LodgingDepositMovement {
  id: number;
  kind: 'received' | 'applied' | 'retained';
  status: 'pending' | 'completed' | 'cancelled';
  amount: number;
  /** cash | card | bank_transfer | wompi_link | null */
  method: string | null;
  method_label: string;
  /** Wompi link URL for `wompi_link` rows. */
  checkout_url: string | null;
  created_at: string;
}

/** H3.5 — outcome of a cancelled / no-show reservation against its deposit. */
export interface LodgingDepositSettlement {
  penalty: number;
  penalty_detail: string | null;
  retained: number;
  to_collect: number;
  to_refund: number;
}

/** H3.5 — deposit summary of a reservation. */
export interface LodgingDepositSummary {
  reservation_id: number;
  reservation_number: string;
  required: { percent: string | null; amount: string };
  received: number;
  applied: number;
  retained: number;
  /** received − applied − retained (still held). */
  balance: number;
  /** Default amount for "Cobrar depósito". */
  pending: number;
  /** True only while tentative / confirmed. */
  can_collect: boolean;
  movements: LodgingDepositMovement[];
  settlement: LodgingDepositSettlement | null;
}

export interface LodgingDepositRequest {
  amount: number;
  store_payment_method_id: number;
  /** One key per attempt: a double click registers it once. */
  request_id: string;
}

/** H2.4 / H3.5 — penalty of cancelling now and what the deposit covers. */
export interface CancellationQuote {
  penalty_amount: string | null;
  penalty_detail: string | null;
  deposit_balance?: string;
  deposit_retained?: string;
  to_collect?: string;
  to_refund?: string;
}
