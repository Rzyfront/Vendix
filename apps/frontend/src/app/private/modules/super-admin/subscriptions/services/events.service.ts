import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  SubscriptionEvent,
  PaginatedResponse,
  QueryDto,
} from '../interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class EventsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/events`;

  getEvents(query?: QueryDto): Observable<PaginatedResponse<SubscriptionEvent>> {
    let params = new HttpParams();
    if (query) {
      if (query.page) params = params.set('page', query.page);
      if (query.limit) params = params.set('limit', query.limit);
      if (query.search) params = params.set('search', query.search);
    }
    return this.http.get<PaginatedResponse<SubscriptionEvent>>(this.apiUrl, { params });
  }
}
