import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  Coupon,
  CouponStats,
  CreateCouponRequest,
  UpdateCouponRequest,
  ValidateCouponRequest,
  ValidateCouponResponse,
  CouponQueryParams,
} from '../interfaces/coupon.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

@Injectable({
  providedIn: 'root',
})
export class CouponsApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/store/coupons`;

  getAll(params?: CouponQueryParams): Observable<ApiResponse<Coupon[]>> {
    const queryParams: Record<string, any> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          queryParams[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<Coupon[]>>(this.apiUrl, {
      params: queryParams,
    });
  }

  getById(id: number): Observable<ApiResponse<Coupon>> {
    return this.http.get<ApiResponse<Coupon>>(`${this.apiUrl}/${id}`);
  }

  create(data: CreateCouponRequest): Observable<ApiResponse<Coupon>> {
    return this.http.post<ApiResponse<Coupon>>(this.apiUrl, data);
  }

  update(
    id: number,
    data: UpdateCouponRequest,
  ): Observable<ApiResponse<Coupon>> {
    return this.http.patch<ApiResponse<Coupon>>(`${this.apiUrl}/${id}`, data);
  }

  delete(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(`${this.apiUrl}/${id}`);
  }

  validate(
    data: ValidateCouponRequest,
  ): Observable<ApiResponse<ValidateCouponResponse>> {
    return this.http.post<ApiResponse<ValidateCouponResponse>>(
      `${this.apiUrl}/validate`,
      data,
    );
  }

  getStats(): Observable<ApiResponse<CouponStats>> {
    return this.http.get<ApiResponse<CouponStats>>(`${this.apiUrl}/stats`);
  }
}
