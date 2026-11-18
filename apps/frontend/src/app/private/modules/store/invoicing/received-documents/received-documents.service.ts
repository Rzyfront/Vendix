import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { AiScanJobOptions, AiScanJobService } from '../../../../../core/services/ai-scan-job.service';
import type {
  ApiEnvelope,
  ConfirmReceivedDocumentMatchInput,
  ManualReceivedDocumentInput,
  ReceivedDocument,
  ReceivedDocumentCreateResult,
  ReceivedDocumentAccountingEvidence,
  ReceivedDocumentMatchAllocationsResponse,
  ReceivedDocumentMatchCandidatesResponse,
  ReceivedDocumentMatchExpensesResponse,
  ReceivedDocumentMatchMutationResult,
  ReceivedDocumentReviewInput,
  ReceivedDocumentScanJobResult,
  ReceivedDocumentsPage,
  ReceivedDocumentQuery,
  ReceivedDocumentInboxSummary,
  ReceivedDocumentReceptionStatus,
  ReceivedDocumentsScope,
  RevokeReceivedDocumentMatchInput,
} from './received-documents.interface';

@Injectable({ providedIn: 'root' })
export class ReceivedDocumentsService {
  private readonly http = inject(HttpClient);
  private readonly aiScanJobs = inject(AiScanJobService);

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

  getSummary(scope: ReceivedDocumentsScope, query: ReceivedDocumentQuery): Observable<ApiEnvelope<ReceivedDocumentInboxSummary>> {
    let params = this.scopeParams(scope, query.store_id);
    // Counts cover the whole search/channel/type scope, not the selected attention/legal state or page.
    for (const key of ['search', 'source_channel', 'document_type'] as const) {
      const value = query[key];
      if (value) params = params.set(key, value);
    }
    return this.http.get<ApiEnvelope<ReceivedDocumentInboxSummary>>(`${this.base(scope)}/summary`, { params });
  }

  getReceptionStatus(scope: ReceivedDocumentsScope, storeId?: number): Observable<ApiEnvelope<ReceivedDocumentReceptionStatus>> {
    return this.http.get<ApiEnvelope<ReceivedDocumentReceptionStatus>>(`${this.base(scope)}/reception-status`, {
      params: this.scopeParams(scope, storeId),
    });
  }

  getById(scope: ReceivedDocumentsScope, id: number, storeId?: number): Observable<ApiEnvelope<ReceivedDocument>> {
    return this.http.get<ApiEnvelope<ReceivedDocument>>(`${this.base(scope)}/${id}`, {
      params: this.scopeParams(scope, storeId),
    });
  }

  getAccountingEvidence(scope: ReceivedDocumentsScope, id: number, storeId?: number): Observable<ApiEnvelope<ReceivedDocumentAccountingEvidence>> {
    return this.http.get<ApiEnvelope<ReceivedDocumentAccountingEvidence>>(
      `${this.base(scope)}/${id}/accounting-evidence`,
      { params: this.scopeParams(scope, storeId) },
    );
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

  getMatchExpenses(
    scope: ReceivedDocumentsScope,
    id: number,
    query: { search?: string; page?: number; limit?: number },
    storeId?: number,
  ): Observable<ApiEnvelope<ReceivedDocumentMatchExpensesResponse>> {
    let params = this.scopeParams(scope, storeId);
    if (query.search !== undefined && query.search !== '') params = params.set('search', query.search);
    if (query.page !== undefined) params = params.set('page', String(query.page));
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    return this.http.get<ApiEnvelope<ReceivedDocumentMatchExpensesResponse>>(
      `${this.base(scope)}/${id}/match-expenses`,
      { params },
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

  importXml(scope: ReceivedDocumentsScope, file: File, storeId?: number): Observable<ApiEnvelope<ReceivedDocumentCreateResult>> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ApiEnvelope<ReceivedDocumentCreateResult>>(`${this.base(scope)}/import/xml`, body, {
      params: this.scopeParams(scope, storeId),
    });
  }

  /**
   * Scans a supplier document with AI (`received-document-scan` queue).
   * `AiScanJobService` enqueues, waits with backoff, feeds the progress bar and
   * emits the job result once; it fails with `AiScanJobError`. `onEnqueued`
   * receives the enqueue `data` (`document_id`, `job_id`).
   */
  scanAndWait(
    scope: ReceivedDocumentsScope,
    file: File,
    storeId: number | undefined,
    opts: Pick<AiScanJobOptions, 'progress' | 'onStall' | 'onEnqueued'>,
  ): Observable<ReceivedDocumentScanJobResult> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.aiScanJobs.enqueueAndWait<ReceivedDocumentScanJobResult>(
      `${this.base(scope)}/scan${this.scopeQuery(scope, storeId)}`,
      body,
      {
        ...opts,
        statusUrl: this.scanStatusUrl(scope, storeId),
        resumeKey: this.scanResumeKey(scope, storeId),
        // Already-processed document: nothing to wait for, open it directly.
        resultWithoutJob: (data) => {
          if (data['already_processed'] === true && typeof data['document_id'] === 'number') {
            return { document_id: data['document_id'] };
          }
          // The document was saved but the scan has no read id: say so (and
          // point to the inbox) instead of the generic «No se pudo iniciar».
          throw new Error('El documento se guardó, pero no se recibió un identificador de lectura. Consulta la bandeja.');
        },
      },
    );
  }

  /** Re-attaches to a scan started before a reload or a close; `null` if none (QUI-1020). */
  resumeScan(
    scope: ReceivedDocumentsScope,
    storeId: number | undefined,
    opts: Pick<AiScanJobOptions, 'progress' | 'onStall'>,
  ): Observable<ReceivedDocumentScanJobResult> | null {
    return this.aiScanJobs.resume<ReceivedDocumentScanJobResult>(
      this.scanResumeKey(scope, storeId),
      { ...opts, statusUrl: this.scanStatusUrl(scope, storeId) },
    );
  }

  private scanStatusUrl(scope: ReceivedDocumentsScope, storeId?: number): (jobId: string) => string {
    return (jobId) => `${this.base(scope)}/scan/${encodeURIComponent(jobId)}${this.scopeQuery(scope, storeId)}`;
  }

  /** One remembered scan per scope and operational store. */
  private scanResumeKey(scope: ReceivedDocumentsScope, storeId?: number): string {
    return `received_document:${scope}:${scope === 'organization' ? storeId ?? 'none' : 'store'}`;
  }

  private scopeQuery(scope: ReceivedDocumentsScope, storeId?: number): string {
    const params = this.scopeParams(scope, storeId).toString();
    return params ? `?${params}` : '';
  }

  createManual(scope: ReceivedDocumentsScope, dto: ManualReceivedDocumentInput, storeId?: number): Observable<ApiEnvelope<ReceivedDocumentCreateResult>> {
    return this.http.post<ApiEnvelope<ReceivedDocumentCreateResult>>(`${this.base(scope)}/manual`, dto, {
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
