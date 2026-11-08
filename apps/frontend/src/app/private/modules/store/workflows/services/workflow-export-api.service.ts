import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

interface DataResponse<T> {
  data: T;
}

export type WorkflowExportStatus = 'pending' | 'running' | 'ready' | 'failed' | 'expired';

/** One full-data export of the store (P7.6). */
export interface WorkflowExport {
  id: number;
  status: WorkflowExportStatus;
  /** Size of the ZIP in bytes; `null` until it is ready. */
  size_bytes: number | null;
  /** Attachments inside the ZIP. */
  file_count: number;
  counts: Record<string, number>;
  /** Short Spanish reason when `status` is `failed`. */
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

export interface WorkflowExportDownload {
  /** Presigned URL, valid for a few minutes. */
  url: string;
  file_name: string;
  expires_in: number;
}

/** Client of `store/workflows/exports` (full ZIP export of Flujos, P7.6). */
@Injectable({ providedIn: 'root' })
export class WorkflowExportApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/workflows/exports`;

  /** Queues a new export; the API answers 409 while another is running. */
  request(): Observable<WorkflowExport> {
    return this.http
      .post<DataResponse<WorkflowExport>>(this.base, {})
      .pipe(map((res) => res.data));
  }

  /** The latest exports of the store, newest first. */
  list(): Observable<WorkflowExport[]> {
    return this.http.get<DataResponse<WorkflowExport[]>>(this.base).pipe(map((res) => res.data));
  }

  /** Signed URL of a ready export (the access is audited by the API). */
  download(id: number): Observable<WorkflowExportDownload> {
    return this.http
      .get<DataResponse<WorkflowExportDownload>>(`${this.base}/${id}/download`)
      .pipe(map((res) => res.data));
  }
}
