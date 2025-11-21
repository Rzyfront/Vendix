import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  BehaviorSubject,
  finalize,
  catchError,
  throwError,
  map,
} from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  User,
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
  UsersDashboardDto,
  UserStats,
  PaginatedUsersResponse,
} from '../../../users/interfaces/user.interface';

@Injectable({
  providedIn: 'root',
})
export class GlobalUsersService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  // Loading states
  private isLoading$ = new BehaviorSubject<boolean>(false);
  private isCreatingUser$ = new BehaviorSubject<boolean>(false);
  private isUpdatingUser$ = new BehaviorSubject<boolean>(false);
  private isDeletingUser$ = new BehaviorSubject<boolean>(false);

  // Expose loading states as observables
  get isLoading() {
    return this.isLoading$.asObservable();
  }
  get isCreatingUser() {
    return this.isCreatingUser$.asObservable();
  }
  get isUpdatingUser() {
    return this.isUpdatingUser$.asObservable();
  }
  get isDeletingUser() {
    return this.isDeletingUser$.asObservable();
  }

  /**
   * Get all users with pagination and filters (Super Admin access)
   */
  getUsers(query: UserQueryDto = {}): Observable<PaginatedUsersResponse> {
    this.isLoading$.next(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);
    if (query.organization_id)
      params = params.set('organization_id', query.organization_id.toString());

    return this.http.get<any>(`${this.apiUrl}/users`, { params }).pipe(
      map((response) => {
        // Map API response to frontend structure
        return {
          data: response.data,
          pagination: {
            page: response.meta.page,
            limit: response.meta.limit,
            total: response.meta.total,
            total_pages: response.meta.totalPages,
          },
        } as PaginatedUsersResponse;
      }),
      finalize(() => this.isLoading$.next(false)),
      catchError((error) => {
        console.error('Error loading global users:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get user by ID (Super Admin access)
   */
  getUserById(id: number): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/users/${id}`).pipe(
      catchError((error) => {
        console.error('Error getting user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Create new user (Super Admin access)
   */
  createUser(userData: CreateUserDto): Observable<User> {
    this.isCreatingUser$.next(true);

    return this.http.post<User>(`${this.apiUrl}/users`, userData).pipe(
      finalize(() => this.isCreatingUser$.next(false)),
      catchError((error) => {
        console.error('Error creating user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Update existing user (Super Admin access)
   */
  updateUser(id: number, userData: UpdateUserDto): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http.patch<User>(`${this.apiUrl}/users/${id}`, userData).pipe(
      finalize(() => this.isUpdatingUser$.next(false)),
      catchError((error) => {
        console.error('Error updating user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Delete user (Soft delete) (Super Admin access)
   */
  deleteUser(id: number): Observable<void> {
    this.isDeletingUser$.next(true);

    return this.http.delete<void>(`${this.apiUrl}/users/${id}`).pipe(
      finalize(() => this.isDeletingUser$.next(false)),
      catchError((error) => {
        console.error('Error deleting user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Activate user (Super Admin access)
   */
  activateUser(id: number): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http.post<User>(`${this.apiUrl}/users/${id}/activate`, {}).pipe(
      finalize(() => this.isUpdatingUser$.next(false)),
      catchError((error) => {
        console.error('Error activating user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Deactivate user (Super Admin access)
   */
  deactivateUser(id: number): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http
      .post<User>(`${this.apiUrl}/users/${id}/deactivate`, {})
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error deactivating user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Get global user dashboard statistics
   */
  getUsersStats(dashboardQuery: UsersDashboardDto = {}): Observable<UserStats> {
    let params = new HttpParams();

    // Only add parameters if they have valid values
    if (dashboardQuery.search && dashboardQuery.search.trim() !== '') {
      params = params.set('search', dashboardQuery.search.trim());
    }
    if (dashboardQuery.role && dashboardQuery.role.trim() !== '') {
      params = params.set('role', dashboardQuery.role.trim());
    }
    if (dashboardQuery.page && dashboardQuery.page > 0) {
      params = params.set('page', dashboardQuery.page.toString());
    }
    if (dashboardQuery.limit && dashboardQuery.limit > 0) {
      params = params.set('limit', dashboardQuery.limit.toString());
    }
    if (dashboardQuery.include_inactive !== undefined) {
      params = params.set(
        'include_inactive',
        dashboardQuery.include_inactive.toString(),
      );
    }

    console.log('Making global stats request with params:', params.toString());

    return this.http
      .get<{
        data: UserStats;
      }>(`${this.apiUrl}/users/dashboard`, { params })
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          console.error('Error getting global users stats:', error);
          console.error('Error details:', {
            status: error.status,
            statusText: error.statusText,
            url: error.url,
            params: params.toString(),
          });
          return throwError(() => error);
        }),
      );
  }

  /**
   * Assign role to user (Super Admin access)
   */
  assignRoleToUser(userId: number, roleId: number): Observable<User> {
    return this.http
      .post<User>(`${this.apiUrl}/users/${userId}/roles/${roleId}`, {})
      .pipe(
        catchError((error) => {
          console.error('Error assigning role to user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remove role from user (Super Admin access)
   */
  removeRoleFromUser(userId: number, roleId: number): Observable<User> {
    return this.http
      .delete<User>(`${this.apiUrl}/users/${userId}/roles/${roleId}`)
      .pipe(
        catchError((error) => {
          console.error('Error removing role from user:', error);
          return throwError(() => error);
        }),
      );
  }
}
