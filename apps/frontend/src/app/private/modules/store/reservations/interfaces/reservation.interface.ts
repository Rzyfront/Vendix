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
  product?: { id: number; name: string; service_duration_minutes?: number; image_url?: string; base_price?: number };
  created_by?: { id: number; first_name: string; last_name: string };
  order?: { id: number; order_number: string };
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
  capacity: number;
  reserved: number;
  available: number;
}

export interface ServiceSchedule {
  id: number;
  product_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  capacity: number;
  buffer_minutes: number;
  is_active: boolean;
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

export interface ScheduleException {
  id: number;
  store_id: number;
  product_id?: number;
  date: string;
  is_closed: boolean;
  custom_start_time?: string;
  custom_end_time?: string;
  custom_capacity?: number;
  reason?: string;
}
