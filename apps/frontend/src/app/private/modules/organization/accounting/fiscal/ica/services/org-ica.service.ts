import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ApiResponse } from '../../../services/org-accounting.service';

/**
 * ICA municipal rate row. The store ICA module has no shared interfaces file,
 * so the org-scoped types are declared here (single source for org ICA).
 */
export interface IcaRate {
  id: number;
  municipality_code: string;
  municipality_name: string;
  department_name?: string;
  ciiu_code?: string | null;
  rate_per_mil: number;
}

export interface IcaResolvedRate {
  municipality_code: string;
  municipality_name: string;
  rate_per_mil: number;
}

export interface IcaCalculationResult {
  amount: number;
  municipality_code: string;
  ciiu_code?: string;
  rate_per_mil: number;
  ica_amount: number;
}

/**
 * Organization-scoped ICA service.
 *
 * Consumes /api/organization/taxes/ica/* endpoints exposed by the
 * fiscal_scope=ORGANIZATION consolidation backend. Threads an optional
 * `store_id` so the org accounting shell can resolve rates per store or
 * operate consolidated. Responses follow `{ success, data, meta? }`.
 */
@Injectable({ providedIn: 'root' })
export class OrgIcaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getRates(query?: Record<string, any>): Observable<ApiResponse<IcaRate[]>> {
    return this.http.get<ApiResponse<IcaRate[]>>(
      `${this.apiUrl}/organization/taxes/ica/rates`,
      { params: this.toParams(query) },
    );
  }

  resolveRate(query?: Record<string, any>): Observable<ApiResponse<IcaResolvedRate>> {
    return this.http.get<ApiResponse<IcaResolvedRate>>(
      `${this.apiUrl}/organization/taxes/ica/resolve`,
      { params: this.toParams(query) },
    );
  }

  calculateIca(
    dto: { amount: number; municipality_code: string; ciiu_code?: string },
    query?: Record<string, any>,
  ): Observable<ApiResponse<IcaCalculationResult>> {
    return this.http.post<ApiResponse<IcaCalculationResult>>(
      `${this.apiUrl}/organization/taxes/ica/calculate`,
      dto,
      { params: this.toParams(query) },
    );
  }

  getReport(period: string, query?: Record<string, any>): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(
      `${this.apiUrl}/organization/taxes/ica/report`,
      { params: this.toParams({ period, ...query }) },
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
