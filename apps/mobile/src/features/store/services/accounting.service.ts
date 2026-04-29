import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  PaginatedResponse,
} from '../types';
import type {
  Account,
  JournalEntry,
  FiscalPeriod,
  Receivable,
  Payable,
} from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export interface JournalEntryQuery {
  search?: string;
  state?: string;
  page?: number;
  limit?: number;
}

export interface ReceivableQuery {
  search?: string;
  state?: string;
  page?: number;
  limit?: number;
}

export interface PayableQuery {
  search?: string;
  state?: string;
  page?: number;
  limit?: number;
}

export interface CreateAccountDto {
  code: string;
  name: string;
  type: Account['type'];
  nature: Account['nature'];
  parent_id?: string;
}

export interface UpdateAccountDto extends Partial<CreateAccountDto> {}

export interface CreateJournalEntryDto {
  description: string;
  entry_date: string;
  entry_type: string;
  lines: Array<{
    account_id: string;
    debit: number;
    credit: number;
    description?: string;
  }>;
}

export interface CreateFiscalPeriodDto {
  name: string;
  start_date: string;
  end_date: string;
}

export interface PayReceivableDto {
  amount: number;
  payment_method?: string;
}

export interface PayPayableDto {
  amount: number;
  payment_method?: string;
}

export const AccountingService = {
  async getAccounts(): Promise<Account[]> {
    const res = await apiClient.get(Endpoints.STORE.ACCOUNTING.ACCOUNTS.LIST);
    return unwrap<Account[]>(res);
  },

  async createAccount(dto: CreateAccountDto): Promise<Account> {
    const res = await apiClient.post(Endpoints.STORE.ACCOUNTING.ACCOUNTS.CREATE, dto);
    return unwrap<Account>(res);
  },

  async updateAccount(id: string, dto: UpdateAccountDto): Promise<Account> {
    const endpoint = Endpoints.STORE.ACCOUNTING.ACCOUNTS.UPDATE.replace(':id', id);
    const res = await apiClient.put(endpoint, dto);
    return unwrap<Account>(res);
  },

  async deleteAccount(id: string): Promise<void> {
    const endpoint = Endpoints.STORE.ACCOUNTING.ACCOUNTS.DELETE.replace(':id', id);
    await apiClient.delete(endpoint);
  },

  async getJournalEntries(query?: JournalEntryQuery): Promise<PaginatedResponse<JournalEntry>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.ACCOUNTING.JOURNAL_ENTRIES.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<JournalEntry>>(res);
  },

  async getJournalEntry(id: string): Promise<JournalEntry> {
    const endpoint = Endpoints.STORE.ACCOUNTING.JOURNAL_ENTRIES.GET.replace(':id', id);
    const res = await apiClient.get(endpoint);
    return unwrap<JournalEntry>(res);
  },

  async createJournalEntry(dto: CreateJournalEntryDto): Promise<JournalEntry> {
    const res = await apiClient.post(Endpoints.STORE.ACCOUNTING.JOURNAL_ENTRIES.CREATE, dto);
    return unwrap<JournalEntry>(res);
  },

  async getFiscalPeriods(): Promise<FiscalPeriod[]> {
    const res = await apiClient.get(Endpoints.STORE.ACCOUNTING.FISCAL_PERIODS.LIST);
    return unwrap<FiscalPeriod[]>(res);
  },

  async createFiscalPeriod(dto: CreateFiscalPeriodDto): Promise<FiscalPeriod> {
    const res = await apiClient.post(Endpoints.STORE.ACCOUNTING.FISCAL_PERIODS.CREATE, dto);
    return unwrap<FiscalPeriod>(res);
  },

  async getReceivables(query?: ReceivableQuery): Promise<PaginatedResponse<Receivable>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.ACCOUNTING.RECEIVABLES.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<Receivable>>(res);
  },

  async payReceivable(id: string, dto: PayReceivableDto): Promise<Receivable> {
    const endpoint = Endpoints.STORE.ACCOUNTING.RECEIVABLES.PAY.replace(':id', id);
    const res = await apiClient.post(endpoint, dto);
    return unwrap<Receivable>(res);
  },

  async getPayables(query?: PayableQuery): Promise<PaginatedResponse<Payable>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.ACCOUNTING.PAYABLES.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<Payable>>(res);
  },

  async payPayable(id: string, dto: PayPayableDto): Promise<Payable> {
    const endpoint = Endpoints.STORE.ACCOUNTING.PAYABLES.PAY.replace(':id', id);
    const res = await apiClient.post(endpoint, dto);
    return unwrap<Payable>(res);
  },
};
