import type { ISODateString, MoneyAmount } from './common.types';

export interface FiscalDashboardSummary {
  total_obligations: number;
  pending_obligations: number;
  upcoming_deadlines: number;
  overdue: number;
  total_taxes_paid_year: MoneyAmount;
  pending_taxes: MoneyAmount;
  next_deadline?: ISODateString;
  alerts: FiscalAlert[];
}

export interface FiscalAlert {
  id: string;
  type: 'DEADLINE' | 'OVERDUE' | 'INFO' | 'WARNING';
  title: string;
  description: string;
  due_date?: ISODateString;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface FiscalObligation {
  id: string;
  code: string;
  name: string;
  description?: string;
  periodicity: 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'EVENT';
  due_date: ISODateString;
  status: 'PENDING' | 'FILED' | 'OVERDUE' | 'NOT_APPLICABLE';
  amount?: MoneyAmount;
  filed_at?: ISODateString;
  reference?: string;
  period?: string;
}

export interface FiscalDeclaration {
  id: string;
  obligation_id: string;
  obligation_name: string;
  period: string;
  status: 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  submitted_at?: ISODateString;
  amount?: MoneyAmount;
  reference?: string;
  form_number?: string;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export interface FiscalClose {
  id: string;
  period: string;
  year: number;
  status: 'OPEN' | 'IN_PROGRESS' | 'CLOSED';
  started_at: ISODateString;
  closed_at?: ISODateString;
  closed_by?: string;
  notes?: string;
  summary?: {
    total_revenue: MoneyAmount;
    total_expenses: MoneyAmount;
    total_taxes: MoneyAmount;
    net_income: MoneyAmount;
  };
}

export interface FiscalEvidence {
  id: string;
  type: 'INVOICE' | 'DECLARATION' | 'RECEIPT' | 'CLOSING' | 'OTHER';
  title: string;
  description?: string;
  file_url?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  related_id?: string;
  created_at: ISODateString;
  expires_at?: ISODateString;
}

export interface FiscalHistoryEntry {
  id: string;
  type: 'CLOSING' | 'DECLARATION' | 'PAYMENT' | 'AUDIT' | 'OTHER';
  title: string;
  description: string;
  amount?: MoneyAmount;
  performed_by?: string;
  performed_at: ISODateString;
  reference?: string;
}

export interface FiscalRule {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: 'TAX' | 'WITHHOLDING' | 'EXEMPTION' | 'REGIME';
  rate?: number;
  base_amount?: number;
  is_active: boolean;
  effective_from?: ISODateString;
  effective_to?: ISODateString;
  config?: Record<string, unknown>;
}
