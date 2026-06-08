import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../../../environments/environment';
import { NotificationSoundAdmin } from '../interfaces/notification-sound.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationSoundsAdminService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/superadmin/notification-sounds`;

  list(query: { page?: number; limit?: number; search?: string } = {}): Observable<{
    data: NotificationSoundAdmin[];
    meta?: { total: number; page: number; limit: number; totalPages: number };
  }> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);

    return this.http
      .get<ApiResponse<NotificationSoundAdmin[]>>(this.apiUrl, { params })
      .pipe(
        map((res) => {
          if (res && Array.isArray(res.data) && (res as any).meta) {
            return {
              data: res.data,
              meta: (res as any).meta as {
                total: number;
                page: number;
                limit: number;
                totalPages: number;
              },
            };
          }
          // Legacy unwrapped — fall back to a single-page envelope.
          const data = res?.data ?? [];
          return {
            data,
            meta: { total: data.length, page: 1, limit: data.length || 25, totalPages: 1 },
          };
        }),
      );
  }

  create(
    name: string,
    sortOrder: number | undefined,
    file: File,
  ): Observable<NotificationSoundAdmin> {
    const formData = new FormData();
    formData.append('name', name);
    if (sortOrder !== undefined && sortOrder !== null) {
      formData.append('sort_order', String(sortOrder));
    }
    formData.append('file', file);

    return this.http
      .post<ApiResponse<NotificationSoundAdmin>>(this.apiUrl, formData)
      .pipe(map((res) => res.data));
  }

  update(
    id: string,
    name: string,
    sortOrder: number | undefined,
  ): Observable<NotificationSoundAdmin> {
    const body: Record<string, unknown> = { name };
    if (sortOrder !== undefined && sortOrder !== null) {
      body['sort_order'] = sortOrder;
    }
    return this.http
      .patch<ApiResponse<NotificationSoundAdmin>>(`${this.apiUrl}/${id}`, body)
      .pipe(map((res) => res.data));
  }

  toggleActive(id: string): Observable<NotificationSoundAdmin> {
    return this.http
      .patch<ApiResponse<NotificationSoundAdmin>>(
        `${this.apiUrl}/${id}/toggle-active`,
        {},
      )
      .pipe(map((res) => res.data));
  }

  remove(id: string): Observable<void> {
    return this.http
      .delete<ApiResponse<void>>(`${this.apiUrl}/${id}`)
      .pipe(map(() => void 0));
  }
}
