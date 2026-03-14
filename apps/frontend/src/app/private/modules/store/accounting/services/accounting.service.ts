import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ChartAccount,
  CreateAccountDto,
  UpdateAccountDto,
  JournalEntry,
  CreateJournalEntryDto,
  UpdateJournalEntryDto,
  QueryJournalEntryDto,
  FiscalPeriod,
  CreateFiscalPeriodDto,
  ReportQueryDto,
  TrialBalanceReport,
  BalanceSheetReport,
  IncomeStatementReport,
  GeneralLedgerReport,
  AccountMapping,
  AccountingListResponse,
  ApiResponse,
} from '../interfaces/accounting.interface';

@Injectable({
  providedIn: 'root',
})
export class AccountingService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/accounting${endpoint ? '/' + endpoint : ''}`;
  }

  // ── Chart of Accounts ────────────────────────────────────────────
  getChartOfAccounts(): Observable<ApiResponse<ChartAccount[]>> {
    return this.http.get<ApiResponse<ChartAccount[]>>(
      this.getApiUrl('chart-of-accounts'),
    );
  }

  getAccount(id: number): Observable<ApiResponse<ChartAccount>> {
    return this.http.get<ApiResponse<ChartAccount>>(
      this.getApiUrl(`chart-of-accounts/${id}`),
    );
  }

  createAccount(dto: CreateAccountDto): Observable<ApiResponse<ChartAccount>> {
    return this.http.post<ApiResponse<ChartAccount>>(
      this.getApiUrl('chart-of-accounts'),
      dto,
    );
  }

  updateAccount(id: number, dto: UpdateAccountDto): Observable<ApiResponse<ChartAccount>> {
    return this.http.patch<ApiResponse<ChartAccount>>(
      this.getApiUrl(`chart-of-accounts/${id}`),
      dto,
    );
  }

  deleteAccount(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`chart-of-accounts/${id}`),
    );
  }

  // ── Journal Entries ──────────────────────────────────────────────
  getJournalEntries(query: QueryJournalEntryDto): Observable<AccountingListResponse<JournalEntry>> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<AccountingListResponse<JournalEntry>>(
      this.getApiUrl('journal-entries'),
      { params },
    );
  }

  getJournalEntry(id: number): Observable<ApiResponse<JournalEntry>> {
    return this.http.get<ApiResponse<JournalEntry>>(
      this.getApiUrl(`journal-entries/${id}`),
    );
  }

  createJournalEntry(dto: CreateJournalEntryDto): Observable<ApiResponse<JournalEntry>> {
    return this.http.post<ApiResponse<JournalEntry>>(
      this.getApiUrl('journal-entries'),
      dto,
    );
  }

  updateJournalEntry(id: number, dto: UpdateJournalEntryDto): Observable<ApiResponse<JournalEntry>> {
    return this.http.patch<ApiResponse<JournalEntry>>(
      this.getApiUrl(`journal-entries/${id}`),
      dto,
    );
  }

  deleteJournalEntry(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`journal-entries/${id}`),
    );
  }

  postJournalEntry(id: number): Observable<ApiResponse<JournalEntry>> {
    return this.http.post<ApiResponse<JournalEntry>>(
      this.getApiUrl(`journal-entries/${id}/post`),
      {},
    );
  }

  voidJournalEntry(id: number): Observable<ApiResponse<JournalEntry>> {
    return this.http.post<ApiResponse<JournalEntry>>(
      this.getApiUrl(`journal-entries/${id}/void`),
      {},
    );
  }

  // ── Fiscal Periods ───────────────────────────────────────────────
  getFiscalPeriods(): Observable<ApiResponse<FiscalPeriod[]>> {
    return this.http.get<ApiResponse<FiscalPeriod[]>>(
      this.getApiUrl('fiscal-periods'),
    );
  }

  createFiscalPeriod(dto: CreateFiscalPeriodDto): Observable<ApiResponse<FiscalPeriod>> {
    return this.http.post<ApiResponse<FiscalPeriod>>(
      this.getApiUrl('fiscal-periods'),
      dto,
    );
  }

  closeFiscalPeriod(id: number): Observable<ApiResponse<FiscalPeriod>> {
    return this.http.post<ApiResponse<FiscalPeriod>>(
      this.getApiUrl(`fiscal-periods/${id}/close`),
      {},
    );
  }

  // ── Reports ──────────────────────────────────────────────────────
  getTrialBalance(query: ReportQueryDto): Observable<ApiResponse<TrialBalanceReport>> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<ApiResponse<TrialBalanceReport>>(
      this.getApiUrl('reports/trial-balance'),
      { params },
    );
  }

  getBalanceSheet(query: ReportQueryDto): Observable<ApiResponse<BalanceSheetReport>> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<ApiResponse<BalanceSheetReport>>(
      this.getApiUrl('reports/balance-sheet'),
      { params },
    );
  }

  getIncomeStatement(query: ReportQueryDto): Observable<ApiResponse<IncomeStatementReport>> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<ApiResponse<IncomeStatementReport>>(
      this.getApiUrl('reports/income-statement'),
      { params },
    );
  }

  getGeneralLedger(query: ReportQueryDto): Observable<ApiResponse<GeneralLedgerReport>> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<ApiResponse<GeneralLedgerReport>>(
      this.getApiUrl('reports/general-ledger'),
      { params },
    );
  }

  // ── Account Mappings ───────────────────────────────────────────────
  getAccountMappings(params?: { prefix?: string; store_id?: number }): Observable<ApiResponse<AccountMapping[]>> {
    let http_params = new HttpParams();
    if (params?.prefix) http_params = http_params.set('prefix', params.prefix);
    if (params?.store_id) http_params = http_params.set('store_id', params.store_id.toString());
    return this.http.get<ApiResponse<AccountMapping[]>>(
      this.getApiUrl('account-mappings'),
      { params: http_params },
    );
  }

  updateAccountMappings(body: { mappings: Array<{ mapping_key: string; account_id: number }>; store_id?: number }): Observable<ApiResponse<any>> {
    return this.http.put<ApiResponse<any>>(
      this.getApiUrl('account-mappings'),
      body,
    );
  }

  resetAccountMappings(body?: { store_id?: number }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(
      this.getApiUrl('account-mappings/reset'),
      body || {},
    );
  }
}
