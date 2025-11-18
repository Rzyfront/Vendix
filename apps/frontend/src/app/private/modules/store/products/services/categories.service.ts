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
import { ProductCategory } from '../interfaces';

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
      >(`${this.apiUrl}/categories`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getCategoryById(id: number): Observable<ProductCategory> {
    return this.http
      .get<ProductCategory>(`${this.apiUrl}/categories/${id}`)
      .pipe(catchError(this.handleError));
  }

  createCategory(
    category: Partial<ProductCategory>,
  ): Observable<ProductCategory> {
    return this.http
      .post<ProductCategory>(`${this.apiUrl}/categories`, category)
      .pipe(catchError(this.handleError));
  }

  updateCategory(
    id: number,
    category: Partial<ProductCategory>,
  ): Observable<ProductCategory> {
    return this.http
      .patch<ProductCategory>(`${this.apiUrl}/categories/${id}`, category)
      .pipe(catchError(this.handleError));
  }

  deleteCategory(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/categories/${id}`)
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('CategoriesService Error:', error);
    throw error;
  }
}
