/** Hospitality Suite (H7.1) — night audit ("Cerrar día"). */
export interface NightAuditReservationRow {
  id: number;
  reservation_number: string;
  guest_name: string;
}

export interface NightAuditDiscrepancy {
  reservation_id: number;
  reservation_number: string;
  room: string;
  rate_amount: string;
  reason: 'not_posted' | 'voided';
}

export interface NightAuditSummary {
  business_date: string;
  rooms_total: number;
  rooms_occupied: number;
  nights_posted: number;
  room_revenue: string;
  no_shows: NightAuditReservationRow[];
  pending_arrivals: NightAuditReservationRow[];
  discrepancies: NightAuditDiscrepancy[];
}

export interface NightAuditView {
  business_date: string;
  status: 'open' | 'closed' | 'reopened';
  closed_at: string | null;
  closed_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
  summary: NightAuditSummary;
}
