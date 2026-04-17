import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  BehaviorSubject,
  finalize,
  catchError,
  throwError,
  map,
} from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../../environments/environment';
import {
  StoreRole,
  StoreRoleStats,
  StorePermission,
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
  RolePermissionsResponse,
} from '../interfaces/store-role.interface';

// Cache estatico global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let storeRolesStatsCache: CacheEntry<Observable<StoreRoleStats>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class StoreRolesService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/store/roles`;
  private readonly CACHE_TTL = 30000; // 30 segundos

  // Estado de carga — Signals (Angular 20 Zoneless)
  readonly isLoading = signal(false);
  readonly isLoading$ = toObservable(this.isLoading);
  readonly isCreating = signal(false);
  readonly isCreating$ = toObservable(this.isCreating);
  readonly isUpdating = signal(false);
  readonly isUpdating$ = toObservable(this.isUpdating);

  /**
   * Obtener lista de roles de la tienda
   */
  getRoles(): Observable<{ data: StoreRole[] }> {
    this.isLoading.set(true);

    return this.http
      .get<{ data: StoreRole[] }>(this.baseUrl)
      .pipe(
        finalize(() => this.isLoading.set(false)),
        catchError((error) => {
          console.error('Error loading store roles:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener estadisticas de roles de la tienda
   */
  getStats(): Observable<StoreRoleStats> {
    const now = Date.now();

    if (
      storeRolesStatsCache &&
      now - storeRolesStatsCache.lastFetch < this.CACHE_TTL
    ) {
      return storeRolesStatsCache.observable;
    }

    const observable$ = this.http
      .get<{ data: StoreRoleStats }>(`${this.baseUrl}/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response) => response.data),
        tap(() => {
          if (storeRolesStatsCache) {
            storeRolesStatsCache.lastFetch = Date.now();
          }
        }),
        catchError((error) => {
          console.error('Error getting store roles stats:', error);
          return throwError(() => error);
        }),
      );

    storeRolesStatsCache = {
      observable: observable$,
      lastFetch: Date.now(),
    };

    return observable$;
  }

  /**
   * Obtener permisos disponibles
   */
  getAvailablePermissions(): Observable<StorePermission[]> {
    return this.http
      .get<{ data: StorePermission[] }>(`${this.baseUrl}/permissions/available`)
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          console.error('Error loading available permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Obtener permisos de un rol
   */
  getRolePermissions(id: number): Observable<RolePermissionsResponse> {
    return this.http
      .get<{ data: RolePermissionsResponse }>(`${this.baseUrl}/${id}/permissions`)
      .pipe(
        map((response) => response.data),
        catchError((error) => {
          console.error('Error loading role permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Crear nuevo rol
   */
  createRole(data: CreateStoreRoleDto): Observable<StoreRole> {
    this.isCreating.set(true);

    return this.http
      .post<StoreRole>(this.baseUrl, data)
      .pipe(
        finalize(() => this.isCreating.set(false)),
        catchError((error) => {
          console.error('Error creating store role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Actualizar rol existente
   */
  updateRole(id: number, data: UpdateStoreRoleDto): Observable<StoreRole> {
    this.isUpdating.set(true);

    return this.http
      .patch<StoreRole>(`${this.baseUrl}/${id}`, data)
      .pipe(
        finalize(() => this.isUpdating.set(false)),
        catchError((error) => {
          console.error('Error updating store role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Eliminar rol
   */
  deleteRole(id: number): Observable<any> {
    return this.http
      .delete(`${this.baseUrl}/${id}`)
      .pipe(
        catchError((error) => {
          console.error('Error deleting store role:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Asignar permisos a un rol
   */
  assignPermissions(id: number, permission_ids: number[]): Observable<any> {
    return this.http
      .post(`${this.baseUrl}/${id}/permissions`, { permission_ids })
      .pipe(
        catchError((error) => {
          console.error('Error assigning permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Remover permisos de un rol
   */
  removePermissions(id: number, permission_ids: number[]): Observable<any> {
    return this.http
      .delete(`${this.baseUrl}/${id}/permissions`, {
        body: { permission_ids },
      })
      .pipe(
        catchError((error) => {
          console.error('Error removing permissions:', error);
          return throwError(() => error);
        }),
      );
  }

  /**
   * Invalida el cache de estadisticas
   */
  invalidateCache(): void {
    storeRolesStatsCache = null;
  }
}
