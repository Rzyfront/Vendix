import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from './org-accounting.service';

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror the backend consolidation contract
// (apps/backend/src/domains/store/accounting/consolidation)
// ─────────────────────────────────────────────────────────────────────────

export type ConsolidationStatus =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type AdjustmentType = 'elimination' | 'reclassification' | 'adjustment';

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense';

export interface ConsolidationFiscalPeriod {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
}

export interface ConsolidationStoreRef {
  id: number;
  name: string;
}

export interface ConsolidationAccountRef {
  id: number;
  code: string;
  name: string;
}

export interface ConsolidationAdjustment {
  id: number;
  session_id: number;
  account_id: number;
  type: AdjustmentType;
  debit_amount: string | number;
  credit_amount: string | number;
  description: string;
  store_id: number | null;
  created_by_user_id?: number | null;
  created_at?: string;
  updated_at?: string;
  account?: ConsolidationAccountRef;
  store?: ConsolidationStoreRef | null;
}

export interface ConsolidationSession {
  id: number;
  organization_id: number;
  fiscal_period_id: number;
  name: string;
  status: ConsolidationStatus;
  session_date: string;
  notes: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  fiscal_period?: ConsolidationFiscalPeriod;
  created_by?: { id: number; first_name: string; last_name: string };
  adjustments?: ConsolidationAdjustment[];
  _count?: { adjustments: number; intercompany_txns: number };
}

export interface IntercompanyTransaction {
  id: number;
  organization_id?: number;
  session_id: number;
  from_store_id: number;
  to_store_id: number;
  entry_id?: number;
  counterpart_entry_id?: number;
  account_id: number;
  amount: string | number;
  eliminated: boolean;
  eliminated_at: string | null;
  created_at?: string;
  updated_at?: string;
  from_store?: ConsolidationStoreRef;
  to_store?: ConsolidationStoreRef;
  account?: ConsolidationAccountRef;
}

export interface TrialBalanceAccountRow {
  account_id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  nature: string;
  total_debit: number;
  total_credit: number;
  balance: number;
}

export interface TrialBalanceBlock {
  accounts: TrialBalanceAccountRow[];
  totals: { total_debit: number; total_credit: number };
}

export interface TrialBalanceReport {
  session: ConsolidationSession;
  combined: TrialBalanceBlock;
  adjustments: ConsolidationAdjustment[];
  consolidated: TrialBalanceBlock;
}

export interface StatementSection {
  accounts: TrialBalanceAccountRow[];
  total: number;
}

export interface BalanceSheetBlock {
  fiscal_period?: ConsolidationFiscalPeriod;
  assets: StatementSection;
  liabilities: StatementSection;
  equity: StatementSection;
  balance_check: {
    total_assets: number;
    total_liabilities_and_equity: number;
    is_balanced: boolean;
  };
}

export interface BalanceSheetReport {
  session: ConsolidationSession;
  stores: Array<{ store: ConsolidationStoreRef; balance: BalanceSheetBlock }>;
  combined: BalanceSheetBlock;
  adjustments: ConsolidationAdjustment[];
  consolidated: BalanceSheetBlock;
}

export interface IncomeStatementBlock {
  fiscal_period?: ConsolidationFiscalPeriod;
  revenue: StatementSection;
  expenses: StatementSection;
  net_income: number;
}

export interface IncomeStatementReport {
  session: ConsolidationSession;
  stores: Array<{ store: ConsolidationStoreRef; statement: IncomeStatementBlock }>;
  combined: IncomeStatementBlock;
  adjustments: ConsolidationAdjustment[];
  consolidated: IncomeStatementBlock;
}

export interface EliminationsReport {
  session: ConsolidationSession;
  intercompany_transactions: IntercompanyTransaction[];
  elimination_adjustments: ConsolidationAdjustment[];
  summary: {
    total_transactions_eliminated: number;
    total_amount_eliminated: number;
  };
}

export interface DetectResult {
  detected: number;
  transactions: IntercompanyTransaction[];
}

export interface AutoEliminateResult {
  eliminated_count: number;
  matched_pairs: number;
  unmatched_eliminated: number;
}

export interface CreateSessionPayload {
  fiscal_period_id: number;
  name: string;
  notes?: string;
}

export interface CreateAdjustmentPayload {
  account_id: number;
  type: AdjustmentType;
  debit_amount: number;
  credit_amount: number;
  description: string;
  store_id?: number;
}

/**
 * Organization-level consolidation accounting service.
 *
 * Consumes the backend consolidation controller mounted at
 * `store/accounting/consolidation/*`. The backend resolves the active
 * organization from the authenticated context (scoped Prisma), so no
 * organization_id is sent from the client.
 */
@Injectable({ providedIn: 'root' })
export class OrgConsolidationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/accounting/consolidation`;

  // ===== Sessions CRUD / lifecycle =====

  listSessions(
    query?: Record<string, unknown>,
  ): Observable<ApiResponse<ConsolidationSession[]>> {
    return this.http.get<ApiResponse<ConsolidationSession[]>>(
      `${this.base}/sessions`,
      { params: this.toParams(query) },
    );
  }

  getSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.get<ApiResponse<ConsolidationSession>>(
      `${this.base}/sessions/${id}`,
    );
  }

  createSession(
    payload: CreateSessionPayload,
  ): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.post<ApiResponse<ConsolidationSession>>(
      `${this.base}/sessions`,
      payload,
    );
  }

  startSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.patch<ApiResponse<ConsolidationSession>>(
      `${this.base}/sessions/${id}/start`,
      {},
    );
  }

  completeSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.patch<ApiResponse<ConsolidationSession>>(
      `${this.base}/sessions/${id}/complete`,
      {},
    );
  }

  cancelSession(id: number): Observable<ApiResponse<ConsolidationSession>> {
    return this.http.patch<ApiResponse<ConsolidationSession>>(
      `${this.base}/sessions/${id}/cancel`,
      {},
    );
  }

  // ===== Intercompany =====

  getIntercompany(
    id: number,
    query?: Record<string, unknown>,
  ): Observable<ApiResponse<IntercompanyTransaction[]>> {
    return this.http.get<ApiResponse<IntercompanyTransaction[]>>(
      `${this.base}/sessions/${id}/intercompany`,
      { params: this.toParams(query) },
    );
  }

  detectIntercompany(id: number): Observable<ApiResponse<DetectResult>> {
    return this.http.post<ApiResponse<DetectResult>>(
      `${this.base}/sessions/${id}/detect`,
      {},
    );
  }

  eliminateTransaction(
    txnId: number,
  ): Observable<ApiResponse<{ eliminated: boolean; transaction_id: number }>> {
    return this.http.patch<
      ApiResponse<{ eliminated: boolean; transaction_id: number }>
    >(`${this.base}/intercompany/${txnId}/eliminate`, {});
  }

  eliminateAll(
    id: number,
  ): Observable<ApiResponse<{ eliminated_count: number }>> {
    return this.http.patch<ApiResponse<{ eliminated_count: number }>>(
      `${this.base}/sessions/${id}/eliminate-all`,
      {},
    );
  }

  autoEliminate(id: number): Observable<ApiResponse<AutoEliminateResult>> {
    return this.http.post<ApiResponse<AutoEliminateResult>>(
      `${this.base}/sessions/${id}/auto-eliminate`,
      {},
    );
  }

  // ===== Adjustments =====

  addAdjustment(
    id: number,
    payload: CreateAdjustmentPayload,
  ): Observable<ApiResponse<ConsolidationAdjustment>> {
    return this.http.post<ApiResponse<ConsolidationAdjustment>>(
      `${this.base}/sessions/${id}/adjustments`,
      payload,
    );
  }

  removeAdjustment(
    adjId: number,
  ): Observable<ApiResponse<ConsolidationAdjustment>> {
    return this.http.delete<ApiResponse<ConsolidationAdjustment>>(
      `${this.base}/adjustments/${adjId}`,
    );
  }

  // ===== Reports =====

  getTrialBalance(id: number): Observable<ApiResponse<TrialBalanceReport>> {
    return this.http.get<ApiResponse<TrialBalanceReport>>(
      `${this.base}/sessions/${id}/reports/trial-balance`,
    );
  }

  getBalanceSheet(id: number): Observable<ApiResponse<BalanceSheetReport>> {
    return this.http.get<ApiResponse<BalanceSheetReport>>(
      `${this.base}/sessions/${id}/reports/balance-sheet`,
    );
  }

  getIncomeStatement(
    id: number,
  ): Observable<ApiResponse<IncomeStatementReport>> {
    return this.http.get<ApiResponse<IncomeStatementReport>>(
      `${this.base}/sessions/${id}/reports/income-statement`,
    );
  }

  getEliminations(id: number): Observable<ApiResponse<EliminationsReport>> {
    return this.http.get<ApiResponse<EliminationsReport>>(
      `${this.base}/sessions/${id}/reports/eliminations`,
    );
  }

  private toParams(query?: Record<string, unknown>): HttpParams {
    let params = new HttpParams();
    if (!query) return params;
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        params = params.set(k, String(v));
      }
    }
    return params;
  }
}
