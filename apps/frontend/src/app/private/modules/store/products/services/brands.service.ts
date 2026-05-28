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

interface PaginationMeta {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  total_pages?: number;
  pages?: number;
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    total_pages?: number;
    pages?: number;
  };
}

interface PaginatedApiResponse<T> {
  success: boolean;
  data: T[];
  message?: string;
  meta?: PaginationMeta;
}

export interface BrandLogoUploadResponse {
  key: string;
  url: string;
  thumbKey?: string;
}

import {
  Brand,
  CreateBrandDto,
  UpdateBrandDto,
  BrandQuery,
  BrandState,
} from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class BrandsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getBrands(storeId?: number): Observable<Brand[]> {
    const params = storeId
      ? new HttpParams().set('store_id', storeId.toString())
      : new HttpParams();
    return this.http
      .get<ApiResponse<Brand[]>>(`${this.apiUrl}/store/brands`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getAllBrands(storeId?: number): Observable<Brand[]> {
    const params = new HttpParams().set('limit', '200').set('page', '1');
    return this.http
      .get<ApiResponse<Brand[]>>(`${this.apiUrl}/store/brands`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  /**
   * Paginated fetch returning the FULL envelope including meta.pagination.
   * Used by the admin Marcas list page.
   */
  getPaginated(
    query: BrandQuery = {},
  ): Observable<PaginatedApiResponse<Brand>> {
    let params = new HttpParams();
    if (query.page != null) params = params.set('page', String(query.page));
    if (query.limit != null) params = params.set('limit', String(query.limit));
    if (query.search) params = params.set('search', query.search);
    if (query.state && query.state !== 'all') {
      params = params.set('state', query.state);
    }
    if (query.is_featured !== undefined) {
      params = params.set('is_featured', String(query.is_featured));
    }
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.sort_order) params = params.set('sort_order', query.sort_order);
    return this.http
      .get<
        PaginatedApiResponse<Brand>
      >(`${this.apiUrl}/store/brands`, { params })
      .pipe(catchError(this.handleError));
  }

  getBrandById(id: number): Observable<Brand> {
    return this.http
      .get<ApiResponse<Brand>>(`${this.apiUrl}/store/brands/${id}`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  createBrand(brand: CreateBrandDto): Observable<Brand> {
    return this.http
      .post<ApiResponse<Brand>>(`${this.apiUrl}/store/brands`, brand)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  updateBrand(id: number, brand: UpdateBrandDto): Observable<Brand> {
    return this.http
      .patch<ApiResponse<Brand>>(`${this.apiUrl}/store/brands/${id}`, brand)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  uploadBrandLogo(file: File): Observable<BrandLogoUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http
      .post<
        ApiResponse<BrandLogoUploadResponse>
      >(`${this.apiUrl}/store/brands/upload-logo`, formData)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  toggleBrandState(id: number, state: BrandState): Observable<Brand> {
    return this.http
      .patch<ApiResponse<Brand>>(`${this.apiUrl}/store/brands/${id}`, { state })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteBrand(id: number, force = false): Observable<void> {
    let params = new HttpParams();
    if (force) params = params.set('force', 'true');
    return this.http
      .delete<void>(`${this.apiUrl}/store/brands/${id}`, { params })
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('BrandsService Error:', error);
    throw error;
  }
}
