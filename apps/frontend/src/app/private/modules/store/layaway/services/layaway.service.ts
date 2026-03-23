import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  LayawayPlan,
  LayawayStats,
  CreateLayawayRequest,
  MakePaymentRequest,
  ModifyInstallmentsRequest,
  CancelLayawayRequest,
  LayawayQueryParams,
} from '../interfaces/layaway.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: any;
}

@Injectable({
  providedIn: 'root',
})
export class LayawayApiService {
  private http = inject(HttpClient);
  private api_url = `${environment.apiUrl}/store/layaway`;

  getAll(params?: LayawayQueryParams): Observable<ApiResponse<LayawayPlan[]>> {
    const query_params: Record<string, any> = {};
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') {
          query_params[key] = value;
        }
      }
    }
    return this.http.get<ApiResponse<LayawayPlan[]>>(this.api_url, {
      params: query_params,
    });
  }

  getById(id: number): Observable<ApiResponse<LayawayPlan>> {
    return this.http.get<ApiResponse<LayawayPlan>>(`${this.api_url}/${id}`);
  }

  create(data: CreateLayawayRequest): Observable<ApiResponse<LayawayPlan>> {
    return this.http.post<ApiResponse<LayawayPlan>>(this.api_url, data);
  }

  getStats(): Observable<ApiResponse<LayawayStats>> {
    return this.http.get<ApiResponse<LayawayStats>>(`${this.api_url}/stats`);
  }

  makePayment(id: number, data: MakePaymentRequest): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.api_url}/${id}/payment`, data);
  }

  modifyInstallments(id: number, data: ModifyInstallmentsRequest): Observable<ApiResponse<LayawayPlan>> {
    return this.http.patch<ApiResponse<LayawayPlan>>(`${this.api_url}/${id}/installments`, data);
  }

  cancel(id: number, data: CancelLayawayRequest): Observable<ApiResponse<LayawayPlan>> {
    return this.http.post<ApiResponse<LayawayPlan>>(`${this.api_url}/${id}/cancel`, data);
  }

  complete(id: number): Observable<ApiResponse<LayawayPlan>> {
    return this.http.post<ApiResponse<LayawayPlan>>(`${this.api_url}/${id}/complete`, {});
  }
}
