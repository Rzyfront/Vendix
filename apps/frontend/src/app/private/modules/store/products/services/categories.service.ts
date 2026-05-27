import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta: {
    pagination: {
      total: number;
      page: number;
      limit: number;
      pages?: number;
    };
  };
}

export interface CategoryImageUploadResponse {
  key: string;
  url: string;
  thumbKey?: string;
}

import {
  ProductCategory,
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQuery,
  CategoryState,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class CategoriesService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getCategories(storeId?: number): Observable<ProductCategory[]> {
    const params = storeId
      ? new HttpParams().set('store_id', storeId.toString())
      : new HttpParams();
    return this.http
      .get<
        ApiResponse<ProductCategory[]>
      >(`${this.apiUrl}/store/categories`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getAllCategories(storeId?: number): Observable<ProductCategory[]> {
    const params = new HttpParams().set('limit', '200').set('page', '1');
    return this.http
      .get<
        ApiResponse<ProductCategory[]>
      >(`${this.apiUrl}/store/categories`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  /**
   * Paginated fetch returning the FULL envelope including meta.pagination.
   * Used by the admin Categorías list page.
   */
  getPaginated(
    query: CategoryQuery = {},
  ): Observable<PaginatedApiResponse<ProductCategory>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.state && query.state !== 'all') {
      params = params.set('state', query.state);
    }
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.sort_order) params = params.set('sort_order', query.sort_order);
    return this.http
      .get<
        PaginatedApiResponse<ProductCategory>
      >(`${this.apiUrl}/store/categories`, { params })
      .pipe(catchError(this.handleError));
  }

  getCategoryById(id: number): Observable<ProductCategory> {
    return this.http
      .get<
        ApiResponse<ProductCategory>
      >(`${this.apiUrl}/store/categories/${id}`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  createCategory(category: CreateCategoryDto): Observable<ProductCategory> {
    return this.http
      .post<
        ApiResponse<ProductCategory>
      >(`${this.apiUrl}/store/categories`, category)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  updateCategory(
    id: number,
    category: UpdateCategoryDto,
  ): Observable<ProductCategory> {
    return this.http
      .patch<
        ApiResponse<ProductCategory>
      >(`${this.apiUrl}/store/categories/${id}`, category)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  uploadCategoryImage(file: File): Observable<CategoryImageUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http
      .post<
        ApiResponse<CategoryImageUploadResponse>
      >(`${this.apiUrl}/store/categories/upload-image`, formData)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  toggleCategoryState(
    id: number,
    state: CategoryState,
  ): Observable<ProductCategory> {
    return this.http
      .patch<
        ApiResponse<ProductCategory>
      >(`${this.apiUrl}/store/categories/${id}`, { state })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteCategory(id: number, force = false): Observable<void> {
    let params = new HttpParams();
    if (force) params = params.set('force', 'true');
    return this.http
      .delete<void>(`${this.apiUrl}/store/categories/${id}`, { params })
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('CategoriesService Error:', error);
    throw error;
  }
}
