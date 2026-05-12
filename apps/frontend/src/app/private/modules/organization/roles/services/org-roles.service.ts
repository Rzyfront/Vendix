import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  finalize,
  catchError,
  throwError,
  map,
  shareReplay,
  tap,
} from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
  Role,
  Permission,
  CreateRoleDto,
  UpdateRoleDto,
  RoleQueryDto,
  AssignPermissionsDto,
  RoleStats,
  PaginatedRolesResponse,
  PaginatedPermissionsResponse,
  RolePermissionsResponse,
  AssignRoleToUserDto,
  RemoveRoleFromUserDto,
} from '../interfaces/role.interface';

interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let rolesStatsCache: CacheEntry<Observable<RoleStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class OrgRolesService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000;

  readonly isLoading = signal(false);
  readonly isCreatingRole = signal(false);
  readonly isUpdatingRole = signal(false);
  readonly isDeletingRole = signal(false);
  readonly isLoadingPermissions = signal(false);

  readonly isLoading$ = toObservable(this.isLoading);
  readonly isCreatingRole$ = toObservable(this.isCreatingRole);
  readonly isUpdatingRole$ = toObservable(this.isUpdatingRole);
  readonly isDeletingRole$ = toObservable(this.isDeletingRole);
  readonly isLoadingPermissions$ = toObservable(this.isLoadingPermissions);

  getRoles(query: RoleQueryDto = {}): Observable<PaginatedRolesResponse> {
    this.isLoading.set(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);

    return this.http
      .get<any>(`${this.apiUrl}/organization/roles`, { params })
      .pipe(
        map((response) => {
          const mappedData = (response.data || []).map((role: any) => ({
            ...role,
            permissions: role.permissions || [],
          }));

          return {
            data: mappedData,
            pagination: {
              page: response.meta?.page || query.page || 1,
              limit: response.meta?.limit || query.limit || 10,
              total: response.meta?.total || mappedData.length,
              total_pages: response.meta?.totalPages || 1,
            },
          } as PaginatedRolesResponse;
        }),
        finalize(() => this.isLoading.set(false)),
        catchError((error) => {
          console.error('Error loading roles:', error);
          return throwError(() => error);
        }),
      );
  }

  getRoleById(id: number): Observable<Role> {
    return this.http.get<Role>(`${this.apiUrl}/organization/roles/${id}`).pipe(
      catchError((error) => {
        console.error('Error getting role:', error);
        return throwError(() => error);
      }),
    );
  }

  createRole(roleData: CreateRoleDto): Observable<Role> {
    this.isCreatingRole.set(true);

    return this.http
      .post<Role>(`${this.apiUrl}/organization/roles`, roleData)
      .pipe(
        finalize(() => this.isCreatingRole.set(false)),
        catchError((error) => {
          console.error('Error creating role:', error);
          return throwError(() => error);
        }),
      );
  }

  updateRole(id: number, roleData: UpdateRoleDto): Observable<Role> {
    this.isUpdatingRole.set(true);

    return this.http
      .patch<Role>(`${this.apiUrl}/organization/roles/${id}`, roleData)
      .pipe(
        finalize(() => this.isUpdatingRole.set(false)),
        catchError((error) => {
          console.error('Error updating role:', error);
          return throwError(() => error);
        }),
      );
  }

  deleteRole(id: number): Observable<void> {
    this.isDeletingRole.set(true);

    return this.http
      .delete<void>(`${this.apiUrl}/organization/roles/${id}`)
      .pipe(
        finalize(() => this.isDeletingRole.set(false)),
        catchError((error) => {
          console.error('Error deleting role:', error);
          return throwError(() => error);
        }),
      );
  }

  getRolePermissions(roleId: number): Observable<number[]> {
    return this.http
      .get<any>(`${this.apiUrl}/organization/roles/${roleId}/permissions`)
      .pipe(
        map((response) => response.data?.permission_ids || []),
        catchError((error) => {
          console.error('Error getting role permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  assignPermissionsToRole(
    roleId: number,
    permissionData: AssignPermissionsDto,
  ): Observable<Role> {
    return this.http
      .post<Role>(
        `${this.apiUrl}/organization/roles/${roleId}/permissions`,
        permissionData,
      )
      .pipe(
        catchError((error) => {
          console.error('Error assigning permissions to role:', error);
          return throwError(() => error);
        }),
      );
  }

  removePermissionsFromRole(
    roleId: number,
    permissionData: AssignPermissionsDto,
  ): Observable<Role> {
    return this.http
      .delete<Role>(
        `${this.apiUrl}/organization/roles/${roleId}/permissions`,
        { body: permissionData },
      )
      .pipe(
        catchError((error) => {
          console.error('Error removing permissions from role:', error);
          return throwError(() => error);
        }),
      );
  }

  assignRoleToUser(roleData: AssignRoleToUserDto): Observable<void> {
    return this.http
      .post<void>(`${this.apiUrl}/organization/roles/assign-to-user`, roleData)
      .pipe(
        catchError((error) => {
          console.error('Error assigning role to user:', error);
          return throwError(() => error);
        }),
      );
  }

  removeRoleFromUser(roleData: RemoveRoleFromUserDto): Observable<void> {
    return this.http
      .post<void>(`${this.apiUrl}/organization/roles/remove-from-user`, roleData)
      .pipe(
        catchError((error) => {
          console.error('Error removing role from user:', error);
          return throwError(() => error);
        }),
      );
  }

  getUserRoles(userId: number): Observable<Role[]> {
    return this.http
      .get<any>(`${this.apiUrl}/organization/roles/user/${userId}/roles`)
      .pipe(
        map((response) => response.data || []),
        catchError((error) => {
          console.error('Error getting user roles:', error);
          return throwError(() => error);
        }),
      );
  }

  getUserPermissions(userId: number): Observable<Permission[]> {
    return this.http
      .get<any>(`${this.apiUrl}/organization/roles/user/${userId}/permissions`)
      .pipe(
        map((response) => response.data || []),
        catchError((error) => {
          console.error('Error getting user permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  getRolesStats(): Observable<RoleStats> {
    const now = Date.now();

    if (rolesStatsCache && now - rolesStatsCache.lastFetch < this.CACHE_TTL) {
      return rolesStatsCache.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiUrl}/organization/roles/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map(
          (response) =>
            response.data || {
              total_roles: 0,
              system_roles: 0,
              custom_roles: 0,
              total_permissions: 0,
            },
        ),
        catchError((error) => {
          console.error('Error getting roles stats:', error);
          return throwError(() => error);
        }),
        tap(() => {
          if (rolesStatsCache) {
            rolesStatsCache.lastFetch = now;
          }
        }),
      );

    rolesStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  invalidateCache(): void {
    rolesStatsCache = null;
  }

  getPermissions(query: { search?: string; status?: string } = {}): Observable<PaginatedPermissionsResponse> {
    this.isLoadingPermissions.set(true);

    let params = new HttpParams();
    if (query.search) params = params.set('search', query.search);
    if (query.status) params = params.set('status', query.status);

    return this.http
      .get<any>(`${this.apiUrl}/superadmin/admin/permissions`, { params })
      .pipe(
        map((response) => ({
          data: response.data || [],
          pagination: {
            page: response.meta?.page || 1,
            limit: response.meta?.limit || 100,
            total: response.meta?.total || 0,
            total_pages: response.meta?.totalPages || 1,
          },
        } as PaginatedPermissionsResponse)),
        finalize(() => this.isLoadingPermissions.set(false)),
        catchError((error) => {
          console.error('Error loading permissions:', error);
          return throwError(() => error);
        }),
      );
  }
}
