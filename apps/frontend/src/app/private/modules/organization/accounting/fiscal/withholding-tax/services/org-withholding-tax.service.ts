import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ApiResponse } from '../../../services/org-accounting.service';
import {
  WithholdingStats,
  UvtValue,
} from '../../../../../store/withholding-tax/interfaces/withholding.interface';
import {
  OrgWithholdingConcept,
  OrgCreateConceptDto,
} from '../interfaces/org-withholding.interface';

/**
 * Organization-scoped withholding-tax service.
 *
 * Consumes /api/organization/withholding-tax/* endpoints exposed by the
 * fiscal_scope=ORGANIZATION consolidation backend. Mirrors the store
 * WithholdingTaxService surface but threads an optional `store_id` into params
 * so the org accounting shell can scope by store or operate consolidated.
 *
 * All responses follow the `{ success, data, meta? }` envelope.
 */
@Injectable({ providedIn: 'root' })
export class OrgWithholdingTaxService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getConcepts(query?: Record<string, any>): Observable<ApiResponse<OrgWithholdingConcept[]>> {
    return this.http.get<ApiResponse<OrgWithholdingConcept[]>>(
      `${this.apiUrl}/organization/withholding-tax/concepts`,
      { params: this.toParams(query) },
    );
  }

  createConcept(dto: OrgCreateConceptDto, query?: Record<string, any>): Observable<ApiResponse<OrgWithholdingConcept>> {
    return this.http.post<ApiResponse<OrgWithholdingConcept>>(
      `${this.apiUrl}/organization/withholding-tax/concepts`,
      dto,
      { params: this.toParams(query) },
    );
  }

  updateConcept(
    id: number,
    dto: Partial<OrgCreateConceptDto>,
    query?: Record<string, any>,
  ): Observable<ApiResponse<OrgWithholdingConcept>> {
    return this.http.put<ApiResponse<OrgWithholdingConcept>>(
      `${this.apiUrl}/organization/withholding-tax/concepts/${id}`,
      dto,
      { params: this.toParams(query) },
    );
  }

  deleteConcept(id: number, query?: Record<string, any>): Observable<ApiResponse<{ id: number }>> {
    return this.http.delete<ApiResponse<{ id: number }>>(
      `${this.apiUrl}/organization/withholding-tax/concepts/${id}`,
      { params: this.toParams(query) },
    );
  }

  getUvtValues(query?: Record<string, any>): Observable<ApiResponse<UvtValue[]>> {
    return this.http.get<ApiResponse<UvtValue[]>>(
      `${this.apiUrl}/organization/withholding-tax/uvt-values`,
      { params: this.toParams(query) },
    );
  }

  createUvtValue(
    dto: { year: number; value_cop: number },
    query?: Record<string, any>,
  ): Observable<ApiResponse<UvtValue>> {
    return this.http.post<ApiResponse<UvtValue>>(
      `${this.apiUrl}/organization/withholding-tax/uvt-values`,
      dto,
      { params: this.toParams(query) },
    );
  }

  calculateWithholding(
    dto: Record<string, any>,
    query?: Record<string, any>,
  ): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(
      `${this.apiUrl}/organization/withholding-tax/calculate`,
      dto,
      { params: this.toParams(query) },
    );
  }

  getStats(query?: Record<string, any>): Observable<ApiResponse<WithholdingStats>> {
    return this.http.get<ApiResponse<WithholdingStats>>(
      `${this.apiUrl}/organization/withholding-tax/stats`,
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
