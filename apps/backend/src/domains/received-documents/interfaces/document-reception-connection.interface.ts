export type DocumentReceptionConnectionType = 'api_poll' | 'webhook';

/** Authenticated fiscal/operational scope, resolved by a controller. */
export interface DocumentReceptionConnectionContext {
  organization_id: number;
  accounting_entity_id: number;
  store_id: number | null;
  actor_id?: number;
  is_organization: boolean;
}

/** Secret-free response contract; decrypted/encrypted credentials never appear here. */
export interface DocumentReceptionConnectionView {
  id: number;
  version: number;
  store_id: number | null;
  accounting_entity_id: number;
  name: string;
  connection_type: DocumentReceptionConnectionType;
  enabled: boolean;
  endpoint?: string;
  public_token?: string;
  webhook_path?: string;
  poll_interval_minutes: number;
  has_secret: boolean;
  next_sync_at: Date | null;
  last_synced_at: Date | null;
  last_error_code?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentReceptionRunView {
  id: number;
  status: string;
  trigger: string;
  received_count: number;
  duplicate_count: number;
  error_count: number;
  cursor_before_present: boolean;
  cursor_after_present: boolean;
  summary?: {
    counts?: Record<string, number>;
    document_ids?: number[];
    error_codes?: string[];
  };
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}
