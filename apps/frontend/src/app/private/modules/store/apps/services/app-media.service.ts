import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { PageAppKind } from '../templates';

/** Una foto o documento de la biblioteca de medios de las apps. */
export interface AppMediaItem {
  id: number;
  app_kind: PageAppKind | null;
  kind: 'image' | 'document';
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: string;
  /** URL firmada para mostrarla en el editor. */
  url: string | null;
  thumb_url: string | null;
}

export interface AppMediaPage {
  data: AppMediaItem[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Biblioteca de medios de las apps (`/store/apps/media`, apps-customization
 * F1.1): las fotos se suben a nuestro storage y las apps las referencian por
 * id. Listar usa `store:apps:read`; subir, renombrar y borrar,
 * `store:apps:manage`.
 */
@Injectable({ providedIn: 'root' })
export class AppMediaService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/apps/media`;

  list(params: {
    appKind?: PageAppKind | null;
    search?: string | null;
    page?: number;
    limit?: number;
  } = {}): Observable<AppMediaPage> {
    let query = new HttpParams();
    if (params.appKind) query = query.set('app_kind', params.appKind);
    if (params.search?.trim()) query = query.set('search', params.search.trim());
    if (params.page) query = query.set('page', String(params.page));
    if (params.limit) query = query.set('limit', String(params.limit));
    return this.http.get<AppMediaPage>(this.apiUrl, { params: query });
  }

  upload(files: File[], appKind?: PageAppKind | null): Observable<AppMediaItem[]> {
    const body = new FormData();
    for (const file of files) body.append('files', file);
    if (appKind) body.append('app_kind', appKind);
    return this.http.post<AppMediaItem[]>(this.apiUrl, body);
  }

  updateAlt(id: number, alt: string | null): Observable<AppMediaItem> {
    return this.http.patch<AppMediaItem>(`${this.apiUrl}/${id}`, { alt });
  }

  remove(id: number): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`${this.apiUrl}/${id}`);
  }
}
