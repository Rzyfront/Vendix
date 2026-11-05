export type ApiKeyScope = 'workflows:read' | 'workflows:write';

/** Row of `GET store/integrations/api-keys`. The secret is never part of it. */
export interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  created_by_user_id: number | null;
  acting_user_id: number | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Response of the create call: the only moment the secret is visible. */
export interface ApiKeyCreated extends ApiKeyRow {
  secret: string;
}

export interface CreateApiKeyBody {
  name: string;
  scopes: ApiKeyScope[];
  expires_in_days?: number;
}

export interface WebhookRow {
  id: number;
  url: string;
  event_types: string[];
  is_active: boolean;
  description: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Create / rotate responses: the signing secret is shown once. */
export interface WebhookWithSecret extends WebhookRow {
  secret: string;
}

export interface CreateWebhookBody {
  url: string;
  event_types: string[];
  description?: string;
}

export interface UpdateWebhookBody {
  url?: string;
  event_types?: string[];
  is_active?: boolean;
  description?: string;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead';

export interface WebhookDeliveryRow {
  id: number;
  endpoint_id: number;
  event_id: string;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  status_code: number | null;
  last_error: string | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface WebhookDeliveriesQuery {
  page?: number;
  limit?: number;
  status?: WebhookDeliveryStatus;
}
