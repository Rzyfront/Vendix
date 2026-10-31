/** Shapes of `/store/customers/crm/conversations` (PLAN-CRM §4.3). */

export type CrmChannel = 'whatsapp' | 'sms' | 'email';
export type CrmConversationStatus = 'open' | 'pending' | 'snoozed' | 'closed';
export type CrmMessageDirection = 'inbound' | 'outbound';
export type CrmMessageChannel = CrmChannel | 'internal_note';
export type CrmMessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'received';

export interface CrmPerson {
  id: number;
  first_name: string | null;
  last_name: string | null;
}

export interface CrmLastMessagePreview {
  text: string;
  direction: CrmMessageDirection;
  status: CrmMessageStatus;
  created_at: string;
}

export interface CrmConversation {
  id: number;
  channel: CrmChannel;
  contact_address: string;
  status: CrmConversationStatus;
  customer: CrmPerson | null;
  assigned_user: CrmPerson | null;
  social_channel_id: number | null;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  snoozed_until: string | null;
  closed_at: string | null;
  created_at: string;
  window_open: boolean;
  window_expires_at: string | null;
  /** Only on list rows. */
  last_message_preview?: CrmLastMessagePreview | null;
}

export interface CrmConversationStats {
  open: number;
  unassigned: number;
  mine: number;
  unread: number;
}

export interface CrmMessageMedia {
  type: string | null;
  mime: string | null;
  filename: string | null;
  url: string | null;
  error: string | null;
}

export interface CrmMessage {
  id: number;
  conversation_id: number;
  direction: CrmMessageDirection;
  channel: CrmMessageChannel;
  status: CrmMessageStatus;
  body: string | null;
  template_name: string | null;
  template_language: string | null;
  media: CrmMessageMedia[];
  sent_by: CrmPerson | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  /** Set when the API returned the first send of a repeated `client_request_id`. */
  duplicate?: boolean;
}

export interface CrmMessagesPage {
  data: CrmMessage[];
  has_more: boolean;
  next_before_id: number | null;
}

export interface CrmConversationsPage {
  data: CrmConversation[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CrmConversationsQuery {
  status?: CrmConversationStatus;
  channel?: CrmChannel;
  assigned?: 'me' | 'unassigned' | number;
  q?: string;
  page?: number;
  limit?: number;
}

export interface CrmTemplateInput {
  name: string;
  language: string;
  variables: string[];
}

export interface SendCrmMessageRequest {
  body?: string;
  template?: CrmTemplateInput;
  client_request_id: string;
}

/** SSE payloads: ids and states only, the client re-reads through REST. */
export interface CrmInboxEvent {
  type: 'crm.message' | 'crm.conversation';
  conversation_id: number;
  assigned_user_id: number | null;
  message_id?: number;
  status?: string;
  direction?: CrmMessageDirection;
}
