import type {
  BalanceSheetGroup,
  BalanceSheetReport,
  ChartAccountType,
  ChartOfAccountsQuery,
  FiscalPeriod,
  GeneralLedgerRow,
  IncomeStatementReport,
  JournalEntry,
  JournalEntryQuery,
  TrialBalanceRow,
} from '../interfaces/superadmin-fiscal.interface';

/**
 * Translators between the platform accounting UI and the real backend contract
 * of `/super-admin/fiscal/accounting/*` (same contract the tenant module uses).
 *
 * The backend rejects unknown query params (`forbidNonWhitelisted`), paginates
 * the chart of accounts by `offset`, filters entries by `date_from`/`date_to`
 * and returns the reports as objects (`{ accounts, totals, period }`), not as
 * flat rows. Keeping the translation here leaves the pages untouched.
 */

type Raw = Record<string, any>;
type Params = Record<string, string>;

export function chartOfAccountsParams(query: ChartOfAccountsQuery): Params {
  const params: Params = {};
  if (query.search) params['search'] = query.search;
  if (query.account_type) params['account_type'] = query.account_type.toLowerCase();
  if (query.limit) {
    params['limit'] = String(query.limit);
    const offset = ((query.page ?? 1) - 1) * query.limit;
    if (offset > 0) params['offset'] = String(offset);
  }
  return params;
}

export function journalEntriesParams(query: JournalEntryQuery): Params {
  const params: Params = {};
  if (query.page) params['page'] = String(query.page);
  if (query.limit) params['limit'] = String(query.limit);
  if (query.from) params['date_from'] = query.from;
  if (query.to) params['date_to'] = query.to;
  if (query.source_type && query.source_type !== 'all') {
    params['source_type'] = query.source_type;
  }
  if (query.fiscal_period_id) params['fiscal_period_id'] = query.fiscal_period_id;
  if (query.search) params['search'] = query.search;
  return params;
}

export function adaptJournalEntry(raw: Raw): JournalEntry {
  const lines: unknown[] = raw['accounting_entry_lines'] ?? raw['lines'] ?? [];
  return {
    ...raw,
    id: String(raw['id']),
    fiscal_period_id: String(raw['fiscal_period_id'] ?? ''),
    fiscal_period_name: raw['fiscal_period']?.name ?? raw['fiscal_period_name'],
    lines_count: raw['lines_count'] ?? lines.length,
  } as JournalEntry;
}

export function adaptFiscalPeriod(raw: Raw): FiscalPeriod {
  return {
    ...raw,
    id: String(raw['id']),
    state: raw['state'] ?? raw['status'],
  } as FiscalPeriod;
}

export function adaptTrialBalance(data: Raw | null | undefined): TrialBalanceRow[] {
  const accounts: Raw[] = Array.isArray(data) ? data : (data?.['accounts'] ?? []);
  return accounts.map((a) => ({
    account_code: a['account_code'],
    account_name: a['account_name'],
    account_type: a['account_type'],
    total_debit: a['total_debit'],
    total_credit: a['total_credit'],
    net_balance: a['net_balance'] ?? a['balance'],
  }));
}

function group(
  raw: Raw | undefined,
  account_type: ChartAccountType,
  label: string,
): BalanceSheetGroup {
  return {
    account_type,
    label,
    total: raw?.['total'] ?? 0,
    accounts: ((raw?.['accounts'] ?? []) as Raw[]).map((a) => ({
      account_code: a['account_code'],
      account_name: a['account_name'],
      balance: a['balance'],
    })),
  };
}

export function adaptBalanceSheet(data: Raw | null | undefined): BalanceSheetReport | null {
  if (!data) return null;
  const check = data['balance_check'] ?? {};
  const assets = group(data['assets'], 'ASSET', 'Activos');
  const liabilities = group(data['liabilities'], 'LIABILITY', 'Pasivos');
  const equity = group(data['equity'], 'EQUITY', 'Patrimonio');
  return {
    as_of: data['as_of'],
    assets,
    liabilities,
    equity,
    total_assets: check['total_assets'] ?? assets.total,
    total_liabilities_equity:
      check['total_liabilities_and_equity'] ??
      Number(liabilities.total) + Number(equity.total),
  };
}

export function adaptIncomeStatement(
  data: Raw | null | undefined,
): IncomeStatementReport | null {
  if (!data) return null;
  const revenue = group(data['revenue'], 'REVENUE', 'Ingresos');
  const cost = group(data['cost'], 'COST', 'Costos');
  const expenses = group(data['expenses'], 'EXPENSE', 'Gastos');
  return {
    from: data['period']?.from ?? data['from'],
    to: data['period']?.to ?? data['to'],
    revenue,
    cost,
    expenses,
    total_revenue: revenue.total,
    total_cost: cost.total,
    total_expenses: expenses.total,
    net_income: data['net_income'] ?? 0,
  };
}

export function adaptGeneralLedger(data: Raw | null | undefined): GeneralLedgerRow[] {
  const lines: Raw[] = Array.isArray(data) ? data : (data?.['lines'] ?? []);
  const accountCode = Array.isArray(data) ? undefined : data?.['account']?.code;
  return lines.map((l) => ({
    entry_number: l['entry_number'],
    entry_date: l['entry_date'],
    description: l['line_description'] || l['entry_description'] || l['description'] || '',
    account_code: l['account_code'] ?? accountCode,
    debit_amount: l['debit_amount'],
    credit_amount: l['credit_amount'],
    balance: l['balance'] ?? l['running_balance'],
  }));
}
