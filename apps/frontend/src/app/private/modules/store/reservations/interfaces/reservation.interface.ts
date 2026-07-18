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
  product?: { id: number; name: string; service_duration_minutes?: number; image_url?: string; base_price?: number; is_consultation?: boolean };
  product_variant?: { id: number; name?: string; sku?: string };
  created_by?: { id: number; first_name: string; last_name: string };
  order?: { id: number; order_number: string };
  provider_id?: number;
  provider?: { id: number; display_name?: string; avatar_url?: string; employee?: { first_name: string; last_name: string } };
  checked_in_at?: string;
  confirmation_requested_at?: string;
  confirmation_deadline?: string;
  data_collection_submissions?: any[];
  metadata_snapshot?: any;
  consultation_notes?: any[];
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
  skip_availability_check?: boolean;
  skip_order_creation?: boolean;
}

export interface RescheduleBookingDto {
  date: string;
  start_time: string;
  end_time: string;
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

export interface ServiceProvider {
  id: number;
  store_id: number;
  employee_id: number;
  is_active: boolean;
  display_name?: string;
  avatar_url?: string;
  bio?: string;
  sort_order: number;
  employee?: { id: number; first_name: string; last_name: string; position?: string };
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
