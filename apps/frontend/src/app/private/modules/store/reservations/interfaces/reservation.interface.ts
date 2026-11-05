export interface Booking {
  id: number;
  store_id: number;
  customer_id: number;
  product_id: number;
  product_variant_id?: number | null;
  booking_number: string;
  date: string;
  start_time: string;
  end_time: string;
  /** Day the booking ends when it crosses midnight (S21); null/absent = same day. */
  end_date?: string | null;
  /** Booking without an end (D9). */
  is_open_ended?: boolean;
  status: BookingStatus;
  channel: string;
  notes?: string;
  internal_notes?: string;
  order_id?: number;
  table_id?: number | null;
  table?: { id: number; name: string; zone?: string | null; status?: string } | null;
  created_by_user_id?: number;
  created_at: string;
  updated_at: string;
  customer?: { id: number; first_name: string; last_name: string; email: string; phone?: string };
  product?: { id: number; name: string; service_duration_minutes?: number; image_url?: string; base_price?: number; is_consultation?: boolean; requires_station?: boolean; booking_mode?: string };
  product_variant?: { id: number; name?: string; sku?: string };
  created_by?: { id: number; first_name: string; last_name: string };
  order?: { id: number; order_number: string };
  provider_id?: number;
  station_id?: number;
  provider?: { id: number; display_name?: string; avatar_url?: string; user?: { first_name: string | null; last_name: string | null } | null; employee?: { first_name: string; last_name: string } | null };
  checked_in_at?: string;
  confirmation_requested_at?: string;
  confirmation_deadline?: string;
  data_collection_submissions?: any[];
  metadata_snapshot?: any;
  consultation_notes?: any[];
  /** Recurring series the booking belongs to (S19) and its position (0-based); absent for a single booking. */
  series_id?: number | null;
  series_index?: number | null;
  /** Size of the series, for the "Serie i/n" badge. */
  series?: { id: number; occurrences: number; frequency: 'daily' | 'weekly' | string } | null;
  /** Deposit block of the detail endpoint and of the create answer; null when the booking never had one (S15). */
  deposit?: BookingDeposit | null;
  /** "Cobro para reservar" block of the detail endpoint; null/absent when the booking has no charge. */
  prepay?: BookingPrepay | null;
  /** Path of the payment page (`/pagar/:token`) returned when a `link` deposit was created. */
  payment_path?: string | null;
  /** Absolute payment page on the store's public domain; null when the store has none. */
  payment_url?: string | null;
}

/** `deposit` block of a booking (field names mirror `BookingDepositBlock` of the backend). */
export interface BookingDeposit {
  required: number | null;
  received: number;
  balance: number;
  pending_request: {
    payment_request_id: number;
    amount: number;
    status: string;
    expires_at: string | null;
  } | null;
  decision_due_at: string | null;
}

/** `prepay` block of the booking detail (mirrors `RentalPrepayService.summary` of the backend). */
export interface BookingPrepay {
  paid_amount: number;
  order_total: number;
  remaining: number;
  pending_request: {
    payment_request_id: number;
    amount: number;
    status: string;
    expires_at: string | null;
  } | null;
}

/** Body of `POST :id/prepay-payment`: the prepay collected in person. */
export interface RegisterPrepayPaymentInput {
  store_payment_method_id: number;
  bank_account_id?: number;
  amount?: number;
  reference?: string;
  /** One per dialog open: a double submit registers a single payment. */
  request_id?: string;
}

export type CancelLeftoverAction = 'refund' | 'credit' | 'retain';

/** Deposit taken with an admin booking: `desk` = received now, `link` = payment page + held slot. */
export interface BookingDepositInput {
  amount: number;
  mode: 'desk' | 'link';
  method?: string;
  store_payment_method_id?: number;
  request_id: string;
}

export type DepositRefundMethod = 'cash' | 'bank_transfer' | 'card' | 'wompi';
export type DepositDecisionAction = 'retain' | 'reschedule' | 'refund' | 'credit';

export interface CancelBookingInput {
  leftover_action?: CancelLeftoverAction;
  refund_method?: DepositRefundMethod;
  /** Idempotency key: one per dialog open. */
  request_id?: string;
}

export interface DepositDecisionInput {
  action: DepositDecisionAction;
  /** Idempotency key: one per dialog open. */
  request_id: string;
  refund_method?: DepositRefundMethod;
  store_payment_method_id?: number;
  new_date?: string;
  new_start_time?: string;
  new_end_time?: string;
}

export type BookingStatus = 'pending' | 'confirmed' | 'arriving' | 'attending' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

/**
 * One entry returned by `GET /store/reservations/queue`. Each booking in
 * `arriving` or `attending` status is ranked by ABS(starts_at - arrival_at),
 * with priority + created_at as tiebreakers.
 */
export interface QueueEntry {
  booking_id: number;
  booking_number: string;
  customer_id: number;
  provider_id: number | null;
  starts_at: string;
  target_time: string;
  arrival_at: string;
  score: number;        // milliseconds of (target - arrival). Lower = closer.
  priority: number;     // manual override. 0 = default.
}

/**
 * One row of the per-store business-hours master calendar. The store
 * availability service intersects provider schedules against these
 * windows so a provider can't be booked outside the store's open hours.
 */
export interface BusinessHoursRow {
  day_of_week: number;       // 0 = Sunday, 6 = Saturday
  start_time: string | null; // HH:mm in 24h, null when closed
  end_time: string | null;
  is_active: boolean;
}

export interface BookingStats {
  today_count: number;
  pending_count: number;
  confirmed_count: number;
  cancellation_rate: number;
  no_show_rate: number;
}

export interface AvailabilitySlot {
  date: string;
  start_time: string;
  end_time: string;
  available_providers: AvailableProvider[];
  total_available: number;
  is_booked?: boolean;
}

export interface ProviderDateInfo {
  date: string;
  day_of_week: number;
  has_schedule: boolean;
  booking_count: number;
  bookings: Array<{
    id: number;
    start_time: string;
    end_time: string;
    status: string;
    customer_name: string;
    service_name: string;
  }>;
}

export interface BookingQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: BookingStatus;
  customer_id?: number;
  product_id?: number;
  channel?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface CreateBookingDto {
  customer_id: number;
  product_id: number;
  product_variant_id?: number;
  date: string;
  start_time: string;
  end_time: string;
  channel?: string;
  notes?: string;
  provider_id?: number;
  station_id?: number;
  skip_availability_check?: boolean;
  skip_order_creation?: boolean;
  deposit?: BookingDepositInput;
}

export interface RescheduleBookingDto {
  date: string;
  start_time: string;
  end_time: string;
  /** QUI-972: move the booking to another professional. */
  provider_id?: number;
}

/**
 * Appointment redesign phase 2 — pending reschedule request when
 * `settings.reservations.allow_direct_reschedule === false`. The admin
 * sees the queue in `RescheduleRequestsPanel` and approves/rejects.
 */
export type RescheduleRequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface RescheduleRequestBooking {
  id: number;
  booking_number: string;
  date: string;
  start_time: string;
  end_time: string;
  customer: {
    id: number;
    first_name: string;
    last_name: string;
    email: string | null;
    phone: string | null;
  };
  product: { id: number; name: string };
  provider: { id: number; display_name: string } | null;
}

export interface RescheduleRequest {
  id: number;
  store_id: number;
  booking_id: number;
  requested_date: string;
  requested_start_time: string;
  requested_end_time: string;
  requested_by_user_id: number | null;
  requested_by_customer_id: number | null;
  requested_at: string;
  reason: string | null;
  status: RescheduleRequestStatus;
  decided_by_user_id: number | null;
  decided_at: string | null;
  decision_reason: string | null;
  booking: RescheduleRequestBooking;
  requested_by_user?: { id: number; first_name: string; last_name: string } | null;
  decided_by_user?: { id: number; first_name: string; last_name: string } | null;
}

export interface CreateRescheduleRequestDto {
  date: string;
  start_time: string;
  end_time: string;
  reason?: string;
}

export interface DecideRescheduleRequestDto {
  decision_reason?: string;
}

export type CalendarViewMode = 'month' | 'week' | 'day';

export interface CalendarDateData {
  date: string;
  bookings: Booking[];
  isToday: boolean;
  isCurrentMonth: boolean;
}

// ===== Provider availability overview =====

export interface ProviderAvailabilityDay {
  date: string;
  total_slots: number;
  booked_slots: number;
  free_slots: number;
  occupancy_pct: number;
}

export interface ProviderAvailabilityRow {
  provider_id: number;
  display_name: string;
  avatar_url: string | null;
  total_slots: number;
  booked_slots: number;
  free_slots: number;
  occupancy_pct: number;
  days: ProviderAvailabilityDay[];
}

export interface ProviderAvailabilityTotals {
  total_slots: number;
  booked_slots: number;
  free_slots: number;
  occupancy_pct: number;
  most_loaded_provider_id: number | null;
  most_loaded_provider_name: string | null;
  average_occupancy_pct: number;
}

export interface ProviderAvailabilityOverview {
  date_from: string;
  date_to: string;
  slot_minutes: number;
  providers: ProviderAvailabilityRow[];
  totals: ProviderAvailabilityTotals;
}

export interface AvailabilityOverviewQuery {
  date_from: string;
  date_to: string;
  provider_id?: number;
  product_id?: number;
  slot_minutes?: number;
}

export type AvailableProviderUser = ProviderUser;

export interface ProviderUser {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface ServiceProvider {
  id: number;
  store_id: number;
  employee_id: number | null;
  user_id: number | null;
  is_active: boolean;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  sort_order: number;
  /** Preferred station (S10): booking with this provider tries it first. */
  default_station_id?: number | null;
  employee?: { id: number; first_name: string; last_name: string; position?: string } | null;
  user?: ProviderUser | null;
  services?: ProviderServiceAssignment[];
  schedules?: ProviderSchedule[];
  exceptions?: ProviderException[];
}

export interface ProviderServiceAssignment {
  id: number;
  provider_id: number;
  product_id: number;
  product?: { id: number; name: string; base_price?: number; service_duration_minutes?: number };
}

export interface ProviderSchedule {
  id: number;
  provider_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface ProviderException {
  id: number;
  provider_id: number;
  date: string;
  is_unavailable: boolean;
  custom_start_time?: string;
  custom_end_time?: string;
  reason?: string;
}

export interface AvailableProvider {
  id: number;
  display_name: string;
  avatar_url?: string;
}
