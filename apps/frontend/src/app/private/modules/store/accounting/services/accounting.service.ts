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
  FixedAsset,
  FixedAssetCategory,
  DepreciationEntry,
  DepreciationScheduleEntry,
  AssetReportRow,
  Budget,
  BudgetLine,
  VarianceRow,
  MonthlyTrendData,
  VarianceAlert,
  ConsolidationSession,
  IntercompanyTransaction,
  ConsolidationAdjustment,
  ConsolidatedReport,
  CreateConsolidationSessionDto,
  CreateConsolidationAdjustmentDto,
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
    return this.http.patch<ApiResponse<JournalEntry>>(
      this.getApiUrl(`journal-entries/${id}/post`),
      {},
    );
  }

  voidJournalEntry(id: number): Observable<ApiResponse<JournalEntry>> {
    return this.http.patch<ApiResponse<JournalEntry>>(
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

  // ── Fixed Assets ───────────────────────────────────────────────
  getFixedAssets(query?: Record<string, any>): Observable<ApiResponse<FixedAsset[]>> {
    const params: Record<string, any> = {};
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<FixedAsset[]>>(
      this.getApiUrl('fixed-assets'),
      { params },
    );
  }

  getFixedAsset(id: number): Observable<ApiResponse<FixedAsset>> {
    return this.http.get<ApiResponse<FixedAsset>>(
      this.getApiUrl(`fixed-assets/${id}`),
    );
  }

  createFixedAsset(dto: Partial<FixedAsset>): Observable<ApiResponse<FixedAsset>> {
    return this.http.post<ApiResponse<FixedAsset>>(
      this.getApiUrl('fixed-assets'),
      dto,
    );
  }

  updateFixedAsset(id: number, dto: Partial<FixedAsset>): Observable<ApiResponse<FixedAsset>> {
    return this.http.patch<ApiResponse<FixedAsset>>(
      this.getApiUrl(`fixed-assets/${id}`),
      dto,
    );
  }

  retireAsset(id: number): Observable<ApiResponse<FixedAsset>> {
    return this.http.post<ApiResponse<FixedAsset>>(
      this.getApiUrl(`fixed-assets/${id}/retire`),
      {},
    );
  }

  disposeAsset(id: number, dto: { disposal_date: string; disposal_amount: number }): Observable<ApiResponse<FixedAsset>> {
    return this.http.post<ApiResponse<FixedAsset>>(
      this.getApiUrl(`fixed-assets/${id}/dispose`),
      dto,
    );
  }

  getDepreciationSchedule(id: number): Observable<ApiResponse<DepreciationScheduleEntry[]>> {
    return this.http.get<ApiResponse<DepreciationScheduleEntry[]>>(
      this.getApiUrl(`fixed-assets/${id}/schedule`),
    );
  }

  getDepreciationHistory(id: number): Observable<ApiResponse<DepreciationEntry[]>> {
    return this.http.get<ApiResponse<DepreciationEntry[]>>(
      this.getApiUrl(`fixed-assets/${id}/history`),
    );
  }

  runDepreciation(dto: { year: number; month: number }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(
      this.getApiUrl('fixed-assets/depreciation/run'),
      dto,
    );
  }

  getAssetReport(): Observable<ApiResponse<AssetReportRow[]>> {
    return this.http.get<ApiResponse<AssetReportRow[]>>(
      this.getApiUrl('fixed-assets/reports/book-values'),
    );
  }

  // ── Fixed Asset Categories ─────────────────────────────────────
  getFixedAssetCategories(): Observable<ApiResponse<FixedAssetCategory[]>> {
    return this.http.get<ApiResponse<FixedAssetCategory[]>>(
      this.getApiUrl('fixed-asset-categories'),
    );
  }

  createFixedAssetCategory(dto: Partial<FixedAssetCategory>): Observable<ApiResponse<FixedAssetCategory>> {
    return this.http.post<ApiResponse<FixedAssetCategory>>(
      this.getApiUrl('fixed-asset-categories'),
      dto,
    );
  }

  updateFixedAssetCategory(id: number, dto: Partial<FixedAssetCategory>): Observable<ApiResponse<FixedAssetCategory>> {
    return this.http.patch<ApiResponse<FixedAssetCategory>>(
      this.getApiUrl(`fixed-asset-categories/${id}`),
      dto,
    );
  }

  deleteFixedAssetCategory(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`fixed-asset-categories/${id}`),
    );
  }

  // ── Budgets ───────────────────────────────────────────────────────
  getBudgets(query?: Record<string, any>): Observable<ApiResponse<Budget[]>> {
    const params: Record<string, any> = {};
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<Budget[]>>(
      this.getApiUrl('budgets'),
      { params },
    );
  }

  getBudget(id: number): Observable<ApiResponse<Budget>> {
    return this.http.get<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}`),
    );
  }

  createBudget(dto: Partial<Budget>): Observable<ApiResponse<Budget>> {
    return this.http.post<ApiResponse<Budget>>(
      this.getApiUrl('budgets'),
      dto,
    );
  }

  updateBudget(id: number, dto: Partial<Budget>): Observable<ApiResponse<Budget>> {
    return this.http.patch<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}`),
      dto,
    );
  }

  updateBudgetLines(id: number, lines: Partial<BudgetLine>[]): Observable<ApiResponse<Budget>> {
    return this.http.patch<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}/lines`),
      { lines },
    );
  }

  approveBudget(id: number): Observable<ApiResponse<Budget>> {
    return this.http.patch<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}/approve`),
      {},
    );
  }

  activateBudget(id: number): Observable<ApiResponse<Budget>> {
    return this.http.patch<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}/activate`),
      {},
    );
  }

  closeBudget(id: number): Observable<ApiResponse<Budget>> {
    return this.http.patch<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}/close`),
      {},
    );
  }

  deleteBudget(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`budgets/${id}`),
    );
  }

  duplicateBudget(id: number, fiscal_period_id: number): Observable<ApiResponse<Budget>> {
    return this.http.post<ApiResponse<Budget>>(
      this.getApiUrl(`budgets/${id}/duplicate`),
      { fiscal_period_id },
    );
  }

  getBudgetVariance(id: number, month?: number): Observable<ApiResponse<VarianceRow[]>> {
    const params: Record<string, any> = {};
    if (month !== undefined && month !== null) {
      params['month'] = month;
    }
    return this.http.get<ApiResponse<VarianceRow[]>>(
      this.getApiUrl(`budgets/${id}/variance`),
      { params },
    );
  }

  getBudgetMonthlyTrend(id: number): Observable<ApiResponse<MonthlyTrendData[]>> {
    return this.http.get<ApiResponse<MonthlyTrendData[]>>(
      this.getApiUrl(`budgets/${id}/monthly-trend`),
    );
  }

  getBudgetAlerts(id: number): Observable<ApiResponse<VarianceAlert[]>> {
    return this.http.get<ApiResponse<VarianceAlert[]>>(
      this.getApiUrl(`budgets/${id}/alerts`),
    );
  }

  // ── Consolidation ──────────────────────────────────────────────
  getConsolidationSessions(query?: Record<string, any>): Observable<ApiResponse<ConsolidationSession[]>> {
    const params: Record<string, any> = {};
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<ConsolidationSession[]>>(
      this.getApiUrl('consolidation/sessions'),
      { params },
    );
  }

  getConsolidationSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.get<ApiResponse<ConsolidationSession>>(
      this.getApiUrl(`consolidation/sessions/${id}`),
    );
  }

  createConsolidationSession(dto: CreateConsolidationSessionDto): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.post<ApiResponse<ConsolidationSession>>(
      this.getApiUrl('consolidation/sessions'),
      dto,
    );
  }

  startConsolidationSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.patch<ApiResponse<ConsolidationSession>>(
      this.getApiUrl(`consolidation/sessions/${id}/start`),
      {},
    );
  }

  completeConsolidationSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.patch<ApiResponse<ConsolidationSession>>(
      this.getApiUrl(`consolidation/sessions/${id}/complete`),
      {},
    );
  }

  cancelConsolidationSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.patch<ApiResponse<ConsolidationSession>>(
      this.getApiUrl(`consolidation/sessions/${id}/cancel`),
      {},
    );
  }

  getIntercompanyTransactions(session_id: number): Observable<ApiResponse<IntercompanyTransaction[]>> {
    return this.http.get<ApiResponse<IntercompanyTransaction[]>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/intercompany`),
    );
  }

  detectIntercompanyTransactions(session_id: number): Observable<ApiResponse<IntercompanyTransaction[]>> {
    return this.http.post<ApiResponse<IntercompanyTransaction[]>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/detect`),
      {},
    );
  }

  eliminateAllIntercompany(session_id: number): Observable<ApiResponse<any>> {
    return this.http.patch<ApiResponse<any>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/eliminate-all`),
      {},
    );
  }

  eliminateIntercompany(txn_id: number): Observable<ApiResponse<IntercompanyTransaction>> {
    return this.http.patch<ApiResponse<IntercompanyTransaction>>(
      this.getApiUrl(`consolidation/intercompany/${txn_id}/eliminate`),
      {},
    );
  }

  addConsolidationAdjustment(session_id: number, dto: CreateConsolidationAdjustmentDto): Observable<ApiResponse<ConsolidationAdjustment>> {
    return this.http.post<ApiResponse<ConsolidationAdjustment>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/adjustments`),
      dto,
    );
  }

  removeConsolidationAdjustment(adj_id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`consolidation/adjustments/${adj_id}`),
    );
  }

  getConsolidatedTrialBalance(session_id: number): Observable<ApiResponse<ConsolidatedReport>> {
    return this.http.get<ApiResponse<ConsolidatedReport>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/reports/trial-balance`),
    );
  }

  getConsolidatedBalanceSheet(session_id: number): Observable<ApiResponse<ConsolidatedReport>> {
    return this.http.get<ApiResponse<ConsolidatedReport>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/reports/balance-sheet`),
    );
  }

  getConsolidatedIncomeStatement(session_id: number): Observable<ApiResponse<ConsolidatedReport>> {
    return this.http.get<ApiResponse<ConsolidatedReport>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/reports/income-statement`),
    );
  }

  getEliminationDetail(session_id: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/reports/eliminations`),
    );
  }

  autoEliminateIntercompany(session_id: number): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/auto-eliminate`),
      {},
    );
  }

  getConsolidationTransactions(session_id: number, filters?: Record<string, any>): Observable<ApiResponse<any>> {
    const params: Record<string, any> = {};
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== '') {
          params[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<any>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/transactions`),
      { params },
    );
  }

  exportConsolidation(session_id: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(
      this.getApiUrl(`consolidation/sessions/${session_id}/export`),
    );
  }
}
