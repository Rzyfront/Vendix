import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  PreviewWithholdingRequest,
  WithholdingPreviewResult,
  CreateConceptDto,
  UpdateConceptDto,
  WithholdingCalculation,
  WithholdingCalculationsQuery,
  WithholdingCertificateData,
  PaginatedApiResponse,
} from '../interfaces/withholding.interface';

@Injectable({ providedIn: 'root' })
export class WithholdingTaxService {
  private http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Withholding preview — single source of truth for the cart "Retención"
   * line. The backend resolves the applicable lines and the net withholding;
   * the client only displays the result and never computes the legal logic.
   *
   * Uses the absolute `apiUrl` so the auth interceptor attaches the JWT (store
   * context is derived server-side from the token). Always resolves to a safe
   * empty result on error so the cart never breaks.
   */
  previewWithholding(
    body: PreviewWithholdingRequest,
  ): Observable<WithholdingPreviewResult> {
    return this.http
      .post<{ data: WithholdingPreviewResult }>(
        `${this.apiUrl}/store/withholding-tax/preview`,
        body,
      )
      .pipe(
        map((res) => {
          const data = (res?.data ?? res) as WithholdingPreviewResult;
          return {
            lines: data?.lines ?? [],
            total_withholding: Number(data?.total_withholding ?? 0) || 0,
          };
        }),
        catchError(() => of({ lines: [], total_withholding: 0 })),
      );
  }

  getConcepts(params?: any): Observable<any> {
    return this.http.get('/store/withholding-tax/concepts', { params });
  }

  createConcept(dto: CreateConceptDto): Observable<any> {
    return this.http.post('/store/withholding-tax/concepts', dto);
  }

  updateConcept(id: number, dto: UpdateConceptDto): Observable<any> {
    return this.http.put(`/store/withholding-tax/concepts/${id}`, dto);
  }

  deleteConcept(id: number): Observable<any> {
    return this.http.delete(`/store/withholding-tax/concepts/${id}`);
  }

  getUvtValues(): Observable<any> {
    return this.http.get('/store/withholding-tax/uvt-values');
  }

  createUvtValue(dto: any): Observable<any> {
    return this.http.post('/store/withholding-tax/uvt-values', dto);
  }

  calculateWithholding(dto: any): Observable<any> {
    return this.http.post('/store/withholding-tax/calculate', dto);
  }

  /**
   * Paginated audit list of persisted withholding calculations
   * (practiced and suffered). Server-side pagination + filters.
   */
  getCalculations(
    query: WithholdingCalculationsQuery = {},
  ): Observable<PaginatedApiResponse<WithholdingCalculation>> {
    let params = new HttpParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return this.http.get<PaginatedApiResponse<WithholdingCalculation>>(
      '/store/withholding-tax/calculations',
      { params },
    );
  }

  getCertificate(
    supplierId: number,
    year: number,
  ): Observable<{ data: WithholdingCertificateData }> {
    return this.http.get<{ data: WithholdingCertificateData }>(
      `/store/withholding-tax/certificates/${supplierId}`,
      { params: { year } },
    );
  }

  getStats(): Observable<any> {
    return this.http.get('/store/withholding-tax/stats');
  }
}
