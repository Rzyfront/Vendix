export type FiscalApiScope = 'store' | 'organization';

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface PaginatedApiResponse<T> extends ApiResponse<T[]> {
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface FiscalOverview {
  stats: {
    upcoming: number;
    overdue: number;
    declarations_ready: number;
    blocked: number;
    rejected_documents: number;
    open_close_sessions: number;
    estimated_amount: number;
    final_amount: number;
  };
  next_obligations: FiscalObligation[];
}

export interface FiscalObligation {
  id: number;
  type: string;
  status: string;
  period_year: number;
  period_month?: number | null;
  period_quarter?: number | null;
  period_start: string;
  period_end: string;
  due_date: string;
  estimated_amount?: number | string | null;
  final_amount?: number | string | null;
  currency: string;
  blocking_reason?: string | null;
  notes?: string | null;
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    business_name?: string | null;
    tax_id?: string | null;
  } | null;
  store?: {
    id: number;
    name: string;
  } | null;
}

export interface TaxDeclarationDraft {
  id: number;
  declaration_type: string;
  status: string;
  period_year: number;
  period_month?: number | null;
  period_quarter?: number | null;
  period_start: string;
  period_end: string;
  total_payable?: number | string | null;
  balance_due?: number | string | null;
  balance_favor?: number | string | null;
  validation_summary?: Record<string, unknown> | null;
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    business_name?: string | null;
    tax_id?: string | null;
  } | null;
  obligation?: FiscalObligation | null;
}

export interface TaxDeclarationLine {
  id: number;
  line_type: string;
  source_type: string;
  description: string;
  base_amount?: number | string | null;
  tax_amount?: number | string | null;
  withholding_amount?: number | string | null;
}

export interface FiscalCloseCheck {
  id: number;
  check_key: string;
  status: string;
  severity: string;
  title: string;
  description?: string | null;
  result_summary?: string | null;
  blocking: boolean;
  override_reason?: string | null;
}

export interface FiscalCloseSession {
  id: number;
  status: string;
  close_type: string;
  period_year: number;
  period_month?: number | null;
  period_start: string;
  period_end: string;
  summary?: Record<string, unknown> | null;
  checks?: FiscalCloseCheck[];
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    business_name?: string | null;
    tax_id?: string | null;
  } | null;
}

export interface FiscalEvidence {
  id: number;
  evidence_type: string;
  storage_key?: string | null;
  content_hash?: string | null;
  source_type?: string | null;
  source_id?: number | null;
  created_at: string;
}

export interface FiscalOperationEvent {
  id: number;
  event_type: string;
  resource_type: string;
  resource_id?: number | null;
  obligation_id?: number | null;
  declaration_id?: number | null;
  close_session_id?: number | null;
  evidence_id?: number | null;
  previous_status?: string | null;
  new_status?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  actor_user?: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  accounting_entity?: {
    id: number;
    legal_name?: string | null;
    name?: string | null;
    tax_id?: string | null;
  } | null;
  store?: {
    id: number;
    name: string;
  } | null;
}

export interface FiscalRuleSet {
  id?: number;
  country_code: string;
  year: number;
  rule_type: string;
  status: string;
  name: string;
  version: string;
  effective_from: string;
  effective_to?: string | null;
  rules: Record<string, unknown>;
  source?: string;
}
