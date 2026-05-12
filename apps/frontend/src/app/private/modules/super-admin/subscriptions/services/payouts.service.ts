import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Payout,
  PayoutStats,
  PaginatedResponse,
  ApiResponse,
  QueryDto,
} from '../interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class PayoutsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/payouts`;

  getPayouts(query?: QueryDto): Observable<PaginatedResponse<Payout>> {
    let params = new HttpParams();
    if (query) {
      if (query.page) params = params.set('page', query.page);
      if (query.limit) params = params.set('limit', query.limit);
      if (query.search) params = params.set('search', query.search);
      if (query.state) params = params.set('state', query.state);
    }
    return this.http.get<PaginatedResponse<Payout>>(this.apiUrl, { params });
  }

  approvePayout(id: number): Observable<ApiResponse<Payout>> {
    return this.http.post<ApiResponse<Payout>>(`${this.apiUrl}/${id}/approve`, {});
  }

  getStats(): Observable<ApiResponse<PayoutStats>> {
    return this.http.get<ApiResponse<PayoutStats>>(`${this.apiUrl}/stats`);
  }
}
