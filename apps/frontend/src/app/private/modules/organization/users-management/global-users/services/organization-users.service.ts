import { Injectable } from '@angular/core';
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
export class OrganizationUsersService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) { }

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
   * Get all users with pagination and filters (Organization level)
   */
  getUsers(query: UserQueryDto = {}): Observable<PaginatedUsersResponse> {
    this.isLoading$.next(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);
    // organization_id is implicit from the user's token/session in organization context,
    // but we can support it if needed. For Org Admin, they see their own org users.

    return this.http.get<any>(`${this.apiUrl}/organization/users`, { params }).pipe(
      map((response) => {
        // Map API response to frontend structure
        const meta = response.meta || {};
        return {
          data: response.data || [],
          pagination: {
            page: Number(meta.page) || 1,
            limit: Number(meta.limit) || 10,
            total: Number(meta.total) || 0,
            total_pages: Number(meta.totalPages) || Math.ceil((Number(meta.total) || 0) / (Number(meta.limit) || 10)) || 1,
          },
        } as PaginatedUsersResponse;
      }),
      finalize(() => this.isLoading$.next(false)),
      catchError((error) => {
        console.error('Error loading organization users:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get user by ID (Organization level)
   */
  getUserById(id: number): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/organization/users/${id}`).pipe(
      catchError((error) => {
        console.error('Error getting user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Create new user (Organization level)
   */
  createUser(userData: CreateUserDto): Observable<User> {
    this.isCreatingUser$.next(true);

    return this.http.post<User>(`${this.apiUrl}/organization/users`, userData).pipe(
      finalize(() => this.isCreatingUser$.next(false)),
      catchError((error) => {
        console.error('Error creating user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Update existing user (Organization level)
   */
  updateUser(id: number, userData: UpdateUserDto): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http.patch<User>(`${this.apiUrl}/organization/users/${id}`, userData).pipe(
      finalize(() => this.isUpdatingUser$.next(false)),
      catchError((error) => {
        console.error('Error updating user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Delete user (Maps to suspend in org context if delete not available, or standard delete)
   * Organization controller has delete method.
   */
  deleteUser(id: number): Observable<void> {
    this.isDeletingUser$.next(true);

    return this.http.delete<void>(`${this.apiUrl}/organization/users/${id}`).pipe(
      finalize(() => this.isDeletingUser$.next(false)),
      catchError((error) => {
        console.error('Error deleting user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Activate user (Organization level)
   */
  activateUser(id: number): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http.post<User>(`${this.apiUrl}/organization/users/${id}/reactivate`, {}).pipe(
      finalize(() => this.isUpdatingUser$.next(false)),
      catchError((error) => {
        console.error('Error activating user:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Deactivate user (Maps to archive as deactivate endpoint is missing in Org controller, or check if available)
   * Org controller has `archive` but no specific `deactivate` (unlike superadmin).
   * Superadmin has `deactivate` -> `state: inactive`.
   * Org `archive` -> `state: archived`.
   * Org `remove` (delete) -> `state: suspended`.
   *
   * If the UI expects "Deactivate" to mean "Inactive", we might need to use update with state,
   * but the controller doesn't seem to expose simple state update via convenience method,
   * only PATCH /:id.
   *
   * Let's map deactivateUser to archiveKey for now as per plan, or use PATCH if needed.
   * Plan said maps to archive.
   */
  deactivateUser(id: number): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http
      .post<User>(`${this.apiUrl}/organization/users/${id}/archive`, {})
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error archiving user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Get organization user dashboard statistics
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
    // ... other params

    return this.http
      .get<{
        data: UserStats;
      }>(`${this.apiUrl}/organization/users/stats`, { params })
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          console.error('Error getting organization users stats:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Assign role to user (Organization level)
   */
  assignRoleToUser(userId: number, roleId: number): Observable<User> {
    return this.http
      .post<User>(`${this.apiUrl}/organization/roles/assign-to-user`, {
        user_id: userId,
        role_id: roleId,
      })
      .pipe(
        catchError((error) => {
          console.error('Error assigning role to user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remove role from user (Organization level)
   */
  removeRoleFromUser(userId: number, roleId: number): Observable<User> {
    return this.http
      .post<User>(`${this.apiUrl}/organization/roles/remove-from-user`, {
        user_id: userId,
        role_id: roleId,
      })
      .pipe(
        catchError((error) => {
          console.error('Error removing role from user:', error);
          return throwError(() => error);
        }),
      );
  }
}
