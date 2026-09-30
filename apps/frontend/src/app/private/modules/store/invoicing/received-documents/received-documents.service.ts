import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type {
  ApiEnvelope,
  ConfirmReceivedDocumentMatchInput,
  ManualReceivedDocumentInput,
  ReceivedDocument,
  ReceivedDocumentMatchAllocationsResponse,
  ReceivedDocumentMatchCandidatesResponse,
  ReceivedDocumentMatchMutationResult,
  ReceivedDocumentReviewInput,
  ReceivedDocumentScanEnqueueResponse,
  ReceivedDocumentScanStatus,
  ReceivedDocumentsPage,
  ReceivedDocumentQuery,
  ReceivedDocumentsScope,
  RevokeReceivedDocumentMatchInput,
} from './received-documents.interface';

@Injectable({ providedIn: 'root' })
export class ReceivedDocumentsService {
  private readonly http = inject(HttpClient);

  private base(scope: ReceivedDocumentsScope): string {
    return `${environment.apiUrl}/${scope}/invoicing/received-documents`;
  }

  list(scope: ReceivedDocumentsScope, query: ReceivedDocumentQuery): Observable<ReceivedDocumentsPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    // Never send a store override in the store route; organization selection is explicit.
    if (scope === 'store') params = params.delete('store_id');
    return this.http.get<ReceivedDocumentsPage>(this.base(scope), { params });
  }

  getById(scope: ReceivedDocumentsScope, id: number, storeId?: number): Observable<ApiEnvelope<ReceivedDocument>> {
    return this.http.get<ApiEnvelope<ReceivedDocument>>(`${this.base(scope)}/${id}`, {
      params: this.scopeParams(scope, storeId),
    });
  }

  getMatchCandidates(
    scope: ReceivedDocumentsScope,
    id: number,
    query: { search?: string; limit?: number },
    storeId?: number,
  ): Observable<ApiEnvelope<ReceivedDocumentMatchCandidatesResponse>> {
    let params = this.scopeParams(scope, storeId);
    if (query.search !== undefined && query.search !== '') params = params.set('search', query.search);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    return this.http.get<ApiEnvelope<ReceivedDocumentMatchCandidatesResponse>>(
      `${this.base(scope)}/${id}/match-candidates`,
      { params },
    );
  }

  getMatchAllocations(
    scope: ReceivedDocumentsScope,
    id: number,
    storeId?: number,
  ): Observable<ApiEnvelope<ReceivedDocumentMatchAllocationsResponse>> {
    return this.http.get<ApiEnvelope<ReceivedDocumentMatchAllocationsResponse>>(
      `${this.base(scope)}/${id}/match-allocations`,
      { params: this.scopeParams(scope, storeId) },
    );
  }

  confirmMatch(
    scope: ReceivedDocumentsScope,
    id: number,
    payload: ConfirmReceivedDocumentMatchInput,
    storeId?: number,
  ): Observable<ApiEnvelope<ReceivedDocumentMatchMutationResult>> {
    return this.http.post<ApiEnvelope<ReceivedDocumentMatchMutationResult>>(
      `${this.base(scope)}/${id}/match-allocations`,
      payload,
      { params: this.scopeParams(scope, storeId) },
    );
  }

  revokeMatch(
    scope: ReceivedDocumentsScope,
    id: number,
    allocationId: number,
    payload: RevokeReceivedDocumentMatchInput,
    storeId?: number,
  ): Observable<ApiEnvelope<ReceivedDocumentMatchMutationResult>> {
    return this.http.post<ApiEnvelope<ReceivedDocumentMatchMutationResult>>(
      `${this.base(scope)}/${id}/match-allocations/${allocationId}/revoke`,
      payload,
      { params: this.scopeParams(scope, storeId) },
    );
  }

  importXml(scope: ReceivedDocumentsScope, file: File, storeId?: number): Observable<ApiEnvelope<ReceivedDocument>> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ApiEnvelope<ReceivedDocument>>(`${this.base(scope)}/import/xml`, body, {
      params: this.scopeParams(scope, storeId),
    });
  }

  scan(scope: ReceivedDocumentsScope, file: File, storeId?: number): Observable<ApiEnvelope<ReceivedDocumentScanEnqueueResponse>> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ApiEnvelope<ReceivedDocumentScanEnqueueResponse>>(`${this.base(scope)}/scan`, body, {
      params: this.scopeParams(scope, storeId),
    });
  }

  getScanStatus(scope: ReceivedDocumentsScope, jobId: string, storeId?: number): Observable<ApiEnvelope<ReceivedDocumentScanStatus>> {
    return this.http.get<ApiEnvelope<ReceivedDocumentScanStatus>>(`${this.base(scope)}/scan/${encodeURIComponent(jobId)}`, {
      params: this.scopeParams(scope, storeId),
    });
  }

  createManual(scope: ReceivedDocumentsScope, dto: ManualReceivedDocumentInput, storeId?: number): Observable<ApiEnvelope<ReceivedDocument>> {
    return this.http.post<ApiEnvelope<ReceivedDocument>>(`${this.base(scope)}/manual`, dto, {
      params: this.scopeParams(scope, storeId),
    });
  }

  updateReview(scope: ReceivedDocumentsScope, id: number, dto: ReceivedDocumentReviewInput, storeId?: number): Observable<ApiEnvelope<ReceivedDocument>> {
    return this.http.patch<ApiEnvelope<ReceivedDocument>>(`${this.base(scope)}/${id}/review`, dto, {
      params: this.scopeParams(scope, storeId),
    });
  }

  downloadFile(scope: ReceivedDocumentsScope, id: number, fileId: number, storeId?: number): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base(scope)}/${id}/files/${fileId}`, {
      params: this.scopeParams(scope, storeId),
      observe: 'response',
      responseType: 'blob',
    });
  }

  private scopeParams(scope: ReceivedDocumentsScope, storeId?: number): HttpParams {
    return scope === 'organization' && storeId ? new HttpParams().set('store_id', storeId) : new HttpParams();
  }
}
