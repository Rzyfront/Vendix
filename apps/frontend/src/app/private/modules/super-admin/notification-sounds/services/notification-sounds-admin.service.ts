import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

  list(): Observable<NotificationSoundAdmin[]> {
    return this.http
      .get<ApiResponse<NotificationSoundAdmin[]>>(this.apiUrl)
      .pipe(map((res) => res.data ?? []));
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
