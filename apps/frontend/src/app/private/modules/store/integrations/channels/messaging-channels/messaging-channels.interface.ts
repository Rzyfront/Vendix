/** Monthly SMS spend of the store, in USD (platform SNS account). */
export interface SmsSpend {
  currency: 'USD';
  period_start: string;
  limit: number | null;
  used: number;
  remaining: number | null;
}

interface MessagingChannelBase {
  id: number;
  channel_type: 'sms' | 'email';
  provider: string;
  status: string;
  enabled: boolean;
  connected_at: string | null;
  disconnected_at: string | null;
  updated_at: string;
}

export interface SmsChannel extends MessagingChannelBase {
  channel_type: 'sms';
  sender_id: string | null;
  spend: SmsSpend;
}

export interface EmailChannel extends MessagingChannelBase {
  channel_type: 'email';
  from_name: string | null;
  reply_to: string | null;
}

/** `GET /store/integrations/channels`: `null` until the store saves one. */
export interface MessagingChannels {
  sms: SmsChannel | null;
  email: EmailChannel | null;
}

export interface UpdateSmsChannelRequest {
  enabled: boolean;
  sender_id: string | null;
  monthly_spend_limit: number;
}

export interface UpdateEmailChannelRequest {
  enabled: boolean;
  from_name: string | null;
  reply_to: string | null;
}
