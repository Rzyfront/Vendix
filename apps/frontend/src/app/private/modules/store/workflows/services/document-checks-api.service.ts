import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from '../interfaces/workflow.interfaces';

export type DocumentCheckLegibility = 'good' | 'fair' | 'poor';
export type DocumentCheckVerdict = 'pass' | 'warn' | 'fail' | 'needs_review';

/** Normalized 0..1 box of a value on its page (x,y = top-left corner). */
export interface DocumentCheckRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DocumentCheckField {
  value: string | number | boolean;
  /** 0..1 */
  confidence: number;
  page: number | null;
  region: DocumentCheckRegion | null;
}

export interface DocumentCheckResult {
  doc_type: string | null;
  legibility: DocumentCheckLegibility;
  matches_request: boolean | null;
  mismatch_reasons: string[];
  valid_until: string | null;
  page_count: number;
  fields: Record<string, DocumentCheckField>;
  unread_keys: string[];
}

export interface DocumentCheck {
  id: number;
  file_id: number;
  instance_id: number | null;
  status: 'running' | 'done' | 'failed';
  verdict: DocumentCheckVerdict | null;
  model: string | null;
  prompt_version: string;
  tokens_used: number | null;
  error: string | null;
  result: DocumentCheckResult;
  /** `true` when the reading came from the cache (no AI quota consumed). */
  cached: boolean;
  reviewed_at: string | null;
  reviewed_by_user_id: number | null;
  created_at: string;
}

export interface ReadDocumentBody {
  instance_id: number;
  field_keys: string[];
}

/** Typed client of `/api/store/documents/files/:id/checks` ("Leer con IA"). Stateless. */
@Injectable({ providedIn: 'root' })
export class DocumentChecksApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/documents`;

  read(fileId: number, body: ReadDocumentBody): Observable<DocumentCheck> {
    return this.http
      .post<ApiResponse<DocumentCheck>>(`${this.base}/files/${fileId}/checks`, body)
      .pipe(map((res) => res.data));
  }

  list(fileId: number): Observable<DocumentCheck[]> {
    return this.http
      .get<ApiResponse<DocumentCheck[]>>(`${this.base}/files/${fileId}/checks`)
      .pipe(map((res) => res.data));
  }

  review(checkId: number): Observable<DocumentCheck> {
    return this.http
      .post<ApiResponse<DocumentCheck>>(`${this.base}/checks/${checkId}/review`, {})
      .pipe(map((res) => res.data));
  }
}
