import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import {
  ApiResponse,
  FiscalApiScope,
  FiscalCloseSession,
  FiscalEvidence,
  FiscalObligation,
  FiscalOperationEvent,
  FiscalOverview,
  FiscalRuleSet,
  PaginatedApiResponse,
  TaxDeclarationDraft,
  TaxDeclarationLine,
} from '../interfaces/fiscal-operations.interface';

export interface FiscalListQuery {
  type?: string;
  status?: string;
  period_year?: number;
  period_month?: number;
  store_id?: number;
  accounting_entity_id?: number;
  page?: number;
  limit?: number;
}

export interface AttachFiscalEvidencePayload {
  evidence_type: string;
  storage_key?: string;
  content_hash?: string;
  metadata?: Record<string, unknown>;
  source_type?: string;
  source_id?: number;
  store_id?: number;
}

@Injectable({
  providedIn: 'root',
})
export class FiscalOperationsService {
  private readonly http = inject(HttpClient);

  private getApiUrl(scope: FiscalApiScope, endpoint = ''): string {
    const suffix = endpoint ? `/${endpoint}` : '';
    return `${environment.apiUrl}/${scope}/fiscal${suffix}`;
  }

  private toParams(query: FiscalListQuery = {}): HttpParams {
    let params = new HttpParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    });
    return params;
  }

  getOverview(scope: FiscalApiScope): Observable<ApiResponse<FiscalOverview>> {
    return this.http.get<ApiResponse<FiscalOverview>>(
      this.getApiUrl(scope, 'overview'),
    );
  }

  listObligations(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<PaginatedApiResponse<FiscalObligation>> {
    return this.http.get<PaginatedApiResponse<FiscalObligation>>(
      this.getApiUrl(scope, 'obligations'),
      { params: this.toParams(query) },
    );
  }

  generateObligations(
    scope: FiscalApiScope,
    dto: {
      period_year: number;
      period_month?: number;
      period_quarter?: number;
      types?: string[];
      force_refresh?: boolean;
      store_id?: number;
    },
  ): Observable<ApiResponse<FiscalObligation[]>> {
    return this.http.post<ApiResponse<FiscalObligation[]>>(
      this.getApiUrl(scope, 'obligations/generate'),
      dto,
    );
  }

  updateObligationStatus(
    scope: FiscalApiScope,
    id: number,
    status: string,
    dto: {
      evidence_id?: number;
      notes?: string;
      payment_info?: Record<string, unknown>;
    } = {},
  ): Observable<ApiResponse<FiscalObligation>> {
    return this.http.patch<ApiResponse<FiscalObligation>>(
      this.getApiUrl(scope, `obligations/${id}/status`),
      { status, ...dto },
    );
  }

  attachObligationEvidence(
    scope: FiscalApiScope,
    id: number,
    dto: AttachFiscalEvidencePayload,
  ): Observable<ApiResponse<FiscalEvidence>> {
    return this.http.post<ApiResponse<FiscalEvidence>>(
      this.getApiUrl(scope, `obligations/${id}/evidence`),
      dto,
    );
  }

  listDeclarations(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<PaginatedApiResponse<TaxDeclarationDraft>> {
    return this.http.get<PaginatedApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, 'declarations'),
      { params: this.toParams(query) },
    );
  }

  createDeclarationDraft(
    scope: FiscalApiScope,
    dto: {
      declaration_type: string;
      period_year: number;
      period_month?: number;
      period_quarter?: number;
      obligation_id?: number;
      store_id?: number;
    },
  ): Observable<ApiResponse<TaxDeclarationDraft>> {
    return this.http.post<ApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, 'declarations/draft'),
      dto,
    );
  }

  approveDeclaration(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<TaxDeclarationDraft>> {
    return this.http.patch<ApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, `declarations/${id}/approve`),
      {},
    );
  }

  markDeclarationSubmitted(
    scope: FiscalApiScope,
    id: number,
    dto: {
      submitted_at: string;
      evidence_id: number;
      external_reference?: string;
      notes?: string;
    },
  ): Observable<ApiResponse<TaxDeclarationDraft>> {
    return this.http.patch<ApiResponse<TaxDeclarationDraft>>(
      this.getApiUrl(scope, `declarations/${id}/mark-submitted`),
      dto,
    );
  }

  attachDeclarationEvidence(
    scope: FiscalApiScope,
    id: number,
    dto: AttachFiscalEvidencePayload,
  ): Observable<ApiResponse<FiscalEvidence>> {
    return this.http.post<ApiResponse<FiscalEvidence>>(
      this.getApiUrl(scope, `declarations/${id}/evidence`),
      dto,
    );
  }

  getDeclarationLines(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<TaxDeclarationLine[]>> {
    return this.http.get<ApiResponse<TaxDeclarationLine[]>>(
      this.getApiUrl(scope, `declarations/${id}/lines`),
    );
  }

  listCloseSessions(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<ApiResponse<FiscalCloseSession[]>> {
    return this.http.get<ApiResponse<FiscalCloseSession[]>>(
      this.getApiUrl(scope, 'close-sessions'),
      { params: this.toParams(query) },
    );
  }

  createCloseSession(
    scope: FiscalApiScope,
    dto: {
      period_year: number;
      period_month?: number;
      close_type?: string;
      store_id?: number;
    },
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.post<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, 'close-sessions'),
      dto,
    );
  }

  runCloseChecks(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/run-checks`),
      {},
    );
  }

  approveClose(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/approve`),
      {},
    );
  }

  closeSession(
    scope: FiscalApiScope,
    id: number,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/close`),
      {},
    );
  }

  reopenCloseSession(
    scope: FiscalApiScope,
    id: number,
    reason: string,
  ): Observable<ApiResponse<FiscalCloseSession>> {
    return this.http.patch<ApiResponse<FiscalCloseSession>>(
      this.getApiUrl(scope, `close-sessions/${id}/reopen`),
      { reason },
    );
  }

  attachCloseEvidence(
    scope: FiscalApiScope,
    id: number,
    dto: AttachFiscalEvidencePayload,
  ): Observable<ApiResponse<FiscalEvidence>> {
    return this.http.post<ApiResponse<FiscalEvidence>>(
      this.getApiUrl(scope, `close-sessions/${id}/evidence`),
      dto,
    );
  }

  listEvidence(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<ApiResponse<FiscalEvidence[]>> {
    return this.http.get<ApiResponse<FiscalEvidence[]>>(
      this.getApiUrl(scope, 'evidence'),
      { params: this.toParams(query) },
    );
  }

  listHistory(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<PaginatedApiResponse<FiscalOperationEvent>> {
    return this.http.get<PaginatedApiResponse<FiscalOperationEvent>>(
      this.getApiUrl(scope, 'history'),
      { params: this.toParams(query) },
    );
  }

  listRules(
    scope: FiscalApiScope,
    query: FiscalListQuery = {},
  ): Observable<ApiResponse<FiscalRuleSet[]>> {
    return this.http.get<ApiResponse<FiscalRuleSet[]>>(
      this.getApiUrl(scope, 'rules'),
      { params: this.toParams(query) },
    );
  }
}
