import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class NotificationsApiService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/notifications`;

  getAll(params?: any): Observable<any> {
    return this.http.get(this.baseUrl, { params });
  }

  getUnreadCount(): Observable<any> {
    return this.http.get(`${this.baseUrl}/unread-count`);
  }

  markRead(id: number): Observable<any> {
    return this.http.patch(`${this.baseUrl}/${id}/read`, {});
  }

  markAllRead(): Observable<any> {
    return this.http.patch(`${this.baseUrl}/read-all`, {});
  }

  getSubscriptions(): Observable<any> {
    return this.http.get(`${this.baseUrl}/subscriptions`);
  }

  updateSubscription(data: {
    type: string;
    in_app?: boolean;
    email?: boolean;
  }): Observable<any> {
    return this.http.patch(`${this.baseUrl}/subscriptions`, data);
  }

  getSseUrl(): string {
    const auth_state = localStorage.getItem('vendix_auth_state');
    if (!auth_state) {
      console.warn('[NotificationsService] No auth state in localStorage for SSE');
      return '';
    }
    const token = JSON.parse(auth_state)?.tokens?.access_token;
    if (!token) {
      console.warn('[NotificationsService] No access_token found in auth state for SSE');
      return '';
    }
    return `${this.baseUrl}/stream?token=${token}`;
  }
}
