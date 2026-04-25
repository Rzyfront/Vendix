import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  DunningSubscription,
  DunningStats,
  PaginatedResponse,
  ApiResponse,
  QueryDto,
} from '../interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class DunningService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/dunning`;

  getDunningSubscriptions(query?: QueryDto): Observable<PaginatedResponse<DunningSubscription>> {
    let params = new HttpParams();
    if (query) {
      if (query.page) params = params.set('page', query.page);
      if (query.limit) params = params.set('limit', query.limit);
      if (query.search) params = params.set('search', query.search);
      if (query.state) params = params.set('state', query.state);
    }
    return this.http.get<PaginatedResponse<DunningSubscription>>(this.apiUrl, { params });
  }

  sendReminder(id: number): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.apiUrl}/${id}/remind`, {});
  }

  forceCancel(id: number): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(`${this.apiUrl}/${id}/cancel`, {});
  }

  getStats(): Observable<ApiResponse<DunningStats>> {
    return this.http.get<ApiResponse<DunningStats>>(`${this.apiUrl}/stats`);
  }
}
