import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    total_pages?: number;
  };
}

export interface ChartAccountRow {
  id: number;
  code?: string;
  name?: string;
  account_code?: string;
  account_name?: string;
  account_type?: string;
  nature?: string;
  is_active?: boolean;
  accepts_entries?: boolean;
  parent_id?: number | null;
  level?: number;
  children?: Array<{ id: number; code: string; name: string }>;
}

export interface JournalEntryRow {
  id: number;
  entry_number?: string;
  entry_date?: string;
  description?: string;
  status?: string;
  total_debit?: string | number;
  total_credit?: string | number;
  store_id?: number | null;
  store?: { id: number; name: string } | null;
}

export interface FiscalPeriodRow {
  id: number;
  name?: string;
  period_year?: number | null;
  start_date?: string;
  end_date?: string;
  status?: string;
  _count?: { accounting_entries?: number };
}

export interface AccountMappingRow {
  id?: number;
  mapping_key: string;
  account_id?: number | null;
  account_code?: string | null;
  account_name?: string | null;
  description?: string | null;
  source?: 'store' | 'organization' | 'default';
}

/**
 * Organization-scoped read-only accounting service.
 *
 * Consumes /api/organization/accounting/* endpoints exposed by the
 * operating_scope consolidation backend (Fase 5).
 */
@Injectable({ providedIn: 'root' })
export class OrgAccountingService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getChartOfAccounts(query?: Record<string, any>): Observable<ApiResponse<ChartAccountRow[]>> {
    return this.http.get<ApiResponse<ChartAccountRow[]>>(
      `${this.apiUrl}/organization/accounting/chart-of-accounts`,
      { params: this.toParams(query) },
    );
  }

  getJournalEntries(query?: Record<string, any>): Observable<ApiResponse<JournalEntryRow[]>> {
    return this.http.get<ApiResponse<JournalEntryRow[]>>(
      `${this.apiUrl}/organization/accounting/journal-entries`,
      { params: this.toParams(query) },
    );
  }

  getFiscalPeriods(query?: Record<string, any>): Observable<ApiResponse<FiscalPeriodRow[]>> {
    return this.http.get<ApiResponse<FiscalPeriodRow[]>>(
      `${this.apiUrl}/organization/accounting/fiscal-periods`,
      { params: this.toParams(query) },
    );
  }

  getAccountMappings(query?: Record<string, any>): Observable<ApiResponse<AccountMappingRow[]>> {
    return this.http.get<ApiResponse<AccountMappingRow[]>>(
      `${this.apiUrl}/organization/accounting/mappings`,
      { params: this.toParams(query) },
    );
  }

  private toParams(query?: Record<string, any>): HttpParams {
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
