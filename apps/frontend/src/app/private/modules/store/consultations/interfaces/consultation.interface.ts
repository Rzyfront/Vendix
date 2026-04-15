export interface ConsultationBooking {
  id: number;
  booking_number: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  checked_in_at: string | null;
  notes: string | null;
  internal_notes: string | null;
  product: { id: number; name: string; service_duration_minutes: number | null };
  customer: { id: number; first_name: string; last_name: string };
  provider: { id: number; display_name: string } | null;
  submission: { id: number; status: string; ai_prediagnosis: string | null } | null;
}

export interface ConsultationContext {
  booking: any;
  product: any;
  customer: any;
  provider: any;
  consultation_template: any;
  preconsultation_template: any;
  preconsultation_submission: any;
  consultation_notes: ConsultationNote[];
  customer_history: {
    previous_bookings: any[];
    important_notes: ConsultationNote[];
  };
}

export interface ConsultationNote {
  id?: number;
  note_key: string;
  note_value: string;
  include_in_summary: boolean;
}
