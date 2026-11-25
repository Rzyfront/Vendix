import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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
  /** URL estable de la API (`/public/apps/media/:token`), no una firma. */
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

  /** El backend responde `{ success, data }` y las URLs son relativas a la API. */
  private unwrap<T>(source: Observable<{ data: T }>): Observable<T> {
    return source.pipe(map((response) => this.absolutize(response.data)));
  }

  private absolutize<T>(value: T): T {
    const base = environment.apiUrl.replace(/\/+$/, '');
    const fix = (url: string | null): string | null =>
      url && url.startsWith('/') ? `${base}${url}` : url;
    if (Array.isArray(value)) {
      return value.map((item) => this.absolutize(item)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return {
        ...record,
        ...(record['url'] !== undefined ? { url: fix(record['url'] as string | null) } : {}),
        ...(record['thumb_url'] !== undefined
          ? { thumb_url: fix(record['thumb_url'] as string | null) }
          : {}),
      } as T;
    }
    return value;
  }

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
    return this.unwrap<AppMediaPage>(this.http.get<{ data: AppMediaPage }>(this.apiUrl, { params: query }));
  }

  upload(files: File[], appKind?: PageAppKind | null): Observable<AppMediaItem[]> {
    const body = new FormData();
    for (const file of files) body.append('files', file);
    if (appKind) body.append('app_kind', appKind);
    return this.unwrap<AppMediaItem[]>(this.http.post<{ data: AppMediaItem[] }>(this.apiUrl, body));
  }

  updateAlt(id: number, alt: string | null): Observable<AppMediaItem> {
    return this.unwrap<AppMediaItem>(
      this.http.patch<{ data: AppMediaItem }>(`${this.apiUrl}/${id}`, { alt }),
    );
  }

  remove(id: number): Observable<{ deleted: true }> {
    return this.unwrap<{ deleted: true }>(
      this.http.delete<{ data: { deleted: true } }>(`${this.apiUrl}/${id}`),
    );
  }
}
