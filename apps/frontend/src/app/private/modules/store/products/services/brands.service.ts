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
import { Brand } from '../interfaces';

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

  getBrandById(id: number): Observable<Brand> {
    return this.http
      .get<Brand>(`${this.apiUrl}/store/brands/${id}`)
      .pipe(catchError(this.handleError));
  }

  createBrand(brand: Partial<Brand>): Observable<Brand> {
    return this.http
      .post<Brand>(`${this.apiUrl}/store/brands`, brand)
      .pipe(catchError(this.handleError));
  }

  updateBrand(id: number, brand: Partial<Brand>): Observable<Brand> {
    return this.http
      .patch<Brand>(`${this.apiUrl}/store/brands/${id}`, brand)
      .pipe(catchError(this.handleError));
  }

  deleteBrand(id: number): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/store/brands/${id}`)
      .pipe(catchError(this.handleError));
  }

  private handleError(error: any): Observable<never> {
    console.error('BrandsService Error:', error);
    throw error;
  }
}
