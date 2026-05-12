import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ActiveSubscription,
  ActiveSubscriptionStats,
  PaginatedResponse,
  ApiResponse,
  QueryDto,
} from '../interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class ActiveSubscriptionsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/active`;

  getSubscriptions(query?: QueryDto): Observable<PaginatedResponse<ActiveSubscription>> {
    let params = new HttpParams();
    if (query) {
      if (query.page) params = params.set('page', query.page);
      if (query.limit) params = params.set('limit', query.limit);
      if (query.search) params = params.set('search', query.search);
      if (query.state) params = params.set('state', query.state);
    }
    return this.http.get<PaginatedResponse<ActiveSubscription>>(this.apiUrl, { params });
  }

  getStats(): Observable<ApiResponse<ActiveSubscriptionStats>> {
    return this.http.get<ApiResponse<ActiveSubscriptionStats>>(`${this.apiUrl}/stats`);
  }
}
