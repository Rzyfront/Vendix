// ===== ACCOUNTS RECEIVABLE =====

export interface AccountReceivable {
  id: number;
  store_id: number;
  organization_id: number;
  customer_id: number;
  customer?: { id: number; name: string; email?: string; phone?: string };
  source_type: string;
  source_id: number;
  document_number?: string;
  original_amount: number;
  paid_amount: number;
  balance: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: 'open' | 'partial' | 'overdue' | 'paid' | 'written_off';
  days_overdue: number;
  last_payment_date?: string;
  notes?: string;
  ar_payments?: ArPayment[];
  payment_agreements?: PaymentAgreement[];
  created_at: string;
  updated_at: string;
}

export interface ArPayment {
  id: number;
  accounts_receivable_id: number;
  payment_id?: number;
  amount: number;
  payment_date: string;
  payment_method?: string;
  reference?: string;
  notes?: string;
  created_by?: number;
}

export interface PaymentAgreement {
  id: number;
  accounts_receivable_id: number;
  agreement_number: string;
  total_amount: number;
  num_installments: number;
  interest_rate: number;
  state: 'active' | 'completed';
  start_date: string;
  notes?: string;
  agreement_installments?: AgreementInstallment[];
}

export interface AgreementInstallment {
  id: number;
  payment_agreement_id: number;
  installment_number: number;
  amount: number;
  due_date: string;
  state: 'pending' | 'partial' | 'paid';
  paid_amount: number;
  paid_at?: string;
}

// ===== ACCOUNTS PAYABLE =====

export interface AccountPayable {
  id: number;
  store_id: number;
  organization_id: number;
  supplier_id: number;
  supplier?: { id: number; name: string; email?: string; phone?: string };
  source_type: string;
  source_id: number;
  document_number?: string;
  original_amount: number;
  paid_amount: number;
  balance: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: 'open' | 'partial' | 'overdue' | 'paid' | 'written_off';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  days_overdue: number;
  last_payment_date?: string;
  notes?: string;
  ap_payments?: ApPayment[];
  ap_payment_schedules?: ApPaymentSchedule[];
  created_at: string;
  updated_at: string;
}

export interface ApPayment {
  id: number;
  accounts_payable_id: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference?: string;
  bank_export_ref?: string;
  notes?: string;
  created_by?: number;
}

export interface ApPaymentSchedule {
  id: number;
  accounts_payable_id: number;
  scheduled_date: string;
  amount: number;
  status: 'scheduled' | 'processed' | 'cancelled';
  processed_at?: string;
}

// ===== QUERY & DTO =====

export interface ArQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  customer_id?: number;
  search?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface ApQueryParams {
  page?: number;
  limit?: number;
  status?: string;
  supplier_id?: number;
  priority?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface RegisterArPaymentDto {
  amount: number;
  payment_id?: number;
  payment_method?: string;
  reference?: string;
  notes?: string;
}

export interface RegisterApPaymentDto {
  amount: number;
  payment_method: string;
  reference?: string;
  bank_export_ref?: string;
  notes?: string;
}

export interface ScheduleApPaymentDto {
  scheduled_date: string;
  amount: number;
}

export interface CreatePaymentAgreementDto {
  num_installments: number;
  interest_rate?: number;
  start_date?: string;
  notes?: string;
}

// ===== DASHBOARD & AGING =====

export interface CarteraDashboard {
  total_pending: number;
  total_overdue: number;
  due_soon: number;
  collected_this_month?: number;
  paid_this_month?: number;
}

export interface AgingBucket {
  label: string;
  count: number;
  total: number;
}

export interface AgingReport {
  buckets: AgingBucket[];
  breakdown: Array<{
    id: number;
    name: string;
    current: number;
    days_1_30: number;
    days_31_60: number;
    days_61_90: number;
    days_91_120: number;
    days_120_plus: number;
    total: number;
  }>;
  totals: {
    current: number;
    days_1_30: number;
    days_31_60: number;
    days_61_90: number;
    days_91_120: number;
    days_120_plus: number;
    grand_total: number;
  };
}

// ===== API RESPONSE =====

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
