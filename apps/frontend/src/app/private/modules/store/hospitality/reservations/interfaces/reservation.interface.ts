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
  adults: number;
  children: number;
  total_amount: string;
  unit_type: { id: number; name: string };
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
  };
  rooms: LodgingReservationRoom[];
  created_at?: string;
  /** Status history, oldest first (detail only). */
  events?: LodgingReservationEvent[];
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

/** Stay to price: dates are `YYYY-MM-DD`, departure exclusive. */
export interface ReservationQuoteRequest {
  unit_type_id: number;
  arrival_date: string;
  departure_date: string;
  adults: number;
  children?: number;
}

export interface ReservationQuote {
  unit_type: { id: number; name: string };
  available: number;
  nights: number;
  nightly_rate: string;
  total_amount: string;
}

export interface CreateReservationRequest extends ReservationQuoteRequest {
  customer_id: number;
  notes?: string;
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
  /** Rooms still for sale per night of the window. */
  free: number[];
  unassigned_lanes: number;
  bars: RackBar[];
}

/** Occupancy rack: rooms grouped by type × nights `[from, to)`. */
export interface Rack {
  from: string;
  to: string;
  nights: string[];
  types: RackType[];
}
