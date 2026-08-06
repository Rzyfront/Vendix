import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, finalize, tap, shareReplay } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';

import {
  Store,
  StoreListItem,
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
} from '../interfaces/store.interface';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let storesStatsCache: CacheEntry<Observable<any>> | null = null;

/**
 * Cliente HTTP del directorio de tiendas del super admin.
 *
 * **Sólo expone lo que `superadmin/stores` publica de verdad.** El controlador
 * (`apps/backend/src/domains/superadmin/stores/stores.controller.ts`) tiene
 * exactamente seis rutas: `POST /`, `GET /`, `GET /dashboard`, `GET /:id`,
 * `PATCH /:id` y `DELETE /:id`.
 *
 * Este servicio arrastraba diez métodos más que apuntaban a rutas que ese
 * controlador nunca declaró (`/:id/settings`, `/:id/activate`, `/:id/suspend`,
 * `/:id/logo`, …). Ninguna respondía otra cosa que 404, y varias vivían en la
 * UI como botones que "fallaban a veces". Se retiraron en bloque: un método
 * muerto en un servicio compartido es una invitación a cablearlo.
 *
 * Antes de reintroducir cualquiera de ellos, publicar primero la ruta en el
 * controlador. El estado y la configuración de una tienda se editan hoy con
 * `PATCH /superadmin/stores/:id` (campo `is_active`) y desde la ficha de
 * tenant (`/super-admin/stores/:id/...`), que sí tiene backend.
 */
@Injectable({
  providedIn: 'root',
})
export class StoresService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);
  private readonly CACHE_TTL = 30000; // 30 segundos

  // States (Signals)
  readonly isLoading = signal(false);
  readonly isCreatingStore = signal(false);
  readonly isUpdatingStore = signal(false);
  readonly isDeletingStore = signal(false);

  // Observable compatibility layer
  readonly isLoading$ = toObservable(this.isLoading);
  readonly isCreatingStore$ = toObservable(this.isCreatingStore);
  readonly isUpdatingStore$ = toObservable(this.isUpdatingStore);
  readonly isDeletingStore$ = toObservable(this.isDeletingStore);

  /**
   * Get all stores with pagination and filtering
   */
  getStores(
    query?: StoreQueryDto,
  ): Observable<PaginatedResponse<StoreListItem[]>> {
    this.isLoading.set(true);
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.store_type) params = params.set('store_type', query.store_type);
    if (query?.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());
    if (query?.organization_id)
      params = params.set('organization_id', query.organization_id.toString());
    if (query?.include_non_production)
      params = params.set('include_non_production', 'true');

    const url = `${this.apiUrl}/superadmin/stores`;

    return this.http
      .get<PaginatedResponse<StoreListItem[]>>(url, { params })
      .pipe(finalize(() => this.isLoading.set(false)));
  }

  /**
   * Get store by ID
   */
  getStoreById(id: number): Observable<ApiResponse<Store>> {
    return this.http.get<ApiResponse<Store>>(
      `${this.apiUrl}/superadmin/stores/${id}`,
    );
  }

  /**
   * Create a new store
   */
  createStore(data: CreateStoreDto): Observable<ApiResponse<Store>> {
    this.isCreatingStore.set(true);
    return this.http
      .post<ApiResponse<Store>>(`${this.apiUrl}/superadmin/stores`, data)
      .pipe(finalize(() => this.isCreatingStore.set(false)));
  }

  /**
   * Update an existing store
   */
  updateStore(
    id: number,
    data: UpdateStoreDto,
  ): Observable<ApiResponse<Store>> {
    this.isUpdatingStore.set(true);
    return this.http
      .patch<ApiResponse<Store>>(`${this.apiUrl}/superadmin/stores/${id}`, data)
      .pipe(finalize(() => this.isUpdatingStore.set(false)));
  }

  /**
   * Delete a store
   */
  deleteStore(id: number): Observable<ApiResponse<void>> {
    this.isDeletingStore.set(true);
    return this.http
      .delete<ApiResponse<void>>(`${this.apiUrl}/superadmin/stores/${id}`)
      .pipe(finalize(() => this.isDeletingStore.set(false)));
  }

  /**
   * Get dashboard statistics for stores
   */
  getStoreStatsList(): Observable<
    ApiResponse<{
      totalStores: number;
      activeStores: number;
      storesByType: Record<string, number>;
      storesByState: Record<string, number>;
      recentStores: any[];
    }>
  > {
    const now = Date.now();

    if (storesStatsCache && (now - storesStatsCache.lastFetch) < this.CACHE_TTL) {
      return storesStatsCache.observable;
    }

    const observable$ = this.http.get<ApiResponse<any>>(
      `${this.apiUrl}/superadmin/stores/dashboard`,
    ).pipe(
      tap(() => {
        if (storesStatsCache) {
          storesStatsCache.lastFetch = Date.now();
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    storesStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar tiendas
   */
  invalidateCache(): void {
    storesStatsCache = null;
  }
}
