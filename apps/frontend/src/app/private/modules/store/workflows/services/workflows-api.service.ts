import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  AiStepTestBody,
  AiStepTestResult,
  ApiResponse,
  CompleteTaskBody,
  CreateDefinitionBody,
  DefinitionDraft,
  ExportDefinitionResult,
  FileDownloadResult,
  MigrationBody,
  MigrationPreview,
  MigrationResult,
  PaginatedApiResponse,
  PublishResult,
  SaveDraftResult,
  SimulateBody,
  SimulationResult,
  StartInstanceBody,
  StartInstanceResult,
  UploadedFileResult,
  WorkGroupRow,
  WorkflowVersionDetail,
  WorkflowVersionRow,
  ValidateDefinitionResult,
  WorkflowDefinitionRow,
  WorkflowInstanceDetail,
  WorkflowInstanceQuery,
  WorkflowInstanceRow,
} from '../interfaces/workflow.interfaces';
import {
  AnalyticsQuery,
  BoardData,
  BoardQuery,
  InboxQuery,
  InboxTaskRow,
  InstanceComment,
  PublicLinkCreated,
  PublicLinkStatus,
  WorkflowAnalytics,
} from '../interfaces/workflow-ops.interfaces';

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
      .post<ApiResponse<Omit<PublishResult, 'version'> & { version: { version: number } }>>(
        `${this.base}/definitions/${id}/publish`,
        changelog ? { changelog } : {},
      )
      .pipe(map((res) => ({ ...res.data, version: res.data.version.version })));
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

  /** P2.11: turns a flow on or off without deleting it. */
  setDefinitionEnabled(id: number, enabled: boolean): Observable<WorkflowDefinitionRow> {
    return this.http
      .patch<ApiResponse<WorkflowDefinitionRow>>(`${this.base}/definitions/${id}/enabled`, {
        enabled,
      })
      .pipe(map((res) => res.data));
  }

  // ─── Migration between versions (P2.8) ───────────────────────────────

  previewMigration(id: number, body: MigrationBody): Observable<MigrationPreview> {
    return this.http
      .post<ApiResponse<MigrationPreview>>(
        `${this.base}/definitions/${id}/migrations/preview`,
        body,
      )
      .pipe(map((res) => res.data));
  }

  migrateInstances(id: number, body: MigrationBody): Observable<MigrationResult> {
    return this.http
      .post<ApiResponse<MigrationResult>>(`${this.base}/definitions/${id}/migrations`, body)
      .pipe(map((res) => res.data));
  }

  // ─── Editor ──────────────────────────────────────────────────────────

  getDefinition(id: number): Observable<WorkflowDefinitionRow> {
    return this.http
      .get<ApiResponse<WorkflowDefinitionRow>>(`${this.base}/definitions/${id}`)
      .pipe(map((res) => res.data));
  }

  getDraft(id: number): Observable<DefinitionDraft> {
    return this.http
      .get<ApiResponse<DefinitionDraft>>(`${this.base}/definitions/${id}/draft`)
      .pipe(map((res) => res.data));
  }

  saveDraft(
    id: number,
    definition: unknown,
    expectedDraftUpdatedAt: string | null,
  ): Observable<SaveDraftResult> {
    const body: { definition: unknown; expected_draft_updated_at?: string } = {
      definition,
    };
    if (expectedDraftUpdatedAt) {
      body.expected_draft_updated_at = expectedDraftUpdatedAt;
    }
    return this.http
      .patch<ApiResponse<SaveDraftResult>>(
        `${this.base}/definitions/${id}/draft`,
        body,
      )
      .pipe(map((res) => res.data));
  }

  validateDraft(id: number): Observable<ValidateDefinitionResult> {
    return this.http
      .post<ApiResponse<ValidateDefinitionResult>>(
        `${this.base}/definitions/${id}/validate`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  simulate(id: number, body: SimulateBody): Observable<SimulationResult> {
    return this.http
      .post<ApiResponse<SimulationResult>>(
        `${this.base}/definitions/${id}/simulate`,
        body,
      )
      .pipe(map((res) => res.data));
  }

  /** `POST ai-step-test`: a real AI call over the SAVED draft; it spends plan quota. */
  testAiStep(id: number, body: AiStepTestBody): Observable<AiStepTestResult> {
    return this.http
      .post<ApiResponse<AiStepTestResult>>(`${this.base}/definitions/${id}/ai-step-test`, body)
      .pipe(map((res) => res.data));
  }

  listVersions(id: number): Observable<WorkflowVersionRow[]> {
    return this.http
      .get<ApiResponse<WorkflowVersionRow[]>>(
        `${this.base}/definitions/${id}/versions`,
      )
      .pipe(map((res) => res.data));
  }

  getVersion(id: number, version: number): Observable<WorkflowVersionDetail> {
    return this.http
      .get<ApiResponse<WorkflowVersionDetail>>(
        `${this.base}/definitions/${id}/versions/${version}`,
      )
      .pipe(map((res) => res.data));
  }

  listWorkGroups(): Observable<WorkGroupRow[]> {
    return this.http
      .get<ApiResponse<WorkGroupRow[]>>(`${environment.apiUrl}/store/work-groups`)
      .pipe(map((res) => res.data));
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
      .post<
        ApiResponse<{ instance: { id: number; reference: string }; replayed: boolean }>
      >(`${this.base}/instances`, body, {
        headers: this.idempotency(idempotencyKey),
      })
      .pipe(
        map((res) => ({
          id: res.data.instance.id,
          reference: res.data.instance.reference,
          replayed: res.data.replayed,
        })),
      );
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

  /** P2.7: runs a failed automatic action again (needs the manage permission). */
  retryFailedAction(instanceId: number, actionId: number): Observable<{ retried: boolean }> {
    return this.http
      .post<ApiResponse<{ retried: boolean }>>(
        `${this.base}/instances/${instanceId}/failed-actions/${actionId}/retry`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  // ─── Inbox, board, comments, public link ─────────────────────────────

  listInbox(query: InboxQuery = {}): Observable<PaginatedApiResponse<InboxTaskRow>> {
    return this.http.get<PaginatedApiResponse<InboxTaskRow>>(`${this.base}/inbox`, {
      params: this.params(query),
    });
  }

  getBoard(definitionId: number, query: BoardQuery = {}): Observable<BoardData> {
    return this.http
      .get<ApiResponse<BoardData>>(`${this.base}/board/${definitionId}`, {
        params: this.params(query),
      })
      .pipe(map((res) => res.data));
  }

  getAnalytics(definitionId: number, query: AnalyticsQuery = {}): Observable<WorkflowAnalytics> {
    return this.http
      .get<ApiResponse<WorkflowAnalytics>>(`${this.base}/analytics/${definitionId}`, {
        params: this.params({ ...query, format: 'json' }),
      })
      .pipe(map((res) => res.data));
  }

  /** The XLSX of the same range, built by the backend from the same dataset. */
  exportAnalytics(definitionId: number, query: AnalyticsQuery = {}): Observable<Blob> {
    return this.http.get(`${this.base}/analytics/${definitionId}`, {
      params: this.params({ ...query, format: 'xlsx' }),
      responseType: 'blob',
    });
  }

  addComment(instanceId: number, body: string): Observable<InstanceComment> {
    return this.http
      .post<ApiResponse<InstanceComment>>(`${this.base}/instances/${instanceId}/comments`, {
        body,
      })
      .pipe(map((res) => res.data));
  }

  getPublicLink(definitionId: number): Observable<PublicLinkStatus> {
    return this.http
      .get<ApiResponse<PublicLinkStatus>>(`${this.base}/definitions/${definitionId}/public-link`)
      .pipe(map((res) => res.data));
  }

  createPublicLink(definitionId: number): Observable<PublicLinkCreated> {
    return this.http
      .post<ApiResponse<PublicLinkCreated>>(
        `${this.base}/definitions/${definitionId}/public-link`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  revokePublicLink(definitionId: number): Observable<unknown> {
    return this.http.delete(`${this.base}/definitions/${definitionId}/public-link`);
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
