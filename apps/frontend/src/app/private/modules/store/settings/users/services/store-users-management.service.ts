import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  StoreUser,
  StoreUserDetail,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  StoreUserQuery,
  StoreUserStats,
  PaginatedStoreUsersResponse,
  Role,
} from '../interfaces/store-user.interface';

@Injectable({
  providedIn: 'root',
})
export class StoreUsersManagementService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/users/management`;

  getUsers(query: StoreUserQuery = {}): Observable<PaginatedStoreUsersResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);

    return this.http.get<any>(this.baseUrl, { params }).pipe(
      map((response) => ({
        data: response.data,
        pagination: {
          page: response.meta?.page || response.pagination?.page || 1,
          limit: response.meta?.limit || response.pagination?.limit || 10,
          total: response.meta?.total || response.pagination?.total || 0,
          total_pages: response.meta?.totalPages || response.pagination?.total_pages || 0,
        },
      } as PaginatedStoreUsersResponse)),
      catchError((error) => throwError(() => error)),
    );
  }

  getStats(): Observable<StoreUserStats> {
    return this.http
      .get<{ data: StoreUserStats }>(`${this.baseUrl}/stats`)
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  getUserDetail(id: number): Observable<StoreUserDetail> {
    return this.http
      .get<{ data: StoreUserDetail }>(`${this.baseUrl}/${id}`)
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  createUser(userData: CreateStoreUserDto): Observable<StoreUser> {
    return this.http
      .post<{ data: StoreUser }>(this.baseUrl, userData)
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  updateUser(id: number, userData: UpdateStoreUserDto): Observable<StoreUser> {
    return this.http
      .patch<{ data: StoreUser }>(`${this.baseUrl}/${id}`, userData)
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  deactivateUser(id: number): Observable<StoreUser> {
    return this.http
      .post<{ data: StoreUser }>(`${this.baseUrl}/${id}/deactivate`, {})
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  reactivateUser(id: number): Observable<StoreUser> {
    return this.http
      .post<{ data: StoreUser }>(`${this.baseUrl}/${id}/reactivate`, {})
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  resetPassword(id: number, data: { new_password: string; confirm_password: string }): Observable<any> {
    return this.http
      .post<any>(`${this.baseUrl}/${id}/reset-password`, data)
      .pipe(catchError((error) => throwError(() => error)));
  }

  updateUserRoles(id: number, role_ids: number[]): Observable<StoreUserDetail> {
    return this.http
      .patch<{ data: StoreUserDetail }>(`${this.baseUrl}/${id}/roles`, { role_ids })
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  updateUserPanelUI(id: number, panel_ui: Record<string, Record<string, boolean>>): Observable<StoreUserDetail> {
    return this.http
      .patch<{ data: StoreUserDetail }>(`${this.baseUrl}/${id}/panel-ui`, { panel_ui })
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }

  getAvailableRoles(): Observable<Role[]> {
    return this.http
      .get<{ data: Role[] }>(`${environment.apiUrl}/store/roles`)
      .pipe(
        map((response) => response.data),
        catchError((error) => throwError(() => error)),
      );
  }
}
