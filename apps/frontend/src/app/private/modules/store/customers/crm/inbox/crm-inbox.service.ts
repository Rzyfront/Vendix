import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  CrmConversation,
  CrmConversationStats,
  CrmConversationsPage,
  CrmConversationsQuery,
  CrmMessage,
  CrmMessagesPage,
  SendCrmMessageRequest,
} from './crm-inbox.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: Record<string, unknown>;
}

interface PaginationMeta {
  total: number;
  page: number;
  totalPages: number;
}

/** HTTP client of the store inbox (`/store/customers/crm/conversations`). */
@Injectable({ providedIn: 'root' })
export class CrmInboxService {
  private readonly http = inject(HttpClient);
  readonly baseUrl = `${environment.apiUrl}/store/customers/crm/conversations`;

  list(query: CrmConversationsQuery): Observable<CrmConversationsPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http
      .get<ApiResponse<CrmConversation[]>>(this.baseUrl, { params })
      .pipe(
        map((response) => {
          const meta = (response.meta ?? {}) as Partial<PaginationMeta>;
          return {
            data: response.data,
            total: meta.total ?? response.data.length,
            page: meta.page ?? 1,
            totalPages: meta.totalPages ?? 1,
          };
        }),
      );
  }

  stats(): Observable<CrmConversationStats> {
    return this.http
      .get<ApiResponse<CrmConversationStats>>(`${this.baseUrl}/stats`)
      .pipe(map((response) => response.data));
  }

  get(id: number): Observable<CrmConversation> {
    return this.http
      .get<ApiResponse<CrmConversation>>(`${this.baseUrl}/${id}`)
      .pipe(map((response) => response.data));
  }

  /** Newest first; pass `beforeId` to page back in time. */
  messages(
    id: number,
    beforeId?: number | null,
    limit = 30,
  ): Observable<CrmMessagesPage> {
    let params = new HttpParams().set('limit', limit);
    if (beforeId) params = params.set('before_id', beforeId);
    return this.http
      .get<ApiResponse<CrmMessage[]>>(`${this.baseUrl}/${id}/messages`, {
        params,
      })
      .pipe(
        map((response) => ({
          data: response.data,
          has_more: Boolean(response.meta?.['has_more']),
          next_before_id:
            (response.meta?.['next_before_id'] as number | null) ?? null,
        })),
      );
  }

  send(id: number, data: SendCrmMessageRequest): Observable<CrmMessage> {
    return this.http
      .post<ApiResponse<CrmMessage>>(`${this.baseUrl}/${id}/messages`, data)
      .pipe(map((response) => response.data));
  }

  addNote(id: number, body: string): Observable<CrmMessage> {
    return this.http
      .post<ApiResponse<CrmMessage>>(`${this.baseUrl}/${id}/notes`, { body })
      .pipe(map((response) => response.data));
  }

  markRead(id: number): Observable<{ id: number; unread_count: number }> {
    return this.http
      .post<
        ApiResponse<{ id: number; unread_count: number }>
      >(`${this.baseUrl}/${id}/read`, {})
      .pipe(map((response) => response.data));
  }

  close(id: number): Observable<CrmConversation> {
    return this.http
      .post<ApiResponse<CrmConversation>>(`${this.baseUrl}/${id}/close`, {})
      .pipe(map((response) => response.data));
  }

  reopen(id: number): Observable<CrmConversation> {
    return this.http
      .post<ApiResponse<CrmConversation>>(`${this.baseUrl}/${id}/reopen`, {})
      .pipe(map((response) => response.data));
  }

  assign(id: number, assignedUserId: number | null): Observable<CrmConversation> {
    return this.http
      .patch<ApiResponse<CrmConversation>>(`${this.baseUrl}/${id}/assign`, {
        assigned_user_id: assignedUserId,
      })
      .pipe(map((response) => response.data));
  }
}
