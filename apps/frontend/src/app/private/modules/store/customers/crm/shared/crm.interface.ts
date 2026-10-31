/** Shapes of the store CRM API (PLAN-CRM §4.4-§4.6). */

export interface CrmPerson {
  id: number;
  first_name: string | null;
  last_name: string | null;
}

export type CrmConsent = 'unknown' | 'opted_in' | 'opted_out';
export type CrmCustomerSource =
  | 'pos'
  | 'ecommerce'
  | 'whatsapp'
  | 'landing'
  | 'import'
  | 'manual'
  | 'referral';

export interface CrmTag {
  id: number;
  name: string;
  color: string | null;
  customers_count?: number;
}

export interface CrmStage {
  id: number;
  pipeline_id: number;
  name: string;
  kind: 'open' | 'won' | 'lost';
  probability: number | null;
  color: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface CrmRfm {
  period_days: number;
  recency_days: number | null;
  frequency: number;
  monetary: string;
  last_purchase_at: string | null;
  scores: { r: number; f: number; m: number } | null;
  segment: string | null;
  description: string | null;
}

export interface CustomerCrmProfile {
  customer: CrmPerson | null;
  owner: CrmPerson | null;
  source: CrmCustomerSource | null;
  stage: CrmStage | null;
  last_contact_at: string | null;
  consents: {
    whatsapp: CrmConsent;
    sms: CrmConsent;
    email: CrmConsent;
    updated_at: string | null;
  };
  tags: CrmTag[];
  open_tasks: number;
  overdue_tasks: number;
  open_opportunities: { count: number; amount: string };
  rfm: CrmRfm;
}

export interface UpdateCustomerCrmProfile {
  owner_user_id?: number | null;
  source?: CrmCustomerSource | null;
  stage_id?: number | null;
  consents?: Partial<Record<'whatsapp' | 'sms' | 'email', CrmConsent>>;
}

export type CrmTimelineType =
  | 'order'
  | 'payment'
  | 'quotation'
  | 'booking'
  | 'message'
  | 'task'
  | 'note';

export interface CrmTimelineItem {
  type: CrmTimelineType;
  at: string;
  title: string;
  summary: string | null;
  status: string | null;
  amount: string | null;
  currency: string | null;
  ref: { kind: CrmTimelineType; id: number };
  actor: CrmPerson | null;
}

export interface CrmTimelinePage {
  data: CrmTimelineItem[];
  meta: { has_more: boolean; next_before: string | null };
}

export interface CrmNote {
  id: number;
  body: string;
  is_pinned: boolean;
  created_at: string;
  created_by: CrmPerson | null;
}

export type CrmTaskStatus = 'pending' | 'done' | 'cancelled';

export interface CrmTask {
  id: number;
  title: string;
  description: string | null;
  status: CrmTaskStatus;
  due_at: string | null;
  is_overdue: boolean;
  completed_at: string | null;
  customer: CrmPerson | null;
  assigned_user: CrmPerson | null;
  created_by: CrmPerson | null;
  opportunity: { id: number; title: string } | null;
  conversation_id: number | null;
  created_at: string;
}

export interface CrmTasksQuery {
  assigned?: string;
  status?: CrmTaskStatus;
  due?: 'overdue' | 'today' | 'week';
  customer_id?: number;
  q?: string;
  page?: number;
  limit?: number;
}

export interface CrmTasksPage {
  data: CrmTask[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CrmTasksToday {
  overdue: CrmTask[];
  today: CrmTask[];
  counts: { overdue: number; today: number; upcoming_week: number };
}

export interface CrmTaskStats {
  overdue: number;
  today: number;
  open: number;
  done_last_7_days: number;
}

export interface SaveCrmTask {
  title?: string;
  description?: string | null;
  due_at?: string | null;
  assigned_user_id?: number | null;
  customer_id?: number;
  opportunity_id?: number;
  status?: CrmTaskStatus;
}

export type CrmOpportunityStatus = 'open' | 'won' | 'lost';

export interface CrmOpportunity {
  id: number;
  title: string;
  amount: string | null;
  currency: string | null;
  status: CrmOpportunityStatus;
  probability: number | null;
  pipeline_id: number;
  stage_id: number;
  stage: CrmStage | null;
  customer: CrmPerson | null;
  owner: CrmPerson | null;
  quotation: { id: number; quotation_number: string; status: string } | null;
  order_id: number | null;
  expected_close_date: string | null;
  won_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CrmBoardStage extends CrmStage {
  count: number;
  total_amount: string;
  opportunities: CrmOpportunity[];
}

export interface CrmBoard {
  pipeline: { id: number; name: string; is_default: boolean };
  pipelines: { id: number; name: string; is_default: boolean }[];
  stages: CrmBoardStage[];
  truncated: boolean;
}

export interface CrmPipeline {
  id: number;
  name: string;
  is_default: boolean;
  stages: CrmStage[];
}

export interface CrmBoardQuery {
  pipeline_id?: number;
  owner?: string;
  status?: CrmOpportunityStatus;
  customer_id?: number;
  q?: string;
}

export interface SaveCrmOpportunity {
  customer_id?: number;
  title?: string;
  amount?: number | null;
  stage_id?: number;
  pipeline_id?: number;
  owner_user_id?: number | null;
  quotation_id?: number | null;
  expected_close_date?: string | null;
  lost_reason?: string;
}

export function personName(person: CrmPerson | null | undefined): string {
  if (!person) return '';
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
}
