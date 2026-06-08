import { apiGet, apiPost, apiPut, apiDelete, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  ChartOfAccount,
  JournalEntry,
  FiscalPeriod,
  AccountMapping,
  AccountingStats,
} from '@/core/models/org-admin/accounting.types';

export const OrgAccountingService = {
  // Chart of Accounts
  listAccounts: async (params?: ListParams) =>
    apiGet<ChartOfAccount[]>(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.LIST, params),
  getAccountTree: async () =>
    apiGet<ChartOfAccount[]>(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.TREE),
  getAccount: async (id: string) =>
    apiGet<ChartOfAccount>(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.GET.replace(':id', id)),
  createAccount: async (body: Partial<ChartOfAccount>) =>
    apiPost<ChartOfAccount>(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.CREATE, body),
  updateAccount: async (id: string, body: Partial<ChartOfAccount>) =>
    apiPut<ChartOfAccount>(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.UPDATE.replace(':id', id), body),
  deleteAccount: async (id: string) =>
    apiDelete(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.DELETE.replace(':id', id)),
  // Journal Entries
  listJournalEntries: async (params?: ListParams) =>
    apiGet<JournalEntry[]>(Endpoints.ORGANIZATION.ACCOUNTING.JOURNAL_ENTRIES.LIST, params),
  getJournalEntry: async (id: string) =>
    apiGet<JournalEntry>(Endpoints.ORGANIZATION.ACCOUNTING.JOURNAL_ENTRIES.GET.replace(':id', id)),
  createJournalEntry: async (body: Partial<JournalEntry>) =>
    apiPost<JournalEntry>(Endpoints.ORGANIZATION.ACCOUNTING.JOURNAL_ENTRIES.CREATE, body),
  postJournalEntry: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.ACCOUNTING.JOURNAL_ENTRIES.POST.replace(':id', id)),
  voidJournalEntry: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.ACCOUNTING.JOURNAL_ENTRIES.VOID.replace(':id', id)),
  // Fiscal Periods
  listFiscalPeriods: async (params?: ListParams) =>
    apiGet<FiscalPeriod[]>(Endpoints.ORGANIZATION.ACCOUNTING.FISCAL_PERIODS.LIST, params),
  getFiscalPeriod: async (id: string) =>
    apiGet<FiscalPeriod>(Endpoints.ORGANIZATION.ACCOUNTING.FISCAL_PERIODS.GET.replace(':id', id)),
  createFiscalPeriod: async (body: Partial<FiscalPeriod>) =>
    apiPost<FiscalPeriod>(Endpoints.ORGANIZATION.ACCOUNTING.FISCAL_PERIODS.CREATE, body),
  closeFiscalPeriod: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.ACCOUNTING.FISCAL_PERIODS.CLOSE.replace(':id', id)),
  reactivateFiscalPeriod: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.ACCOUNTING.FISCAL_PERIODS.REACTIVATE.replace(':id', id)),
  // Account Mappings
  listMappings: async (params?: ListParams) =>
    apiGet<AccountMapping[]>(Endpoints.ORGANIZATION.ACCOUNTING.ACCOUNT_MAPPINGS.LIST, params),
  getMapping: async (id: string) =>
    apiGet<AccountMapping>(Endpoints.ORGANIZATION.ACCOUNTING.ACCOUNT_MAPPINGS.GET.replace(':id', id)),
  createMapping: async (body: Partial<AccountMapping>) =>
    apiPost<AccountMapping>(Endpoints.ORGANIZATION.ACCOUNTING.ACCOUNT_MAPPINGS.CREATE, body),
  updateMapping: async (id: string, body: Partial<AccountMapping>) =>
    apiPut<AccountMapping>(Endpoints.ORGANIZATION.ACCOUNTING.ACCOUNT_MAPPINGS.UPDATE.replace(':id', id), body),
  deleteMapping: async (id: string) =>
    apiDelete(Endpoints.ORGANIZATION.ACCOUNTING.ACCOUNT_MAPPINGS.DELETE.replace(':id', id)),
  // Stats (no dedicated endpoint; use trial-balance or derived)
  getStats: async (): Promise<AccountingStats> => {
    const [accounts, entries, periods] = await Promise.all([
      apiGet<ChartOfAccount[]>(Endpoints.ORGANIZATION.ACCOUNTING.CHART_OF_ACCOUNTS.LIST),
      apiGet<JournalEntry[]>(Endpoints.ORGANIZATION.ACCOUNTING.JOURNAL_ENTRIES.LIST),
      apiGet<FiscalPeriod[]>(Endpoints.ORGANIZATION.ACCOUNTING.FISCAL_PERIODS.LIST),
    ]);
    return {
      total_accounts: accounts?.length ?? 0,
      total_journal_entries: entries?.length ?? 0,
      open_periods: (periods ?? []).filter((p) => p.status === 'OPEN').length,
      closed_periods: (periods ?? []).filter((p) => p.status === 'CLOSED').length,
    };
  },
};
