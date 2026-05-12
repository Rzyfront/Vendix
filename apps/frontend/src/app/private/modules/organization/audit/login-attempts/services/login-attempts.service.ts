import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, finalize, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  LoginAttempt,
  LoginAttemptsQueryDto,
  LoginAttemptsStats,
  PaginatedLoginAttemptsResponse,
} from '../interfaces/login-attempt.interface';

@Injectable({
  providedIn: 'root',
})
export class LoginAttemptsService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  readonly isLoading = signal(false);

  getLoginAttempts(query: LoginAttemptsQueryDto = {}): Observable<PaginatedLoginAttemptsResponse> {
    this.isLoading.set(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.email) params = params.set('email', query.email);
    if (query.success !== undefined) params = params.set('success', query.success.toString());
    if (query.store_id) params = params.set('store_id', query.store_id.toString());

    return this.http.get<any>(`${this.apiUrl}/organization/login-attempts`, { params }).pipe(
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
        console.error('Error loading login attempts:', error);
        return throwError(() => error);
      }),
    );
  }

  getLoginAttemptsStats(): Observable<LoginAttemptsStats> {
    return this.http.get<any>(`${this.apiUrl}/organization/login-attempts/stats`).pipe(
      map((response) => response.data),
      catchError((error) => {
        console.error('Error loading login attempts stats:', error);
        return throwError(() => error);
      }),
    );
  }
}
