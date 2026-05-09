import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface OrgSalesSummary {
  total_orders?: number;
  total_revenue?: string | number;
  total_taxes?: string | number;
  total_discounts?: string | number;
  net_revenue?: string | number;
  by_store?: Array<{ store_id: number; store_name: string; total: string | number; orders: number }>;
  [k: string]: any;
}

export interface OrgInventorySummary {
  total_products?: number;
  total_units?: number;
  total_value?: string | number;
  by_store?: Array<{ store_id: number; store_name: string; units: number; value: string | number }>;
  [k: string]: any;
}

export interface TrialBalanceLine {
  account_code: string;
  account_name: string;
  debit: string | number;
  credit: string | number;
  balance?: string | number;
}

export interface OrgTrialBalance {
  period_start?: string;
  period_end?: string;
  lines?: TrialBalanceLine[];
  total_debit?: string | number;
  total_credit?: string | number;
  [k: string]: any;
}

/**
 * Organization-scoped consolidated reports service.
 */
@Injectable({ providedIn: 'root' })
export class OrgReportsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getSalesSummary(query?: { date_from?: string; date_to?: string; store_id?: number | string }): Observable<ApiResponse<OrgSalesSummary>> {
    return this.http.get<ApiResponse<OrgSalesSummary>>(
      `${this.apiUrl}/organization/reports/sales/summary`,
      { params: this.toParams(query) },
    );
  }

  getInventorySummary(query?: { store_id?: number | string }): Observable<ApiResponse<OrgInventorySummary>> {
    return this.http.get<ApiResponse<OrgInventorySummary>>(
      `${this.apiUrl}/organization/reports/inventory/summary`,
      { params: this.toParams(query) },
    );
  }

  getTrialBalance(query?: { period_id?: number | string; date_from?: string; date_to?: string }): Observable<ApiResponse<OrgTrialBalance>> {
    return this.http.get<ApiResponse<OrgTrialBalance>>(
      `${this.apiUrl}/organization/reports/financial/trial-balance`,
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
