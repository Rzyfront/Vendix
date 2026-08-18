import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  HelpArticle,
  HelpArticlesResponse,
  HelpCategory,
} from '../models/help-article.model';

@Injectable({
  providedIn: 'root',
})
export class HelpCenterService {
  private readonly api_url = `${environment.apiUrl}/help-center`;
  private http = inject(HttpClient);

  getArticles(query: {
    page?: number;
    limit?: number;
    category?: string;
    type?: string;
    module?: string;
  } = {}): Observable<HelpArticlesResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.category) params = params.set('category', query.category);
    if (query.type) params = params.set('type', query.type);
    if (query.module) params = params.set('module', query.module);

    return this.http.get<HelpArticlesResponse>(`${this.api_url}/articles`, { params });
  }

  /**
   * `includeContent` en falso por defecto: la búsqueda devuelve título, resumen
   * y un adelanto. Solo lo pide quien renderiza el cuerpo del artículo dentro
   * del resultado — hoy la tarjeta expandible del centro de ayuda.
   */
  searchArticles(q: string, limit = 10, includeContent = false): Observable<HelpArticle[]> {
    let params = new HttpParams()
      .set('q', q)
      .set('limit', limit.toString());

    if (includeContent) params = params.set('include_content', 'true');

    return this.http.get<HelpArticle[]>(`${this.api_url}/articles/search`, { params });
  }

  getArticleBySlug(slug: string): Observable<HelpArticle> {
    return this.http.get<HelpArticle>(`${this.api_url}/articles/${slug}`);
  }

  incrementView(id: number): Observable<{ view_count: number }> {
    return this.http.post<{ view_count: number }>(`${this.api_url}/articles/${id}/view`, {});
  }

  getCategories(): Observable<HelpCategory[]> {
    return this.http.get<HelpCategory[]>(`${this.api_url}/categories`);
  }
}
