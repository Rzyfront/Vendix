import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, finalize, catchError, throwError, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Role,
  Permission,
  CreateRoleDto,
  UpdateRoleDto,
  CreatePermissionDto,
  UpdatePermissionDto,
  RoleQueryDto,
  PermissionQueryDto,
  AssignPermissionsDto,
  AssignRoleToUserDto,
  RemoveRoleFromUserDto,
  RoleStats,
  PaginatedRolesResponse,
  PaginatedPermissionsResponse,
  UserPermissionsResponse,
  PermissionStatus,
  HttpMethod
} from '../interfaces/role.interface';

@Injectable({
  providedIn: 'root'
})
export class RolesService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  // Estado de carga
  private isLoading$ = new BehaviorSubject<boolean>(false);
  private isCreatingRole$ = new BehaviorSubject<boolean>(false);
  private isUpdatingRole$ = new BehaviorSubject<boolean>(false);
  private isDeletingRole$ = new BehaviorSubject<boolean>(false);
  private isCreatingPermission$ = new BehaviorSubject<boolean>(false);
  private isUpdatingPermission$ = new BehaviorSubject<boolean>(false);
  private isDeletingPermission$ = new BehaviorSubject<boolean>(false);

  // Exponer estados como observables
  get isLoading() { return this.isLoading$.asObservable(); }
  get isCreatingRole() { return this.isCreatingRole$.asObservable(); }
  get isUpdatingRole() { return this.isUpdatingRole$.asObservable(); }
  get isDeletingRole() { return this.isDeletingRole$.asObservable(); }
  get isCreatingPermission() { return this.isCreatingPermission$.asObservable(); }
  get isUpdatingPermission() { return this.isUpdatingPermission$.asObservable(); }
  get isDeletingPermission() { return this.isDeletingPermission$.asObservable(); }

  // ==================== ROLES ====================

  /**
   * Obtener lista de roles con paginación y filtros
   */
  getRoles(query: RoleQueryDto = {}): Observable<PaginatedRolesResponse> {
    this.isLoading$.next(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.is_system_role !== undefined) params = params.set('is_system_role', query.is_system_role.toString());

    return this.http.get<any>(`${this.apiUrl}/roles`, { params }).pipe(
      map(response => {
        return {
          data: response.data,
          pagination: {
            page: response.meta?.page || 1,
            limit: response.meta?.limit || 10,
            total: response.meta?.total || 0,
            total_pages: response.meta?.totalPages || 0
          }
        } as PaginatedRolesResponse;
      }),
      finalize(() => this.isLoading$.next(false)),
      catchError(error => {
        console.error('Error loading roles:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtener rol por ID
   */
  getRoleById(id: number): Observable<Role> {
    return this.http.get<Role>(`${this.apiUrl}/roles/${id}`).pipe(
      catchError(error => {
        console.error('Error getting role:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Crear nuevo rol
   */
  createRole(roleData: CreateRoleDto): Observable<Role> {
    this.isCreatingRole$.next(true);

    return this.http.post<Role>(`${this.apiUrl}/roles`, roleData).pipe(
      finalize(() => this.isCreatingRole$.next(false)),
      catchError(error => {
        console.error('Error creating role:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Actualizar rol existente
   */
  updateRole(id: number, roleData: UpdateRoleDto): Observable<Role> {
    this.isUpdatingRole$.next(true);

    return this.http.patch<Role>(`${this.apiUrl}/roles/${id}`, roleData).pipe(
      finalize(() => this.isUpdatingRole$.next(false)),
      catchError(error => {
        console.error('Error updating role:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Eliminar rol
   */
  deleteRole(id: number): Observable<void> {
    this.isDeletingRole$.next(true);

    return this.http.delete<void>(`${this.apiUrl}/roles/${id}`).pipe(
      finalize(() => this.isDeletingRole$.next(false)),
      catchError(error => {
        console.error('Error deleting role:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Asignar permisos a un rol
   */
  assignPermissionsToRole(roleId: number, permissionData: AssignPermissionsDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/roles/${roleId}/permissions`, permissionData).pipe(
      catchError(error => {
        console.error('Error assigning permissions to role:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Remover permisos de un rol
   */
  removePermissionsFromRole(roleId: number, permissionData: AssignPermissionsDto): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/roles/${roleId}/permissions`, { body: permissionData }).pipe(
      catchError(error => {
        console.error('Error removing permissions from role:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Asignar rol a usuario
   */
  assignRoleToUser(roleData: AssignRoleToUserDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/roles/assign-to-user`, roleData).pipe(
      catchError(error => {
        console.error('Error assigning role to user:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Remover rol de usuario
   */
  removeRoleFromUser(roleData: RemoveRoleFromUserDto): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/roles/remove-from-user`, roleData).pipe(
      catchError(error => {
        console.error('Error removing role from user:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtener roles de un usuario
   */
  getUserRoles(userId: number): Observable<Role[]> {
    return this.http.get<any>(`${this.apiUrl}/roles/user/${userId}/roles`).pipe(
      map(response => response.data || []),
      catchError(error => {
        console.error('Error getting user roles:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtener permisos de un usuario
   */
  getUserPermissions(userId: number): Observable<Permission[]> {
    return this.http.get<any>(`${this.apiUrl}/roles/user/${userId}/permissions`).pipe(
      map(response => response.data || []),
      catchError(error => {
        console.error('Error getting user permissions:', error);
        return throwError(() => error);
      })
    );
  }

  // ==================== PERMISSIONS ====================

  /**
   * Obtener lista de permisos con paginación y filtros
   */
  getPermissions(query: PermissionQueryDto = {}): Observable<PaginatedPermissionsResponse> {
    this.isLoading$.next(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.method) params = params.set('method', query.method);
    if (query.status) params = params.set('status', query.status);

    return this.http.get<any>(`${this.apiUrl}/permissions`, { params }).pipe(
      map(response => {
        return {
          data: response.data,
          pagination: {
            page: response.meta?.page || 1,
            limit: response.meta?.limit || 10,
            total: response.meta?.total || 0,
            total_pages: response.meta?.totalPages || 0
          }
        } as PaginatedPermissionsResponse;
      }),
      finalize(() => this.isLoading$.next(false)),
      catchError(error => {
        console.error('Error loading permissions:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Obtener permiso por ID
   */
  getPermissionById(id: number): Observable<Permission> {
    return this.http.get<Permission>(`${this.apiUrl}/permissions/${id}`).pipe(
      catchError(error => {
        console.error('Error getting permission:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Crear nuevo permiso
   */
  createPermission(permissionData: CreatePermissionDto): Observable<Permission> {
    this.isCreatingPermission$.next(true);

    return this.http.post<Permission>(`${this.apiUrl}/permissions`, permissionData).pipe(
      finalize(() => this.isCreatingPermission$.next(false)),
      catchError(error => {
        console.error('Error creating permission:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Actualizar permiso existente
   */
  updatePermission(id: number, permissionData: UpdatePermissionDto): Observable<Permission> {
    this.isUpdatingPermission$.next(true);

    return this.http.patch<Permission>(`${this.apiUrl}/permissions/${id}`, permissionData).pipe(
      finalize(() => this.isUpdatingPermission$.next(false)),
      catchError(error => {
        console.error('Error updating permission:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Eliminar permiso
   */
  deletePermission(id: number): Observable<void> {
    this.isDeletingPermission$.next(true);

    return this.http.delete<void>(`${this.apiUrl}/permissions/${id}`).pipe(
      finalize(() => this.isDeletingPermission$.next(false)),
      catchError(error => {
        console.error('Error deleting permission:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Buscar permiso por nombre
   */
  searchPermissionByName(name: string): Observable<Permission> {
    return this.http.get<Permission>(`${this.apiUrl}/permissions/search/by-name/${name}`).pipe(
      catchError(error => {
        console.error('Error searching permission by name:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Buscar permiso por ruta y método
   */
  searchPermissionByPathAndMethod(path: string, method: string): Observable<Permission> {
    let params = new HttpParams();
    params = params.set('path', path);
    params = params.set('method', method);

    return this.http.get<Permission>(`${this.apiUrl}/permissions/search/by-path-method`, { params }).pipe(
      catchError(error => {
        console.error('Error searching permission by path and method:', error);
        return throwError(() => error);
      })
    );
  }

  // ==================== STATS ====================

  /**
   * Obtener estadísticas de roles y permisos
   */
  getRolesStats(): Observable<RoleStats> {
    return this.http.get<any>(`${this.apiUrl}/roles/dashboard`).pipe(
      map(response => response.data || {
        total_roles: 0,
        system_roles: 0,
        custom_roles: 0,
        total_permissions: 0
      }),
      catchError(error => {
        console.error('Error getting roles stats:', error);
        return throwError(() => error);
      })
    );
  }
}