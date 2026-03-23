import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  BankAccount,
  BankTransaction,
  BankReconciliation,
  ReconciliationMatch,
  ImportStatementResult,
  AutoMatchResult,
  ApiResponse,
  AccountingListResponse,
} from '../interfaces/accounting.interface';

@Injectable({
  providedIn: 'root',
})
export class BankReconciliationService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/accounting/bank-reconciliation${endpoint ? '/' + endpoint : ''}`;
  }

  // ── Bank Accounts ──────────────────────────────────────────────
  getBankAccounts(params?: Record<string, any>): Observable<ApiResponse<BankAccount[]>> {
    const cleanParams: Record<string, any> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          cleanParams[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<BankAccount[]>>(
      this.getApiUrl('accounts'),
      { params: cleanParams },
    );
  }

  getBankAccount(id: number): Observable<ApiResponse<BankAccount>> {
    return this.http.get<ApiResponse<BankAccount>>(
      this.getApiUrl(`accounts/${id}`),
    );
  }

  createBankAccount(dto: Partial<BankAccount>): Observable<ApiResponse<BankAccount>> {
    return this.http.post<ApiResponse<BankAccount>>(
      this.getApiUrl('accounts'),
      dto,
    );
  }

  updateBankAccount(id: number, dto: Partial<BankAccount>): Observable<ApiResponse<BankAccount>> {
    return this.http.patch<ApiResponse<BankAccount>>(
      this.getApiUrl(`accounts/${id}`),
      dto,
    );
  }

  deleteBankAccount(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`accounts/${id}`),
    );
  }

  // ── Transactions ───────────────────────────────────────────────
  getTransactions(params: Record<string, any>): Observable<AccountingListResponse<BankTransaction>> {
    const cleanParams: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        cleanParams[key] = value;
      }
    }
    return this.http.get<AccountingListResponse<BankTransaction>>(
      this.getApiUrl('transactions'),
      { params: cleanParams },
    );
  }

  importStatement(bank_account_id: number, file: File): Observable<ApiResponse<ImportStatementResult>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('bank_account_id', bank_account_id.toString());
    return this.http.post<ApiResponse<ImportStatementResult>>(
      this.getApiUrl('transactions/import'),
      formData,
    );
  }

  previewImport(bank_account_id: number, file: File): Observable<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('bank_account_id', bank_account_id.toString());
    return this.http.post<ApiResponse<any>>(
      this.getApiUrl('transactions/import/preview'),
      formData,
    );
  }

  deleteTransaction(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`transactions/${id}`),
    );
  }

  // ── Reconciliations ────────────────────────────────────────────
  getReconciliations(params?: Record<string, any>): Observable<ApiResponse<BankReconciliation[]>> {
    const cleanParams: Record<string, any> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          cleanParams[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<BankReconciliation[]>>(
      this.getApiUrl('reconciliations'),
      { params: cleanParams },
    );
  }

  getReconciliation(id: number): Observable<ApiResponse<BankReconciliation & { matches: ReconciliationMatch[]; bank_transactions: BankTransaction[] }>> {
    return this.http.get<ApiResponse<BankReconciliation & { matches: ReconciliationMatch[]; bank_transactions: BankTransaction[] }>>(
      this.getApiUrl(`reconciliations/${id}`),
    );
  }

  createReconciliation(dto: { bank_account_id: number; period_start: string; period_end: string }): Observable<ApiResponse<BankReconciliation>> {
    return this.http.post<ApiResponse<BankReconciliation>>(
      this.getApiUrl('reconciliations'),
      dto,
    );
  }

  runAutoMatch(reconciliation_id: number): Observable<ApiResponse<AutoMatchResult>> {
    return this.http.post<ApiResponse<AutoMatchResult>>(
      this.getApiUrl(`reconciliations/${reconciliation_id}/auto-match`),
      {},
    );
  }

  createManualMatch(reconciliation_id: number, dto: { bank_transaction_id: number; accounting_entry_id: number }): Observable<ApiResponse<ReconciliationMatch>> {
    return this.http.post<ApiResponse<ReconciliationMatch>>(
      this.getApiUrl(`reconciliations/${reconciliation_id}/manual-match`),
      dto,
    );
  }

  unmatch(reconciliation_id: number, match_id: number): Observable<ApiResponse<null>> {
    return this.http.post<ApiResponse<null>>(
      this.getApiUrl(`reconciliations/${reconciliation_id}/unmatch/${match_id}`),
      {},
    );
  }

  completeReconciliation(id: number): Observable<ApiResponse<BankReconciliation>> {
    return this.http.patch<ApiResponse<BankReconciliation>>(
      this.getApiUrl(`reconciliations/${id}/complete`),
      {},
    );
  }

  deleteReconciliation(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(
      this.getApiUrl(`reconciliations/${id}`),
    );
  }
}
