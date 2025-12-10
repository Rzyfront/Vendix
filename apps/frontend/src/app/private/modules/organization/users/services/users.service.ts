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
import { environment } from '../../../../../../environments/environment';
import {
  User,
  CreateUserDto,
  UpdateUserDto,
  UserQueryDto,
  UsersDashboardDto,
  UserStats,
  PaginatedUsersResponse,
} from '../interfaces/user.interface';

@Injectable({
  providedIn: 'root',
})
export class UsersService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  // Estado de carga
  private isLoading$ = new BehaviorSubject<boolean>(false);
  private isCreatingUser$ = new BehaviorSubject<boolean>(false);
  private isUpdatingUser$ = new BehaviorSubject<boolean>(false);
  private isDeletingUser$ = new BehaviorSubject<boolean>(false);

  // Exponer estados como observables
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
   * Obtener lista de usuarios de la organización con paginación y filtros
   */
  getUsers(query: UserQueryDto = {}): Observable<PaginatedUsersResponse> {
    this.isLoading$.next(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.state) params = params.set('state', query.state);

    return this.http
      .get<any>(`${this.apiUrl}/organization/users`, { params })
      .pipe(
        map((response) => {
          // Mapear la respuesta de la API a la estructura esperada por el frontend
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
          console.error('Error loading organization users:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener usuario por ID
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
   * Crear nuevo usuario en la organización
   */
  createUser(userData: CreateUserDto): Observable<User> {
    this.isCreatingUser$.next(true);

    return this.http
      .post<User>(`${this.apiUrl}/organization/users`, userData)
      .pipe(
        finalize(() => this.isCreatingUser$.next(false)),
        catchError((error) => {
          console.error('Error creating user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Actualizar usuario existente
   */
  updateUser(id: number, userData: UpdateUserDto): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http
      .patch<User>(`${this.apiUrl}/organization/users/${id}`, userData)
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error updating user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Eliminar usuario (Soft delete)
   */
  deleteUser(id: number): Observable<void> {
    this.isDeletingUser$.next(true);

    return this.http
      .delete<void>(`${this.apiUrl}/organization/users/${id}`)
      .pipe(
        finalize(() => this.isDeletingUser$.next(false)),
        catchError((error) => {
          console.error('Error deleting user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Archivar usuario
   */
  archiveUser(id: number): Observable<User> {
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
   * Reactivar usuario
   */
  reactivateUser(id: number): Observable<User> {
    this.isUpdatingUser$.next(true);

    return this.http
      .post<User>(`${this.apiUrl}/organization/users/${id}/reactivate`, {})
      .pipe(
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error reactivating user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener estadísticas de usuarios de la organización
   */
  getUsersStats(dashboardQuery: UsersDashboardDto = {}): Observable<UserStats> {
    let params = new HttpParams();

    // Solo agregar parámetros si tienen valores válidos
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

    console.log('Making org stats request with params:', params.toString());

    return this.http
      .get<{
        data: UserStats;
      }>(`${this.apiUrl}/organization/users/stats`, { params })
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          console.error('Error getting organization users stats:', error);
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
   * Obtener organizaciones disponibles (para select en formularios)
   */
  getOrganizations(): Observable<any[]> {
    return this.http.get<any>(`${this.apiUrl}/organization/organizations`).pipe(
      map((response) => response.data || []),
      catchError((error) => {
        console.error('Error loading organizations:', error);
        return throwError(() => error);
      }),
    );
  }
  /**
   * Get user configuration (App, Roles, Stores, Panel UI)
   */
  getUserConfiguration(id: number): Observable<any> {
    return this.http
      .get<any>(`${this.apiUrl}/organization/users/${id}/configuration`)
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          console.error('Error getting user configuration:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Update user configuration
   */
  updateUserConfiguration(id: number, configData: any): Observable<any> {
    this.isUpdatingUser$.next(true);

    return this.http
      .patch<any>(`${this.apiUrl}/organization/users/${id}/configuration`, configData)
      .pipe(
        map((response) => response.data),
        finalize(() => this.isUpdatingUser$.next(false)),
        catchError((error) => {
          console.error('Error updating user configuration:', error);
          return throwError(() => error);
        }),
      );
  }
}
