import {
  adaptBalanceSheet,
  adaptFiscalPeriod,
  adaptGeneralLedger,
  adaptIncomeStatement,
  adaptJournalEntry,
  adaptTrialBalance,
  chartOfAccountsParams,
  journalEntriesParams,
} from './superadmin-accounting.adapters';

const account = (code: string, balance: number) => ({
  account_id: 1,
  account_code: code,
  account_name: `Cuenta ${code}`,
  account_type: 'asset',
  nature: 'debit',
  total_debit: balance,
  total_credit: 0,
  balance,
});

describe('superadmin accounting adapters', () => {
  it('chart of accounts: page becomes offset, never sends page', () => {
    expect(chartOfAccountsParams({ page: 3, limit: 20, search: '11', account_type: 'ASSET' })).toEqual({
      account_type: 'asset',
      limit: '20',
      offset: '40',
      search: '11',
    });
    expect(chartOfAccountsParams({ page: 1, limit: 20 })).toEqual({ limit: '20' });
  });

  it('journal entries: from/to become date_from/date_to', () => {
    const p = journalEntriesParams({
      page: 2,
      limit: 10,
      from: '2026-11-01',
      to: '2026-11-30',
      source_type: 'all',
      fiscal_period_id: '9',
    });
    expect(p).toEqual({
      page: '2',
      limit: '10',
      date_from: '2026-11-01',
      date_to: '2026-11-30',
      fiscal_period_id: '9',
    });
    expect(p).not.toHaveProperty('from');
    expect(p).not.toHaveProperty('to');
  });

  it('journal entry: counts lines and exposes the period name', () => {
    const e = adaptJournalEntry({
      id: 1,
      entry_number: 'AE-1',
      fiscal_period_id: 3,
      fiscal_period: { name: '2026' },
      accounting_entry_lines: [{}, {}],
    });
    expect(e.lines_count).toBe(2);
    expect(e.fiscal_period_name).toBe('2026');
    expect(e.fiscal_period_id).toBe('3');
  });

  it('fiscal period: status maps to state', () => {
    expect(adaptFiscalPeriod({ id: 9, name: '2026-08', status: 'open' })).toMatchObject({
      id: '9',
      state: 'open',
    });
  });

  it('trial balance: unwraps accounts and maps balance to net_balance', () => {
    const rows = adaptTrialBalance({
      accounts: [account('1105', -205000)],
      totals: {},
      period: {},
    });
    expect(rows).toEqual([
      {
        account_code: '1105',
        account_name: 'Cuenta 1105',
        account_type: 'asset',
        total_debit: -205000,
        total_credit: 0,
        net_balance: -205000,
      },
    ]);
    expect(adaptTrialBalance(null)).toEqual([]);
  });

  it('balance sheet: labelled groups and totals from balance_check', () => {
    const bs = adaptBalanceSheet({
      as_of: '2026-11-30',
      assets: { accounts: [account('1305', 230000)], total: 230000 },
      liabilities: { accounts: [], total: 100 },
      equity: { accounts: [], total: 0 },
      balance_check: { total_assets: 230000, total_liabilities_and_equity: 100 },
    });
    expect(bs?.assets).toMatchObject({ account_type: 'ASSET', label: 'Activos', total: 230000 });
    expect(bs?.assets.accounts[0]).toMatchObject({ account_code: '1305', balance: 230000 });
    expect(bs?.liabilities.label).toBe('Pasivos');
    expect(bs?.equity.label).toBe('Patrimonio');
    expect(bs?.total_assets).toBe(230000);
    expect(bs?.total_liabilities_equity).toBe(100);
  });

  it('income statement: period dates, labelled groups and totals', () => {
    const is = adaptIncomeStatement({
      period: { from: '2026-01-01', to: '2026-11-30' },
      revenue: { accounts: [], total: 1858000 },
      expenses: { accounts: [], total: 2780000 },
      cost: { accounts: [], total: 0 },
      net_income: -922000,
    });
    expect(is).toMatchObject({
      from: '2026-01-01',
      to: '2026-11-30',
      total_revenue: 1858000,
      total_expenses: 2780000,
      total_cost: 0,
      net_income: -922000,
    });
    expect(is?.revenue.label).toBe('Ingresos');
    expect(is?.cost.label).toBe('Costos');
    expect(is?.expenses.label).toBe('Gastos');
  });

  it('general ledger: unwraps lines with running balance', () => {
    const rows = adaptGeneralLedger({
      account: { code: '1105' },
      lines: [
        {
          entry_number: 'AE-8',
          entry_date: '2026-09-24',
          entry_description: 'Apertura caja',
          line_description: 'Caja (apertura)',
          debit_amount: 100000,
          credit_amount: 0,
          running_balance: 100000,
        },
      ],
    });
    expect(rows).toEqual([
      {
        entry_number: 'AE-8',
        entry_date: '2026-09-24',
        description: 'Caja (apertura)',
        account_code: '1105',
        debit_amount: 100000,
        credit_amount: 0,
        balance: 100000,
      },
    ]);
    expect(adaptGeneralLedger(null)).toEqual([]);
  });
});
