import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  ArticleStats,
  CreateArticleDto,
  UpdateArticleDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../interfaces/help-center-admin.interface';
import {
  HelpArticle,
  HelpCategory,
  HelpArticlesResponse,
} from '../../../../modules/store/help/models/help-article.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class HelpCenterAdminService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/help-center`;

  // ==========================================
  // ARTICLES
  // ==========================================

  getArticles(params?: {
    page?: number;
    limit?: number;
    status?: string;
    type?: string;
    category?: string;
    search?: string;
  }): Observable<HelpArticlesResponse> {
    let httpParams = new HttpParams();
    if (params?.page) httpParams = httpParams.set('page', params.page.toString());
    if (params?.limit) httpParams = httpParams.set('limit', params.limit.toString());
    if (params?.status) httpParams = httpParams.set('status', params.status);
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.category) httpParams = httpParams.set('category', params.category);
    if (params?.search) httpParams = httpParams.set('search', params.search);

    return this.http
      .get<ApiResponse<HelpArticlesResponse>>(`${this.apiUrl}/articles`, { params: httpParams })
      .pipe(map((res) => res.data));
  }

  getArticle(id: number): Observable<HelpArticle> {
    return this.http
      .get<ApiResponse<HelpArticle>>(`${this.apiUrl}/articles/${id}`)
      .pipe(map((res) => res.data));
  }

  getArticleStats(): Observable<ArticleStats> {
    return this.http
      .get<ApiResponse<ArticleStats>>(`${this.apiUrl}/articles/stats`)
      .pipe(map((res) => res.data));
  }

  createArticle(dto: CreateArticleDto): Observable<HelpArticle> {
    return this.http
      .post<ApiResponse<HelpArticle>>(`${this.apiUrl}/articles`, dto)
      .pipe(map((res) => res.data));
  }

  updateArticle(id: number, dto: UpdateArticleDto): Observable<HelpArticle> {
    return this.http
      .patch<ApiResponse<HelpArticle>>(`${this.apiUrl}/articles/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  deleteArticle(id: number): Observable<any> {
    return this.http
      .delete<ApiResponse<any>>(`${this.apiUrl}/articles/${id}`)
      .pipe(map((res) => res.data));
  }

  // ==========================================
  // CATEGORIES
  // ==========================================

  getCategories(): Observable<HelpCategory[]> {
    return this.http
      .get<ApiResponse<HelpCategory[]>>(`${this.apiUrl}/categories`)
      .pipe(map((res) => res.data));
  }

  createCategory(dto: CreateCategoryDto): Observable<HelpCategory> {
    return this.http
      .post<ApiResponse<HelpCategory>>(`${this.apiUrl}/categories`, dto)
      .pipe(map((res) => res.data));
  }

  updateCategory(id: number, dto: UpdateCategoryDto): Observable<HelpCategory> {
    return this.http
      .patch<ApiResponse<HelpCategory>>(`${this.apiUrl}/categories/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  deleteCategory(id: number): Observable<any> {
    return this.http
      .delete<ApiResponse<any>>(`${this.apiUrl}/categories/${id}`)
      .pipe(map((res) => res.data));
  }

  // ==========================================
  // IMAGE UPLOAD
  // ==========================================

  uploadImage(file: File): Observable<{ key: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<ApiResponse<{ key: string; url: string }>>(`${this.apiUrl}/upload-image`, formData)
      .pipe(map((res) => res.data));
  }
}
