/**
 * Outbound messaging contract (PLAN-CRM §5.0).
 *
 * Callers never pick a provider or touch credentials: they describe the
 * message and `MessagingService` resolves the store channel from
 * `social_channels`, decrypts its token in memory and routes to a provider.
 */

export type MessagingChannel = 'whatsapp' | 'sms' | 'email';

export type MessagingProviderName =
  | 'meta_cloud'
  | 'sns_sms'
  | 'ses_email'
  | 'console';

export type MessagingMediaType = 'image' | 'document' | 'audio' | 'video';

export interface OutboundMedia {
  type: MessagingMediaType;
  /** Public or presigned URL Meta can download. */
  url: string;
  filename?: string;
}

export interface OutboundTemplate {
  name: string;
  language: string;
  /** Positional body variables (`{{1}}`, `{{2}}`…), in order. */
  variables: string[];
  header_media?: { type: 'image' | 'document' | 'video'; url: string };
}

export interface OutboundMessage {
  store_id: number;
  channel: MessagingChannel;
  /** E.164 phone (`+573001234567`) or email address. */
  to: string;
  body?: string;
  subject?: string;
  template?: OutboundTemplate;
  /** At most one attachment per message (WhatsApp sends one media per message). */
  media?: OutboundMedia[];
  /**
   * Last inbound message of the conversation. WhatsApp only accepts free-form
   * text/media within 24 h of it; `null`/absent means the window is closed.
   */
  last_inbound_at?: Date | null;
  /**
   * Customer of the conversation, when linked. SMS and email are skipped
   * when this customer opted out of the channel in this store.
   */
  customer_id?: number | null;
  /**
   * Marketing message (a campaign). It is only sent when the customer's
   * consent for the channel allows marketing: never after an opt-out, and on
   * WhatsApp only with an explicit opt-in. Checked even in dry-run.
   */
  marketing?: boolean;
  /** `crm_messages.id` of the row being delivered. */
  idempotency_key: string;
}

/**
 * Normalized error codes. `provider_error_code` keeps the raw provider code
 * (e.g. Meta `131047`) for diagnostics.
 */
export type MessagingErrorCode =
  | 'RATE_LIMITED'
  | 'INVALID_RECIPIENT'
  | 'WINDOW_CLOSED'
  | 'OPTED_OUT'
  | 'AUTH'
  | 'SPEND_LIMIT'
  | 'TEMPLATE_INVALID'
  | 'INVALID_REQUEST'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'UNKNOWN';

export interface SendResult {
  status: 'sent' | 'failed';
  provider: MessagingProviderName;
  provider_message_id?: string;
  error_code?: MessagingErrorCode;
  provider_error_code?: string;
  error_message?: string;
  /** Whether the queue may try again later (rate limits, transient errors). */
  retryable: boolean;
  cost_amount?: number;
}

/** Channel resolved from `social_channels`, with the token decrypted in memory. */
export interface ResolvedChannel {
  id: number;
  store_id: number;
  channel_type: string;
  provider: string;
  phone_number_id: string | null;
  waba_id: string | null;
  /** Plain token. Never log or persist it. */
  access_token: string | null;
  graph_version: string;
  /**
   * Non-secret channel settings from `social_channels.metadata`
   * (`sender_id` for SMS; `from_name`, `reply_to` for email).
   */
  settings?: Record<string, unknown>;
  /** Store name, used as the email sender label when none is configured. */
  store_name?: string;
}

export interface MessagingProvider {
  readonly name: MessagingProviderName;
  send(
    message: OutboundMessage,
    channel: ResolvedChannel | null,
  ): Promise<SendResult>;
}
