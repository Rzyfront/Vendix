export interface Booking {
  id: number;
  store_id: number;
  customer_id: number;
  product_id: number;
  booking_number: string;
  date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  channel: string;
  notes?: string;
  internal_notes?: string;
  order_id?: number;
  created_by_user_id?: number;
  created_at: string;
  updated_at: string;
  customer?: { id: number; first_name: string; last_name: string; email: string; phone?: string };
  product?: { id: number; name: string; service_duration_minutes?: number; image_url?: string; base_price?: number; is_consultation?: boolean };
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

export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

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
