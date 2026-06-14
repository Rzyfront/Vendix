import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, map } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import {
  AccountMapping,
  ApiResponse,
  BalanceSheetReport,
  ChartAccount,
  ChartOfAccountsQuery,
  CreateChartAccountDto,
  CreateManualJournalEntryDto,
  DashboardKpis,
  FiscalPeriod,
  GeneralLedgerRow,
  IncomeStatementReport,
  JournalEntry,
  JournalEntryQuery,
  Obligation,
  PaginatedResponse,
  TrialBalanceRow,
} from '../interfaces/superadmin-fiscal.interface';

type VoidResponse = void;

@Injectable({ providedIn: 'root' })
export class SuperadminFiscalService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/super-admin/fiscal`;

  // ─── Dashboard ──────────────────────────────────────────────────────────

  /**
   * Computes the dashboard KPIs client-side from the existing endpoints:
   * - Revenue / refunds / partner payouts / manual entries: derived from
   *   `/accounting/journal-entries` filtered by `source_type` and date range.
   * - Pending obligations: from `/obligations` for the current YYYY-MM period.
   * - Current fiscal period: from `/accounting/fiscal-periods` (open one).
   *
   * The page passes `periodDays` so the same composite works for "last 30/90/365".
   */
  getDashboardKpis(periodDays: number): Observable<DashboardKpis | null> {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - periodDays);
    const fromIso = start.toISOString().slice(0, 10);
    const toIso = today.toISOString().slice(0, 10);

    const period = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}`;

    return forkJoin({
      revenue: this.getJournalEntries({
        from: fromIso,
        to: toIso,
        source_type: 'saas_revenue',
        page: 1,
        limit: 100,
      }),
      payouts: this.getJournalEntries({
        from: fromIso,
        to: toIso,
        source_type: 'saas_partner_payout_paid',
        page: 1,
        limit: 100,
      }),
      refunds: this.getJournalEntries({
        from: fromIso,
        to: toIso,
        source_type: 'saas_refund',
        page: 1,
        limit: 100,
      }),
      manual: this.getJournalEntries({
        from: fromIso,
        to: toIso,
        source_type: 'manual_journal_entry',
        page: 1,
        limit: 100,
      }),
      obligations: this.getObligations(period),
      periods: this.getFiscalPeriods(),
    }).pipe(
      map(({ revenue, payouts, refunds, manual, obligations, periods }) => {
        const sum = (rows: JournalEntry[], key: 'total_debit' | 'total_credit') =>
          rows.reduce(
            (acc, r) => acc + Number(r[key] ?? 0) || 0,
            0,
          );

        const openPeriod = periods.find((p) => p.state === 'open') ?? null;
        const daysRemaining = openPeriod
          ? Math.max(
              0,
              Math.ceil(
                (new Date(openPeriod.end_date).getTime() - today.getTime()) /
                  86400000,
              ),
            )
          : 0;

        const pendingObligations = obligations.filter(
          (o) => o.status !== 'filed' && o.status !== 'submitted' && o.status !== 'not_applicable',
        ).length;

        const kpis: DashboardKpis = {
          revenue_month: sum(revenue.data, 'total_debit').toFixed(2),
          partner_payouts_month: sum(payouts.data, 'total_credit').toFixed(2),
          refunds_month: sum(refunds.data, 'total_credit').toFixed(2),
          manual_entries_count: manual.meta?.total ?? manual.data.length,
          pending_obligations: pendingObligations,
          current_period: openPeriod
            ? {
                id: openPeriod.id,
                name: openPeriod.name,
                days_remaining: daysRemaining,
                closes_at: openPeriod.end_date,
              }
            : null,
        };
        return kpis;
      }),
    );
  }

  // ─── Chart of Accounts ──────────────────────────────────────────────────

  getChartOfAccounts(
    query: ChartOfAccountsQuery = {},
  ): Observable<PaginatedResponse<ChartAccount>> {
    let params = new HttpParams();
    if (query.search) params = params.set('search', query.search);
    if (query.account_type) params = params.set('account_type', query.account_type);
    if (query.page) params = params.set('page', String(query.page));
    if (query.limit) params = params.set('limit', String(query.limit));

    return this.http.get<PaginatedResponse<ChartAccount>>(
      `${this.base}/accounting/chart-of-accounts`,
      { params },
    );
  }

  getChartAccountByCode(code: string): Observable<ChartAccount | null> {
    return this.http
      .get<ApiResponse<ChartAccount>>(
        `${this.base}/accounting/chart-of-accounts/${encodeURIComponent(code)}`,
      )
      .pipe(map((res) => (res?.success ? res.data : null)));
  }

  createChartAccount(dto: CreateChartAccountDto): Observable<ChartAccount | null> {
    return this.http
      .post<ApiResponse<ChartAccount>>(
        `${this.base}/accounting/chart-of-accounts`,
        dto,
      )
      .pipe(map((res) => (res?.success ? res.data : null)));
  }

  // ─── Journal Entries ────────────────────────────────────────────────────

  getJournalEntries(
    query: JournalEntryQuery = {},
  ): Observable<PaginatedResponse<JournalEntry>> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', String(query.page));
    if (query.limit) params = params.set('limit', String(query.limit));
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.source_type && query.source_type !== 'all') {
      params = params.set('source_type', query.source_type);
    }
    if (query.fiscal_period_id) {
      params = params.set('fiscal_period_id', query.fiscal_period_id);
    }
    if (query.search) params = params.set('search', query.search);

    return this.http.get<PaginatedResponse<JournalEntry>>(
      `${this.base}/accounting/journal-entries`,
      { params },
    );
  }

  createManualJournalEntry(
    dto: CreateManualJournalEntryDto,
  ): Observable<JournalEntry | null> {
    return this.http
      .post<ApiResponse<JournalEntry>>(
        `${this.base}/accounting/journal-entries`,
        dto,
      )
      .pipe(map((res) => (res?.success ? res.data : null)));
  }

  // ─── Account Mappings ───────────────────────────────────────────────────

  getAccountMappings(prefix?: string): Observable<AccountMapping[]> {
    let params = new HttpParams();
    if (prefix) params = params.set('prefix', prefix);

    return this.http
      .get<ApiResponse<AccountMapping[]>>(
        `${this.base}/accounting/account-mappings`,
        { params },
      )
      .pipe(map((res) => (res?.success ? res.data : [])));
  }

  setMappingOverride(key: string, account_code: string): Observable<VoidResponse> {
    return this.http
      .patch<ApiResponse<void>>(
        `${this.base}/accounting/account-mappings/${encodeURIComponent(key)}`,
        { account_code },
      )
      .pipe(map(() => undefined));
  }

  resetMappingOverride(key: string): Observable<VoidResponse> {
    return this.http
      .post<ApiResponse<void>>(
        `${this.base}/accounting/account-mappings/${encodeURIComponent(key)}/reset`,
        {},
      )
      .pipe(map(() => undefined));
  }

  // ─── Reports ────────────────────────────────────────────────────────────

  getTrialBalance(params: { from: string; to: string }): Observable<TrialBalanceRow[]> {
    const httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to);

    return this.http
      .get<ApiResponse<TrialBalanceRow[]>>(
        `${this.base}/accounting/reports/trial-balance`,
        { params: httpParams },
      )
      .pipe(map((res) => (res?.success ? res.data : [])));
  }

  getBalanceSheet(as_of: string): Observable<BalanceSheetReport | null> {
    const params = new HttpParams().set('as_of', as_of);
    return this.http
      .get<ApiResponse<BalanceSheetReport>>(
        `${this.base}/accounting/reports/balance-sheet`,
        { params },
      )
      .pipe(map((res) => (res?.success ? res.data : null)));
  }

  getIncomeStatement(params: {
    from: string;
    to: string;
  }): Observable<IncomeStatementReport | null> {
    const httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to);

    return this.http
      .get<ApiResponse<IncomeStatementReport>>(
        `${this.base}/accounting/reports/income-statement`,
        { params: httpParams },
      )
      .pipe(map((res) => (res?.success ? res.data : null)));
  }

  getGeneralLedger(params: {
    account_code: string;
    from: string;
    to: string;
  }): Observable<GeneralLedgerRow[]> {
    const httpParams = new HttpParams()
      .set('account_code', params.account_code)
      .set('from', params.from)
      .set('to', params.to);

    return this.http
      .get<ApiResponse<GeneralLedgerRow[]>>(
        `${this.base}/accounting/reports/general-ledger`,
        { params: httpParams },
      )
      .pipe(map((res) => (res?.success ? res.data : [])));
  }

  // ─── Obligations ────────────────────────────────────────────────────────

  getObligations(period: string): Observable<Obligation[]> {
    const params = new HttpParams().set('period', period);
    return this.http
      .get<ApiResponse<Obligation[]>>(`${this.base}/obligations`, { params })
      .pipe(map((res) => (res?.success ? res.data : [])));
  }

  // ─── Fiscal Periods (referenced by manual entry form) ───────────────────

  getFiscalPeriods(): Observable<FiscalPeriod[]> {
    return this.http
      .get<ApiResponse<FiscalPeriod[]>>(
        `${this.base}/accounting/fiscal-periods`,
      )
      .pipe(map((res) => (res?.success ? res.data : [])));
  }
}
