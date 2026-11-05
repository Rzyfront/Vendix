import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  CompleteTaskBody,
  CreateDefinitionBody,
  ExportDefinitionResult,
  FileDownloadResult,
  PaginatedApiResponse,
  PublishResult,
  StartInstanceBody,
  StartInstanceResult,
  UploadedFileResult,
  ValidateDefinitionResult,
  WorkflowDefinitionRow,
  WorkflowInstanceDetail,
  WorkflowInstanceQuery,
  WorkflowInstanceRow,
} from '../interfaces/workflow.interfaces';

export interface DefinitionQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

/**
 * Typed client of `/api/store/workflows` (definitions, instances, tasks,
 * files) plus the file download of `/store/documents`. Stateless: pages own
 * their signals.
 */
@Injectable({ providedIn: 'root' })
export class WorkflowsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows`;

  // ─── Definitions ─────────────────────────────────────────────────────

  listDefinitions(
    query: DefinitionQuery = {},
  ): Observable<PaginatedApiResponse<WorkflowDefinitionRow>> {
    return this.http.get<PaginatedApiResponse<WorkflowDefinitionRow>>(
      `${this.base}/definitions`,
      { params: this.params(query) },
    );
  }

  createDefinition(body: CreateDefinitionBody): Observable<WorkflowDefinitionRow> {
    return this.http
      .post<ApiResponse<WorkflowDefinitionRow>>(`${this.base}/definitions`, body)
      .pipe(map((res) => res.data));
  }

  validateDefinition(definition: unknown): Observable<ValidateDefinitionResult> {
    return this.http
      .post<ApiResponse<ValidateDefinitionResult>>(
        `${this.base}/definitions/validate`,
        { definition },
      )
      .pipe(map((res) => res.data));
  }

  publishDefinition(id: number, changelog?: string): Observable<PublishResult> {
    return this.http
      .post<ApiResponse<PublishResult>>(
        `${this.base}/definitions/${id}/publish`,
        changelog ? { changelog } : {},
      )
      .pipe(map((res) => res.data));
  }

  exportDefinition(id: number): Observable<ExportDefinitionResult> {
    return this.http
      .get<ApiResponse<ExportDefinitionResult>>(
        `${this.base}/definitions/${id}/export`,
      )
      .pipe(map((res) => res.data));
  }

  archiveDefinition(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/definitions/${id}/archive`, {});
  }

  unarchiveDefinition(id: number): Observable<unknown> {
    return this.http.post(`${this.base}/definitions/${id}/unarchive`, {});
  }

  // ─── Instances ───────────────────────────────────────────────────────

  listInstances(
    query: WorkflowInstanceQuery = {},
  ): Observable<PaginatedApiResponse<WorkflowInstanceRow>> {
    return this.http.get<PaginatedApiResponse<WorkflowInstanceRow>>(
      `${this.base}/instances`,
      { params: this.params({ ...query }) },
    );
  }

  getInstance(id: number): Observable<WorkflowInstanceDetail> {
    return this.http
      .get<ApiResponse<WorkflowInstanceDetail>>(`${this.base}/instances/${id}`)
      .pipe(map((res) => res.data));
  }

  /** `idempotencyKey`: one per user action; reuse it when retrying that action. */
  startInstance(
    body: StartInstanceBody,
    idempotencyKey: string,
  ): Observable<StartInstanceResult> {
    return this.http
      .post<ApiResponse<StartInstanceResult>>(`${this.base}/instances`, body, {
        headers: this.idempotency(idempotencyKey),
      })
      .pipe(map((res) => res.data));
  }

  uploadInstanceFile(
    instanceId: number,
    file: File,
    target: { requirement_key?: string; field_key?: string },
  ): Observable<UploadedFileResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    if (target.requirement_key) {
      form.append('requirement_key', target.requirement_key);
    } else if (target.field_key) {
      form.append('field_key', target.field_key);
    }
    return this.http
      .post<ApiResponse<UploadedFileResult>>(
        `${this.base}/instances/${instanceId}/files`,
        form,
      )
      .pipe(map((res) => res.data));
  }

  // ─── Tasks ───────────────────────────────────────────────────────────

  claimTask(taskId: number): Observable<unknown> {
    return this.http.post(`${this.base}/tasks/${taskId}/claim`, {});
  }

  completeTask(
    taskId: number,
    body: CompleteTaskBody,
    idempotencyKey: string,
  ): Observable<unknown> {
    return this.http.post(`${this.base}/tasks/${taskId}/complete`, body, {
      headers: this.idempotency(idempotencyKey),
    });
  }

  // ─── Files ───────────────────────────────────────────────────────────

  getFileDownload(fileId: number): Observable<FileDownloadResult> {
    return this.http
      .get<ApiResponse<FileDownloadResult>>(
        `${environment.apiUrl}/store/documents/files/${fileId}/download`,
      )
      .pipe(map((res) => res.data));
  }

  private idempotency(key: string): HttpHeaders {
    return new HttpHeaders({ 'Idempotency-Key': key.slice(0, 80) });
  }

  private params(query: object): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params = params.set(key, String(value));
    }
    return params;
  }
}
