import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  Observable,
  finalize,
  catchError,
  throwError,
  map,
  tap,
  shareReplay,
} from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
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
  RoleAssignmentRemoval,
  RoleAssignmentResult,
  RoleStats,
  RoleUserAssignment,
  PaginatedRolesResponse,
  PaginatedPermissionsResponse,
  TenantOption,
  UserRoleAssignment,
} from '../interfaces/role.interface';

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let rolesStatsCache: CacheEntry<Observable<RoleStats>> | null = null;

const EMPTY_SCOPE_BREAKDOWN = { system: 0, organization: 0, store: 0 };

@Injectable({
  providedIn: 'root',
})
export class RolesService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  /** Catálogos de tenants para filtros y pickers (poco volátiles). */
  private organizationOptions$?: Observable<TenantOption[]>;
  private storeOptionsByOrg = new Map<string, Observable<TenantOption[]>>();

  // Estados (Signals)
  readonly isLoading = signal(false);
  readonly isCreatingRole = signal(false);
  readonly isUpdatingRole = signal(false);
  readonly isDeletingRole = signal(false);
  readonly isCreatingPermission = signal(false);
  readonly isUpdatingPermission = signal(false);
  readonly isDeletingPermission = signal(false);

  // Observable compatibility layer
  readonly isLoading$ = toObservable(this.isLoading);
  readonly isCreatingRole$ = toObservable(this.isCreatingRole);
  readonly isUpdatingRole$ = toObservable(this.isUpdatingRole);
  readonly isDeletingRole$ = toObservable(this.isDeletingRole);
  readonly isCreatingPermission$ = toObservable(this.isCreatingPermission);
  readonly isUpdatingPermission$ = toObservable(this.isUpdatingPermission);
  readonly isDeletingPermission$ = toObservable(this.isDeletingPermission);

  // ==================== ROLES ====================

  /**
   * Lista paginada de roles de TODOS los tenants.
   *
   * `scope`, `organization_id` y `store_id` son los filtros que hacen manejable
   * el listado a nivel plataforma: sin ellos conviven los roles de sistema con
   * los de cada organización y cada tienda.
   */
  getRoles(query: RoleQueryDto = {}): Observable<PaginatedRolesResponse> {
    this.isLoading.set(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.is_system_role !== undefined)
      params = params.set('is_system_role', query.is_system_role.toString());
    if (query.scope) params = params.set('scope', query.scope);
    if (query.organization_id !== undefined)
      params = params.set('organization_id', query.organization_id.toString());
    if (query.store_id !== undefined)
      params = params.set('store_id', query.store_id.toString());

    return this.http
      .get<any>(`${this.apiUrl}/superadmin/roles`, { params })
      .pipe(
        map((response) => {
          const mappedData: Role[] = (response.data || []).map((role: any) => ({
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

  /**
   * Obtener rol por ID.
   *
   * El controlador responde con la envoltura `ResponseService.success`, así que
   * el rol vive en `data` — leer la raíz devolvía un objeto sin `id` ni `scope`.
   */
  getRoleById(id: number): Observable<Role> {
    return this.http.get<any>(`${this.apiUrl}/superadmin/roles/${id}`).pipe(
      map((response) => (response?.data ?? response) as Role),
      catchError((error) => {
        console.error('Error getting role:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Crear nuevo rol.
   *
   * `organization_id` / `store_id` viajan sólo si el llamador los define: a
   * nivel plataforma son los que deciden el alcance del rol creado.
   */
  createRole(roleData: CreateRoleDto): Observable<Role> {
    this.isCreatingRole.set(true);

    return this.http
      .post<any>(`${this.apiUrl}/superadmin/roles`, roleData)
      .pipe(
        map((response) => (response?.data ?? response) as Role),
        finalize(() => this.isCreatingRole.set(false)),
        catchError((error) => {
          console.error('Error creating role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Actualizar rol existente (incluido su alcance).
   *
   * El backend distingue `undefined` (conserva) de `null` (desvincula), así que
   * el payload se envía tal cual llega, sin normalizar los nulos.
   */
  updateRole(id: number, roleData: UpdateRoleDto): Observable<Role> {
    this.isUpdatingRole.set(true);

    return this.http
      .patch<any>(`${this.apiUrl}/superadmin/roles/${id}`, roleData)
      .pipe(
        map((response) => (response?.data ?? response) as Role),
        finalize(() => this.isUpdatingRole.set(false)),
        catchError((error) => {
          console.error('Error updating role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Eliminar rol
   */
  deleteRole(id: number): Observable<void> {
    this.isDeletingRole.set(true);

    return this.http.delete<void>(`${this.apiUrl}/superadmin/roles/${id}`).pipe(
      finalize(() => this.isDeletingRole.set(false)),
      catchError((error) => {
        console.error('Error deleting role:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Asignar permisos a un rol
   */
  assignPermissionsToRole(
    roleId: number,
    permissionData: AssignPermissionsDto,
  ): Observable<void> {
    return this.http
      .post<void>(
        `${this.apiUrl}/superadmin/roles/${roleId}/permissions`,
        permissionData,
      )
      .pipe(
        catchError((error) => {
          console.error('Error assigning permissions to role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remover permisos de un rol
   */
  removePermissionsFromRole(
    roleId: number,
    permissionData: AssignPermissionsDto,
  ): Observable<void> {
    return this.http
      .delete<void>(`${this.apiUrl}/superadmin/roles/${roleId}/permissions`, {
        body: permissionData,
      })
      .pipe(
        catchError((error) => {
          console.error('Error removing permissions from role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener permisos de un rol específico
   */
  getRolePermissions(roleId: number): Observable<number[]> {
    return this.http
      .get<any>(`${this.apiUrl}/superadmin/roles/${roleId}/permissions`)
      .pipe(
        map((response) => response.data?.permission_ids || []),
        catchError((error) => {
          console.error('Error getting role permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  // ==================== ASIGNACIÓN ROL ↔ USUARIO ====================
  //
  // QUI-72 — Las dos direcciones se sirven desde ESTE servicio para que la
  // pestaña "Usuarios" del rol y el editor de roles del usuario no puedan
  // divergir. En el backend ambas atraviesan `SuperadminRoleAssignmentService`;
  // duplicar la llamada en dos servicios de frontend reintroduciría por arriba
  // la divergencia que el backend cerró por abajo.

  /** Dirección rol → usuarios. */
  getRoleUsers(roleId: number): Observable<RoleUserAssignment[]> {
    return this.http
      .get<any>(`${this.apiUrl}/superadmin/roles/${roleId}/users`)
      .pipe(
        map((response) => (response?.data ?? []) as RoleUserAssignment[]),
        catchError((error) => {
          console.error('Error getting role users:', error);
          return throwError(() => error);
        }),
      );
  }

  /** Dirección usuario → roles, con el `store_id` de cada asignación. */
  getUserRoles(userId: number): Observable<UserRoleAssignment[]> {
    return this.http
      .get<any>(`${this.apiUrl}/superadmin/users/${userId}/roles`)
      .pipe(
        map((response) => (response?.data ?? []) as UserRoleAssignment[]),
        catchError((error) => {
          console.error('Error getting user roles:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Asignar un rol a un usuario.
   *
   * `storeId` ausente o `null` = asignación org-wide (aplica en todas las
   * tiendas de la organización). Para un rol de alcance tienda el backend fuerza
   * la tienda del rol y rechaza cualquier otra con `ROLE_ASSIGN_007`.
   */
  assignRoleToUser(
    roleId: number,
    userId: number,
    storeId?: number | null,
  ): Observable<RoleAssignmentResult> {
    return this.http
      .post<any>(`${this.apiUrl}/superadmin/roles/${roleId}/users/${userId}`, {
        store_id: storeId ?? null,
      })
      .pipe(
        map((response) => (response?.data ?? response) as RoleAssignmentResult),
        catchError((error) => {
          console.error('Error assigning role to user:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Quitar un rol a un usuario.
   *
   * El `store_id` selecciona QUÉ asignación se borra: sin él se apunta a la
   * org-wide, que es una fila distinta de la de cada tienda.
   */
  removeRoleFromUser(
    roleId: number,
    userId: number,
    storeId?: number | null,
  ): Observable<RoleAssignmentRemoval> {
    let params = new HttpParams();
    if (storeId !== undefined && storeId !== null) {
      params = params.set('store_id', storeId.toString());
    }

    return this.http
      .delete<any>(
        `${this.apiUrl}/superadmin/roles/${roleId}/users/${userId}`,
        { params },
      )
      .pipe(
        map(
          (response) => (response?.data ?? response) as RoleAssignmentRemoval,
        ),
        catchError((error) => {
          console.error('Error removing role from user:', error);
          return throwError(() => error);
        }),
      );
  }

  // ==================== CATÁLOGOS DE TENANT ====================

  /**
   * Organizaciones para el filtro del listado y el picker de alcance.
   *
   * Se cachea con `shareReplay` porque tres consumidores (filtro, modal de
   * creación y modal de edición) la piden en la misma pantalla.
   */
  getOrganizationOptions(): Observable<TenantOption[]> {
    if (!this.organizationOptions$) {
      const params = new HttpParams().set('limit', '200').set('page', '1');

      this.organizationOptions$ = this.http
        .get<any>(`${this.apiUrl}/superadmin/organizations`, { params })
        .pipe(
          map((response) =>
            ((response?.data ?? []) as any[]).map((org) => ({
              id: org.id,
              name: org.name,
            })),
          ),
          shareReplay({ bufferSize: 1, refCount: false }),
          catchError((error) => {
            console.error('Error loading organizations:', error);
            this.organizationOptions$ = undefined;
            return throwError(() => error);
          }),
        );
    }

    return this.organizationOptions$;
  }

  /** Tiendas (opcionalmente acotadas a una organización) para los pickers. */
  getStoreOptions(organizationId?: number | null): Observable<TenantOption[]> {
    const key = organizationId != null ? String(organizationId) : 'all';
    const cached = this.storeOptionsByOrg.get(key);
    if (cached) return cached;

    let params = new HttpParams().set('limit', '200').set('page', '1');
    if (organizationId != null) {
      params = params.set('organization_id', organizationId.toString());
    }

    const request$ = this.http
      .get<any>(`${this.apiUrl}/superadmin/stores`, { params })
      .pipe(
        map((response) =>
          ((response?.data ?? []) as any[]).map((store) => ({
            id: store.id,
            name: store.name,
          })),
        ),
        shareReplay({ bufferSize: 1, refCount: false }),
        catchError((error) => {
          console.error('Error loading stores:', error);
          this.storeOptionsByOrg.delete(key);
          return throwError(() => error);
        }),
      );

    this.storeOptionsByOrg.set(key, request$);
    return request$;
  }

  // ==================== PERMISSIONS ====================

  /**
   * Obtener lista de permisos con paginación y filtros
   */
  getPermissions(
    query: PermissionQueryDto = {},
  ): Observable<PaginatedPermissionsResponse> {
    this.isLoading.set(true);

    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.search) params = params.set('search', query.search);
    if (query.method) params = params.set('method', query.method);
    if (query.status) params = params.set('status', query.status);

    return this.http
      .get<any>(`${this.apiUrl}/superadmin/admin/permissions`, { params })
      .pipe(
        map((response) => {
          return {
            data: response.data,
            pagination: {
              page: response.meta?.page || 1,
              limit: response.meta?.limit || 10,
              total: response.meta?.total || 0,
              total_pages: response.meta?.totalPages || 0,
            },
          } as PaginatedPermissionsResponse;
        }),
        finalize(() => this.isLoading.set(false)),
        catchError((error) => {
          console.error('Error loading permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener permiso por ID
   */
  getPermissionById(id: number): Observable<Permission> {
    return this.http
      .get<Permission>(`${this.apiUrl}/superadmin/admin/permissions/${id}`)
      .pipe(
        catchError((error) => {
          console.error('Error getting permission:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Crear nuevo permiso
   */
  createPermission(
    permissionData: CreatePermissionDto,
  ): Observable<Permission> {
    this.isCreatingPermission.set(true);

    return this.http
      .post<Permission>(
        `${this.apiUrl}/superadmin/admin/permissions`,
        permissionData,
      )
      .pipe(
        finalize(() => this.isCreatingPermission.set(false)),
        catchError((error) => {
          console.error('Error creating permission:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Actualizar permiso existente
   */
  updatePermission(
    id: number,
    permissionData: UpdatePermissionDto,
  ): Observable<Permission> {
    this.isUpdatingPermission.set(true);

    return this.http
      .patch<Permission>(
        `${this.apiUrl}/superadmin/admin/permissions/${id}`,
        permissionData,
      )
      .pipe(
        finalize(() => this.isUpdatingPermission.set(false)),
        catchError((error) => {
          console.error('Error updating permission:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Eliminar permiso
   */
  deletePermission(id: number): Observable<void> {
    this.isDeletingPermission.set(true);

    return this.http
      .delete<void>(`${this.apiUrl}/superadmin/admin/permissions/${id}`)
      .pipe(
        finalize(() => this.isDeletingPermission.set(false)),
        catchError((error) => {
          console.error('Error deleting permission:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Buscar permiso por nombre
   */
  searchPermissionByName(name: string): Observable<Permission> {
    return this.http
      .get<Permission>(
        `${this.apiUrl}/superadmin/admin/permissions/search/by-name/${name}`,
      )
      .pipe(
        catchError((error) => {
          console.error('Error searching permission by name:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Buscar permiso por ruta y método
   */
  searchPermissionByPathAndMethod(
    path: string,
    method: string,
  ): Observable<Permission> {
    let params = new HttpParams();
    params = params.set('path', path);
    params = params.set('method', method);

    return this.http
      .get<Permission>(
        `${this.apiUrl}/superadmin/admin/permissions/search/by-path-method`,
        {
          params,
        },
      )
      .pipe(
        catchError((error) => {
          console.error(
            'Error searching permission by path and method:',
            error,
          );
          return throwError(() => error);
        }),
      );
  }

  // ==================== STATS ====================

  /**
   * Estadísticas de roles y permisos.
   *
   * `rolesByScope` es el desglose por alcance DERIVADO; `systemRoles` sigue
   * siendo el flag crudo `is_system_role` y no significa lo mismo.
   */
  getRolesStats(): Observable<RoleStats> {
    const now = Date.now();

    if (rolesStatsCache && now - rolesStatsCache.lastFetch < this.CACHE_TTL) {
      return rolesStatsCache.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiUrl}/superadmin/roles/dashboard`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response) => {
          const data = response?.data ?? {};
          return {
            totalRoles: data.totalRoles ?? 0,
            systemRoles: data.systemRoles ?? 0,
            customRoles: data.customRoles ?? 0,
            totalPermissions: data.totalPermissions ?? 0,
            rolesByScope: {
              ...EMPTY_SCOPE_BREAKDOWN,
              ...(data.rolesByScope ?? {}),
            },
          } as RoleStats;
        }),
        catchError((error) => {
          console.error('Error getting roles stats:', error);
          return throwError(() => error);
        }),
        tap(() => {
          if (rolesStatsCache) {
            rolesStatsCache.lastFetch = Date.now();
          }
        }),
      );

    rolesStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar roles
   */
  invalidateCache(): void {
    rolesStatsCache = null;
  }

  /** Invalida los catálogos de organizaciones/tiendas. */
  invalidateTenantOptions(): void {
    this.organizationOptions$ = undefined;
    this.storeOptionsByOrg.clear();
  }
}
