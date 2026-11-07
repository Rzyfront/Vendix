import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  PaginatedApiResponse,
} from '../../workflows/interfaces/workflow.interfaces';
import { toWorkflowError } from '../../workflows/utils/workflow-errors.util';
import {
  ExpiringRow,
  FileProfile,
  FolderEntity,
  FolderFilesResult,
  FolderGroup,
  LibraryFile,
  PurgePreview,
  PurgeRun,
  PurgeRunDetail,
  RetentionPolicy,
  RetentionPolicyBody,
  SearchQuery,
  UpdateFileProfileBody,
} from '../interfaces/document-library.interfaces';

function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params = params.set(key, String(value));
  }
  return params;
}

/** Codes of this module whose backend message is already product copy. */
const CURATED_PREFIXES = ['DOCRET_', 'DOCPROFILE_', 'DOCUMENT_'];

/** User-facing message of an HTTP error of the document library. */
export function libraryErrorMessage(error: unknown): string {
  const parsed = toWorkflowError(error);
  const body = ((error as { error?: unknown } | null)?.error ?? null) as {
    error_code?: string;
    message?: unknown;
  } | null;
  const code = body?.error_code ?? parsed.code ?? '';
  if (
    CURATED_PREFIXES.some((p) => code.startsWith(p)) &&
    typeof body?.message === 'string' &&
    body.message.trim()
  ) {
    return body.message;
  }
  return parsed.message;
}

/** Typed client of search, folders, expiry, file profile and retention. */
@Injectable({ providedIn: 'root' })
export class DocumentsLibraryApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/documents`;

  search(query: SearchQuery): Observable<PaginatedApiResponse<LibraryFile>> {
    return this.http.get<PaginatedApiResponse<LibraryFile>>(`${this.base}/search`, {
      params: toParams(query),
    });
  }

  folders(): Observable<FolderGroup[]> {
    return this.http
      .get<ApiResponse<FolderGroup[]>>(`${this.base}/folders`)
      .pipe(map((res) => res.data));
  }

  folderEntities(
    subjectType: string,
    query: { collection?: string; page?: number; limit?: number },
  ): Observable<PaginatedApiResponse<FolderEntity>> {
    return this.http.get<PaginatedApiResponse<FolderEntity>>(
      `${this.base}/folders/${encodeURIComponent(subjectType)}`,
      { params: toParams(query) },
    );
  }

  folderFiles(
    subjectType: string,
    subjectId: number,
    query: { page?: number; limit?: number },
  ): Observable<FolderFilesResult> {
    return this.http
      .get<ApiResponse<FolderFilesResult>>(
        `${this.base}/folders/${encodeURIComponent(subjectType)}/${subjectId}`,
        { params: toParams(query) },
      )
      .pipe(map((res) => res.data));
  }

  expiring(query: {
    days?: number;
    page?: number;
    limit?: number;
  }): Observable<PaginatedApiResponse<ExpiringRow>> {
    return this.http.get<PaginatedApiResponse<ExpiringRow>>(`${this.base}/expiring`, {
      params: toParams(query),
    });
  }

  updateProfile(fileId: number, body: UpdateFileProfileBody): Observable<FileProfile> {
    return this.http
      .patch<ApiResponse<FileProfile>>(`${this.base}/files/${fileId}/profile`, body)
      .pipe(map((res) => res.data));
  }

  setLegalHold(fileId: number, legalHold: boolean): Observable<FileProfile> {
    return this.http
      .put<ApiResponse<FileProfile>>(`${this.base}/files/${fileId}/legal-hold`, {
        legal_hold: legalHold,
      })
      .pipe(map((res) => res.data));
  }

  // ---------------------------------------------------------------- retention

  policies(): Observable<RetentionPolicy[]> {
    return this.http
      .get<ApiResponse<RetentionPolicy[]>>(`${this.base}/retention/policies`)
      .pipe(map((res) => res.data));
  }

  createPolicy(body: RetentionPolicyBody): Observable<RetentionPolicy> {
    return this.http
      .post<ApiResponse<RetentionPolicy>>(`${this.base}/retention/policies`, body)
      .pipe(map((res) => res.data));
  }

  updatePolicy(id: number, body: Partial<RetentionPolicyBody>): Observable<RetentionPolicy> {
    return this.http
      .patch<ApiResponse<RetentionPolicy>>(`${this.base}/retention/policies/${id}`, body)
      .pipe(map((res) => res.data));
  }

  deletePolicy(id: number): Observable<void> {
    return this.http
      .delete<ApiResponse<{ id: number }>>(`${this.base}/retention/policies/${id}`)
      .pipe(map(() => undefined));
  }

  purgePreview(): Observable<PurgePreview> {
    return this.http
      .get<ApiResponse<PurgePreview>>(`${this.base}/retention/preview`)
      .pipe(map((res) => res.data));
  }

  runPurge(): Observable<PurgeRunDetail> {
    return this.http
      .post<ApiResponse<PurgeRunDetail>>(`${this.base}/retention/runs`, {})
      .pipe(map((res) => res.data));
  }

  purgeRuns(query: { page?: number; limit?: number }): Observable<PaginatedApiResponse<PurgeRun>> {
    return this.http.get<PaginatedApiResponse<PurgeRun>>(`${this.base}/retention/runs`, {
      params: toParams(query),
    });
  }

  purgeRun(id: number): Observable<PurgeRunDetail> {
    return this.http
      .get<ApiResponse<PurgeRunDetail>>(`${this.base}/retention/runs/${id}`)
      .pipe(map((res) => res.data));
  }
}
