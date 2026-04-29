export interface Account {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  nature: 'debit' | 'credit';
  parent_id?: string;
  depth?: number;
  state: 'active' | 'inactive';
  children?: Account[];
  accepts_entries: boolean;
}

export interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  description: string;
  total_debit: number;
  total_credit: number;
  state: 'draft' | 'posted' | 'voided';
  lines?: JournalEntryLine[];
  created_at: string;
}

export interface JournalEntryLine {
  id: string;
  account_id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface FiscalPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  state: 'open' | 'closed';
}

export interface Receivable {
  id: string;
  customer_name: string;
  invoice_number?: string;
  amount: number;
  paid_amount: number;
  balance: number;
  due_date?: string;
  state: 'pending' | 'partial' | 'paid' | 'overdue';
  created_at: string;
}

export interface Payable {
  id: string;
  supplier_name: string;
  reference?: string;
  amount: number;
  paid_amount: number;
  balance: number;
  due_date?: string;
  state: 'pending' | 'partial' | 'paid' | 'overdue';
  created_at: string;
}

export const ACCOUNT_TYPE_LABELS: Record<Account['type'], string> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio',
  revenue: 'Ingreso',
  expense: 'Gasto',
};

export const ACCOUNT_NATURE_LABELS: Record<Account['nature'], string> = {
  debit: 'D',
  credit: 'C',
};

export const JOURNAL_ENTRY_STATE_LABELS: Record<JournalEntry['state'], string> = {
  draft: 'Borrador',
  posted: 'Contabilizado',
  voided: 'Anulado',
};

export const JOURNAL_ENTRY_STATE_VARIANTS: Record<JournalEntry['state'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  draft: 'warning',
  posted: 'success',
  voided: 'error',
};

export const RECEIVABLE_STATE_LABELS: Record<Receivable['state'], string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  overdue: 'Vencido',
};

export const RECEIVABLE_STATE_VARIANTS: Record<Receivable['state'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'warning',
  partial: 'info',
  paid: 'success',
  overdue: 'error',
};

export const PAYABLE_STATE_LABELS: Record<Payable['state'], string> = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  overdue: 'Vencido',
};

export const PAYABLE_STATE_VARIANTS: Record<Payable['state'], 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  pending: 'warning',
  partial: 'info',
  paid: 'success',
  overdue: 'error',
};
