import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Pqr,
  PqrDetail,
  PqrStats,
  PqrQuery,
  PqrUpdateDto,
  PqrStatusUpdateDto,
  PqrAssignDto,
  PqrCommentCreateDto,
  PqrComment,
  PaginatedPqr,
} from '../models/pqr.model';

/**
 * Admin-side HTTP service for PQR management. All requests are scoped to
 * the store_admin's JWT via `Authorization` header set by the global
 * `withCredentials` interceptor. Path base: `${environment.apiUrl}/store/support/pqr`.
 */
@Injectable({ providedIn: 'root' })
export class PqrAdminService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/support/pqr`;

  list(query: PqrQuery): Observable<PaginatedPqr> {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.pqr_type) params = params.set('pqr_type', query.pqr_type);
    if (query.priority) params = params.set('priority', query.priority);
    if (query.search) params = params.set('search', query.search);
    if (query.date_from) params = params.set('date_from', query.date_from);
    if (query.date_to) params = params.set('date_to', query.date_to);
    if (query.assigned_to_user_id) {
      params = params.set(
        'assigned_to_user_id',
        query.assigned_to_user_id.toString(),
      );
    }
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());

    return this.http.get<PaginatedPqr>(this.apiUrl, { params });
  }

  getStats(): Observable<{ success: boolean; data: PqrStats }> {
    return this.http.get<{ success: boolean; data: PqrStats }>(
      `${this.apiUrl}/stats`,
    );
  }

  getById(id: number): Observable<{ success: boolean; data: PqrDetail }> {
    return this.http.get<{ success: boolean; data: PqrDetail }>(
      `${this.apiUrl}/${id}`,
    );
  }

  update(id: number, dto: PqrUpdateDto): Observable<{ success: boolean; data: Pqr }> {
    return this.http.patch<{ success: boolean; data: Pqr }>(
      `${this.apiUrl}/${id}`,
      dto,
    );
  }

  updateStatus(
    id: number,
    dto: PqrStatusUpdateDto,
  ): Observable<{ success: boolean; data: Pqr }> {
    return this.http.patch<{ success: boolean; data: Pqr }>(
      `${this.apiUrl}/${id}/status`,
      dto,
    );
  }

  assign(
    id: number,
    dto: PqrAssignDto,
  ): Observable<{ success: boolean; data: Pqr }> {
    return this.http.patch<{ success: boolean; data: Pqr }>(
      `${this.apiUrl}/${id}/assign`,
      dto,
    );
  }

  addComment(
    id: number,
    dto: PqrCommentCreateDto,
  ): Observable<{ success: boolean; data: PqrComment }> {
    return this.http.post<{ success: boolean; data: PqrComment }>(
      `${this.apiUrl}/${id}/comments`,
      dto,
    );
  }

  /**
   * Edit a comment's content. Server-side: only the original author
   * can edit (SUP_COMMENT_002 → 403 otherwise) so attribution stays
   * truthful. Re-fetches the PQR on success so the conversation
   * list and history card refresh together.
   */
  editComment(
    id: number,
    commentId: number,
    dto: { content: string },
  ): Observable<{ success: boolean; data: PqrComment }> {
    return this.http.patch<{ success: boolean; data: PqrComment }>(
      `${this.apiUrl}/${id}/comments/${commentId}`,
      dto,
    );
  }

  /**
   * Edit title / description / requester_* fields of a PQR. Server-side
   * guard: only allowed while status === 'NEW' (the support team hasn't
   * picked it up yet). The backend returns 400 SUP_PQR_006 once the
   * ticket has progressed.
   */
  editContent(
    id: number,
    patch: {
      title?: string;
      description?: string;
      requester_first_name?: string;
      requester_last_name?: string;
      requester_email?: string;
      requester_phone?: string;
      requester_document_type?: string;
      requester_document_num?: string;
    },
  ): Observable<{ success: boolean; data: { id: number; changed: number } }> {
    return this.http.patch<{ success: boolean; data: { id: number; changed: number } }>(
      `${this.apiUrl}/${id}/content`,
      patch,
    );
  }
}