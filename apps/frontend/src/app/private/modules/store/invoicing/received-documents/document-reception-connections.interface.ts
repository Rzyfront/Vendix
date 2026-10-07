export type DocumentReceptionConnectionType = 'api_poll' | 'webhook';

export interface DocumentReceptionConnection {
  id: number;
  version: number;
  store_id: number | null;
  accounting_entity_id: number;
  name: string;
  connection_type: DocumentReceptionConnectionType;
  enabled: boolean;
  endpoint?: string;
  /** Opaque public callback token; never used as an authorization credential. */
  public_token?: string;
  webhook_path?: string;
  poll_interval_minutes: number;
  has_secret: boolean;
  next_sync_at: string | null;
  last_synced_at: string | null;
  last_error_code?: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentReceptionRun {
  id: number;
  status: string;
  trigger: string;
  received_count: number;
  duplicate_count: number;
  error_count: number;
  cursor_before_present: boolean;
  cursor_after_present: boolean;
  summary?: { counts?: Record<string, number>; document_ids?: number[]; error_codes?: string[] };
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ReceptionConnectionQuery { page: number; limit: number; store_id?: number; }
export interface ReceptionConnectionPage<T> {
  success: boolean;
  message?: string;
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages?: number; hasNextPage?: boolean; hasPreviousPage?: boolean };
}
export interface ReceptionConnectionEnvelope<T> { success: boolean; message?: string; data: T; }

export interface CreateDocumentReceptionConnectionInput {
  name: string;
  connection_type: DocumentReceptionConnectionType;
  enabled: boolean;
  endpoint?: string;
  secret: string;
  poll_interval_minutes: number;
}

export interface UpdateDocumentReceptionConnectionInput {
  expected_version: number;
  name: string;
  enabled: boolean;
  endpoint?: string;
  secret?: string;
  poll_interval_minutes: number;
}

export interface RequestDocumentReceptionSyncInput {
  expected_version: number;
  idempotency_key: string;
}

export interface DocumentReceptionSyncActionResult {
  run_id: number;
  duplicate?: boolean;
  queued: boolean;
}

export interface CancelDocumentReceptionRunInput {
  reason: string;
}

export interface DocumentReceptionRunCancellationResult {
  run_id: number;
  status: 'cancelled';
  duplicate: boolean;
}
