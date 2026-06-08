import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ApiResponse } from '../../../services/org-accounting.service';
import {
  ExogenousReport,
  ExogenousReportLine,
  ExogenousStats,
} from '../../../../../store/exogenous/interfaces/exogenous.interface';

/**
 * Organization-scoped exógena (información exógena DIAN) service.
 *
 * Consumes /api/organization/exogenous/* endpoints exposed by the
 * fiscal_scope=ORGANIZATION consolidation backend. Threads an optional
 * `store_id` so the org accounting shell can scope reports per store or
 * operate consolidated. Responses follow `{ success, data, meta? }`.
 */
@Injectable({ providedIn: 'root' })
export class OrgExogenousService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getReports(query?: Record<string, any>): Observable<ApiResponse<ExogenousReport[]>> {
    return this.http.get<ApiResponse<ExogenousReport[]>>(
      `${this.apiUrl}/organization/exogenous/reports`,
      { params: this.toParams(query) },
    );
  }

  generateReport(
    dto: { fiscal_year: number; format_code: string },
    query?: Record<string, any>,
  ): Observable<ApiResponse<ExogenousReport>> {
    return this.http.post<ApiResponse<ExogenousReport>>(
      `${this.apiUrl}/organization/exogenous/reports/generate`,
      dto,
      { params: this.toParams(query) },
    );
  }

  getReport(id: number, query?: Record<string, any>): Observable<ApiResponse<ExogenousReport>> {
    return this.http.get<ApiResponse<ExogenousReport>>(
      `${this.apiUrl}/organization/exogenous/reports/${id}`,
      { params: this.toParams(query) },
    );
  }

  getReportLines(
    id: number,
    query?: Record<string, any>,
  ): Observable<ApiResponse<ExogenousReportLine[]>> {
    return this.http.get<ApiResponse<ExogenousReportLine[]>>(
      `${this.apiUrl}/organization/exogenous/reports/${id}/lines`,
      { params: this.toParams({ page: 1, limit: 50, ...query }) },
    );
  }

  submitReport(id: number, query?: Record<string, any>): Observable<ApiResponse<ExogenousReport>> {
    return this.http.post<ApiResponse<ExogenousReport>>(
      `${this.apiUrl}/organization/exogenous/reports/${id}/submit`,
      {},
      { params: this.toParams(query) },
    );
  }

  validateYear(year: number, query?: Record<string, any>): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(
      `${this.apiUrl}/organization/exogenous/validate/${year}`,
      { params: this.toParams(query) },
    );
  }

  getStats(year: number, query?: Record<string, any>): Observable<ApiResponse<ExogenousStats>> {
    return this.http.get<ApiResponse<ExogenousStats>>(
      `${this.apiUrl}/organization/exogenous/stats/${year}`,
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
