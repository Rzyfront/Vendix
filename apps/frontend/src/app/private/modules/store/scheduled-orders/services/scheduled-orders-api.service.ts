import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  FulfillmentDay,
  ProductionList,
  ScheduledOrder,
  ScheduledOrderDetail,
  ScheduledOrderDisplayStatus,
} from '../interfaces/scheduled-order.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class ScheduledOrdersApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/store/scheduled-orders`;

  getAvailability(from: string, to: string): Observable<FulfillmentDay[]> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http
      .get<ApiResponse<FulfillmentDay[]>>(`${this.baseUrl}/availability`, { params })
      .pipe(map((r) => r.data ?? []));
  }

  getAgenda(
    from: string,
    to: string,
    status?: ScheduledOrderDisplayStatus,
  ): Observable<ScheduledOrder[]> {
    let params = new HttpParams().set('from', from).set('to', to);
    if (status) params = params.set('status', status);
    return this.http
      .get<ApiResponse<ScheduledOrder[]>>(`${this.baseUrl}/agenda`, { params })
      .pipe(map((r) => r.data ?? []));
  }

  getDetail(id: number): Observable<ScheduledOrderDetail> {
    return this.http
      .get<ApiResponse<ScheduledOrderDetail>>(`${this.baseUrl}/${id}`)
      .pipe(map((r) => r.data));
  }

  /** QUI-989: manda a KDS los platos no producibles del pedido y pasa a producción. */
  sendToKitchen(id: number): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/${id}/send-to-kitchen`, {});
  }

  reschedule(id: number, start: string, end: string): Observable<unknown> {
    return this.http.patch(`${this.baseUrl}/${id}/reschedule`, { start, end });
  }

  getProductionList(date: string): Observable<ProductionList> {
    const params = new HttpParams().set('date', date);
    return this.http
      .get<ApiResponse<ProductionList>>(`${this.baseUrl}/production-list`, { params })
      .pipe(map((r) => r.data));
  }
}
