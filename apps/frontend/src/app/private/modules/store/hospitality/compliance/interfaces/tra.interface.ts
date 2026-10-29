/** Hospitality Suite (H4.1) — TRA report of each check-in and check-out. */
export type TraStatus = 'pending' | 'sent' | 'manual' | 'failed';
export type TraEvent = 'check_in' | 'check_out';
export type TraErrorCode =
  | 'not_configured'
  | 'token_missing'
  | 'token_expired'
  | 'missing_data'
  | 'unavailable'
  | 'rejected';

export interface TraSubmission {
  id: number;
  reservation_id: number;
  reservation_number: string;
  guest_id: number | null;
  guest_name: string;
  is_primary: boolean;
  event: TraEvent;
  status: TraStatus;
  attempts: number;
  error_code: TraErrorCode | null;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  reported_by_name: string | null;
}

export interface TraSummary {
  enabled: boolean;
  /** False while Vendix has no TRA endpoint configured (assisted mode). */
  automatic: boolean;
  rnt_number: string;
  stats: Record<TraStatus, number>;
  credential: {
    hint: string;
    tested_at: string | null;
    test_ok: boolean | null;
    test_message: string | null;
    updated_at: string;
  } | null;
  notice: { code: TraErrorCode; message: string } | null;
}

export interface TraListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: TraStatus;
}

export interface TraListResult {
  data: TraSubmission[];
  total: number;
  totalPages: number;
}

export interface TraTestResult {
  ok: boolean;
  code: TraErrorCode | null;
  message: string;
  tested_at: string;
}
