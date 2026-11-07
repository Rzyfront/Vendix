import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../environments/environment';
import { ChunkedUploadAdapter } from '../workflow-public-form/workflow-chunked-upload';

export type TrackingStatus = 'active' | 'completed' | 'rejected' | 'cancelled' | 'failed';

export interface TrackingTimelineItem {
  type: string;
  label: string;
  detail: string | null;
  at: string;
}

export interface TrackingPendingItem {
  key: string;
  label: string;
  accept: string[] | null;
  max_size_mb: number | null;
}

export interface TrackingView {
  store: { name: string };
  reference: string;
  flow: { name: string };
  status: TrackingStatus;
  current_stage: { name: string } | null;
  started_at: string;
  entered_at: string;
  completed_at: string | null;
  timeline: TrackingTimelineItem[];
  pending: TrackingPendingItem[];
  can_reply: boolean;
}

const OCTET_STREAM = new HttpHeaders({ 'Content-Type': 'application/octet-stream' });

/** Anonymous client of `ecommerce/workflows/tracking/:token` (store resolved by the domain). */
@Injectable({ providedIn: 'root' })
export class WorkflowTrackingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/ecommerce/workflows/tracking`;

  private url(token: string, path = ''): string {
    return `${this.base}/${encodeURIComponent(token)}${path}`;
  }

  get(token: string): Observable<TrackingView> {
    return this.http.get<{ data: TrackingView }>(this.url(token)).pipe(map((res) => res.data));
  }

  reply(token: string, message: string): Observable<unknown> {
    return this.http.post(this.url(token, '/messages'), { message });
  }

  /** Chunked upload of the document that satisfies a pending requirement. */
  uploader(token: string, requirementKey: string): ChunkedUploadAdapter {
    const root = `/requirements/${encodeURIComponent(requirementKey)}/uploads`;
    return {
      init: (input) =>
        this.http
          .post<{ data: { upload_id: string; chunk_size: number; total_parts: number } }>(
            this.url(token, root),
            input,
          )
          .pipe(map((res) => res.data)),
      putPart: (uploadId, n, body) =>
        this.http.put(this.url(token, `${root}/${encodeURIComponent(uploadId)}/parts/${n}`), body, {
          headers: OCTET_STREAM,
        }),
      complete: (uploadId) =>
        this.http.post(this.url(token, `${root}/${encodeURIComponent(uploadId)}/complete`), {}),
    };
  }
}
