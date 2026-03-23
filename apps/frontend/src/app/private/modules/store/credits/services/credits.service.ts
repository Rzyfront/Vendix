import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Credit,
  CreditStats,
  RegisterPaymentRequest,
  CreditQueryParams,
} from '../interfaces/credit.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

@Injectable({
  providedIn: 'root',
})
export class CreditsApiService {
  private http = inject(HttpClient);
  private api_url = `${environment.apiUrl}/store/credits`;

  getAll(params?: CreditQueryParams): Observable<ApiResponse<Credit[]>> {
    const query_params: Record<string, any> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          query_params[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<Credit[]>>(this.api_url, {
      params: query_params,
    });
  }

  getById(id: number): Observable<ApiResponse<Credit>> {
    return this.http.get<ApiResponse<Credit>>(`${this.api_url}/${id}`);
  }

  getStats(): Observable<ApiResponse<CreditStats>> {
    return this.http.get<ApiResponse<CreditStats>>(`${this.api_url}/stats`);
  }

  registerPayment(credit_id: number, data: RegisterPaymentRequest): Observable<ApiResponse<Credit>> {
    return this.http.post<ApiResponse<Credit>>(`${this.api_url}/${credit_id}/pay`, data);
  }

  forgiveInstallment(credit_id: number, installment_id: number): Observable<ApiResponse<Credit>> {
    return this.http.post<ApiResponse<Credit>>(`${this.api_url}/${credit_id}/installments/${installment_id}/forgive`, {});
  }

  cancel(credit_id: number, reason?: string): Observable<ApiResponse<Credit>> {
    return this.http.post<ApiResponse<Credit>>(`${this.api_url}/${credit_id}/cancel`, { reason });
  }

  getAvailableCredit(customer_id: number): Observable<ApiResponse<any>> {
    return this.http.get<ApiResponse<any>>(`${this.api_url}/customer/${customer_id}/available-credit`);
  }
}
