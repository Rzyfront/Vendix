import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, finalize, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  UserSession,
  SessionsQueryDto,
  PaginatedSessionsResponse,
} from '../interfaces/session.interface';

@Injectable({
  providedIn: 'root',
})
export class SessionsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  readonly isLoading = signal(false);

  getSessions(query: SessionsQueryDto = {}): Observable<PaginatedSessionsResponse> {
    this.isLoading.set(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.user_id) params = params.set('user_id', query.user_id.toString());
    if (query.status) params = params.set('status', query.status);

    return this.http.get<any>(`${this.apiUrl}/organization/sessions`, { params }).pipe(
      map((response) => ({
        data: response.data || [],
        meta: response.meta || {
          total: 0,
          page: query.page || 1,
          limit: query.limit || 10,
          totalPages: 0,
        },
      })),
      finalize(() => this.isLoading.set(false)),
      catchError((error) => {
        console.error('Error loading sessions:', error);
        return throwError(() => error);
      }),
    );
  }

  terminateSession(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/organization/sessions/${id}`).pipe(
      catchError((error) => {
        console.error('Error terminating session:', error);
        return throwError(() => error);
      }),
    );
  }

  terminateUserSessions(userId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/organization/sessions/user/${userId}`).pipe(
      catchError((error) => {
        console.error('Error terminating user sessions:', error);
        return throwError(() => error);
      }),
    );
  }
}
