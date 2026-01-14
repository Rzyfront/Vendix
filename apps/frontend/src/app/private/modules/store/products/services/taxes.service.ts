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
import { TaxCategory } from '../interfaces';

@Injectable({
  providedIn: 'root',
})
export class TaxesService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

  getTaxCategories(storeId?: number): Observable<TaxCategory[]> {
    const params = storeId
      ? new HttpParams().set('store_id', storeId.toString())
      : new HttpParams();
    return this.http
      .get<
        ApiResponse<TaxCategory[]>
      >(`${this.apiUrl}/store/taxes`, { params })
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  getTaxCategoryById(id: number): Observable<TaxCategory> {
    return this.http
      .get<ApiResponse<TaxCategory>>(`${this.apiUrl}/store/taxes/${id}`)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError)
      );
  }

  createTaxCategory(
    taxCategory: Partial<TaxCategory>,
  ): Observable<TaxCategory> {
    return this.http
      .post<ApiResponse<TaxCategory>>(`${this.apiUrl}/store/taxes`, taxCategory)
      .pipe(
        map((response) => response.data),
        catchError(this.handleError)
      );
  }

  updateTaxCategory(
    id: number,
    taxCategory: Partial<TaxCategory>,
  ): Observable<TaxCategory> {
    return this.http
      .patch<ApiResponse<TaxCategory>>(
        `${this.apiUrl}/store/taxes/${id}`,
        taxCategory,
      )
      .pipe(
        map((response) => response.data),
        catchError(this.handleError),
      );
  }

  deleteTaxCategory(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/taxes/${id}`)
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('TaxesService Error:', error);
    throw error;
  }
}