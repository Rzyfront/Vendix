import {
  ChartAccount,
  JournalEntry,
  FiscalPeriod,
  TrialBalanceReport,
  BalanceSheetReport,
  IncomeStatementReport,
  GeneralLedgerReport,
} from '../interfaces/accounting.interface';

export interface AccountingState {
  // Chart of Accounts
  accounts: ChartAccount[];
  accounts_loading: boolean;

  // Journal Entries
  entries: JournalEntry[];
  entries_loading: boolean;
  current_entry: JournalEntry | null;
  current_entry_loading: boolean;
  entries_meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;

  // Fiscal Periods
  fiscal_periods: FiscalPeriod[];
  fiscal_periods_loading: boolean;

  // Reports
  trial_balance: TrialBalanceReport | null;
  balance_sheet: BalanceSheetReport | null;
  income_statement: IncomeStatementReport | null;
  general_ledger: GeneralLedgerReport | null;
  report_loading: boolean;

  // General
  error: string | null;

  // Entry filters
  search: string;
  page: number;
  limit: number;
  sort_by: string;
  sort_order: 'asc' | 'desc';
  status_filter: string;
  period_filter: number | null;
  date_from: string;
  date_to: string;
}

export const initialAccountingState: AccountingState = {
  accounts: [],
  accounts_loading: false,

  entries: [],
  entries_loading: false,
  current_entry: null,
  current_entry_loading: false,
  entries_meta: null,

  fiscal_periods: [],
  fiscal_periods_loading: false,

  trial_balance: null,
  balance_sheet: null,
  income_statement: null,
  general_ledger: null,
  report_loading: false,

  error: null,

  search: '',
  page: 1,
  limit: 10,
  sort_by: 'entry_date',
  sort_order: 'desc',
  status_filter: '',
  period_filter: null,
  date_from: '',
  date_to: '',
};
