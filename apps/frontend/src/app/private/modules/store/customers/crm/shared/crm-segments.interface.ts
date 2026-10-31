/** Segment filter v1 and campaigns (PLAN-CRM §4.5 / §4.7). */

export type SegmentOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'gte'
  | 'lte'
  | 'between'
  | 'exists'
  | 'within_days'
  | 'older_than_days';

export type SegmentValue =
  | number
  | string
  | boolean
  | number[]
  | string[]
  | [number, number]
  | [string, string];

export interface SegmentRule {
  field: string;
  cmp: SegmentOperator;
  value: SegmentValue;
}

export interface SegmentGroup {
  op: 'and' | 'or';
  rules: Array<SegmentRule | SegmentGroup>;
}

export interface CrmSegment {
  id: number;
  name: string;
  description: string | null;
  filter: SegmentGroup;
  filter_version: number;
  is_dynamic: boolean;
  last_count: number | null;
  last_counted_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Customer of a segment; contact data arrives already masked. */
export interface SegmentCustomer {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  last_order_at: string | null;
}

export interface SegmentPreview {
  count: number;
  sample: SegmentCustomer[];
  filter: SegmentGroup;
}

export interface SegmentCustomersPage {
  data: SegmentCustomer[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SaveCrmSegment {
  name: string;
  description?: string | null;
  filter: SegmentGroup;
}

export type CampaignChannel = 'whatsapp' | 'sms' | 'email';
export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'cancelled'
  | 'failed';

export interface CampaignTemplateInput {
  name: string;
  language: string;
  variables?: string[];
}

/** What is sent and to whom; shared by the estimate and the campaign itself. */
export interface CampaignContentInput {
  segment_id: number;
  channel: CampaignChannel;
  template?: CampaignTemplateInput;
  body?: string;
  subject?: string;
}

export interface CreateCrmCampaign extends CampaignContentInput {
  name: string;
  scheduled_at?: string;
}

export interface CampaignEstimate {
  segment_id: number;
  channel: CampaignChannel;
  segment_total: number;
  recipients: number;
  excluded_no_consent: number;
  excluded_no_address: number;
  excluded_duplicate: number;
  /** USD, up to 4 decimals. */
  estimated_cost: number;
  currency: 'USD';
  spend_remaining: number | null;
  exceeds_spend_limit: boolean;
  max_recipients: number;
  exceeds_max_recipients: boolean;
  template_verified: boolean | null;
}

export interface CrmCampaign {
  id: number;
  name: string;
  channel: CampaignChannel;
  segment_id: number | null;
  template_name: string | null;
  template_language: string | null;
  template_variables: string[] | null;
  body: string | null;
  subject: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  recipients_total: number;
  recipients_sent: number;
  recipients_failed: number;
  estimated_cost: string | number | null;
  created_at: string;
  updated_at: string;
  segment: { id: number; name: string } | null;
}

export interface CampaignMetrics {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  opted_out: number;
  failed_by_reason: Record<string, number>;
}

export interface CrmCampaignDetail extends CrmCampaign {
  metrics: CampaignMetrics;
}

export interface CrmCampaignWithEstimate extends CrmCampaign {
  estimate: CampaignEstimate;
}

export interface CampaignsPage {
  data: CrmCampaign[];
  total: number;
  page: number;
  totalPages: number;
}

export type CampaignRecipientStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface CampaignRecipient {
  id: number;
  status: CampaignRecipientStatus;
  error_code: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  cost_amount: string | number | null;
  conversation_id: number;
  customer: { id: number; first_name: string | null; last_name: string | null } | null;
  /** Masked unless the viewer has `store:customers:contact:read`. */
  address: string;
}

export interface CampaignRecipientsPage {
  data: CampaignRecipient[];
  total: number;
  page: number;
  totalPages: number;
}
