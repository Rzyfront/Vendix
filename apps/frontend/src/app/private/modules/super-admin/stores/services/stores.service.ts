import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable, finalize } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import {
  Store,
  StoreListItem,
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
  StoreDashboardDto,
  StoreDashboardResponse,
  StoreStats,
  PaginatedStoresResponse,
  StoreSettingsUpdateDto,
  StoreType,
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

@Injectable({
  providedIn: 'root',
})
export class StoresService {
  private readonly apiUrl = environment.apiUrl;
  private readonly http = inject(HttpClient);

  // States
  private isLoading$$ = new BehaviorSubject<boolean>(false);
  private isCreatingStore$$ = new BehaviorSubject<boolean>(false);
  private isUpdatingStore$$ = new BehaviorSubject<boolean>(false);
  private isDeletingStore$$ = new BehaviorSubject<boolean>(false);

  // Observables
  get isLoading$() {
    return this.isLoading$$.asObservable();
  }
  get isCreatingStore$() {
    return this.isCreatingStore$$.asObservable();
  }
  get isUpdatingStore$() {
    return this.isUpdatingStore$$.asObservable();
  }
  get isDeletingStore$() {
    return this.isDeletingStore$$.asObservable();
  }

  /**
   * Get all stores with pagination and filtering
   */
  getStores(
    query?: StoreQueryDto,
  ): Observable<PaginatedResponse<StoreListItem[]>> {
    this.isLoading$$.next(true);
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.store_type) params = params.set('store_type', query.store_type);
    if (query?.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());
    if (query?.organization_id)
      params = params.set('organization_id', query.organization_id.toString());

    const url = `${this.apiUrl}/superadmin/stores`;

    return this.http
      .get<PaginatedResponse<StoreListItem[]>>(url, { params })
      .pipe(finalize(() => this.isLoading$$.next(false)));
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
   * Get store by slug
   */
  getStoreBySlug(slug: string): Observable<ApiResponse<Store>> {
    return this.http.get<ApiResponse<Store>>(
      `${this.apiUrl}/superadmin/stores/slug/${slug}`,
    );
  }

  /**
   * Create a new store
   */
  createStore(data: CreateStoreDto): Observable<ApiResponse<Store>> {
    this.isCreatingStore$$.next(true);
    return this.http
      .post<ApiResponse<Store>>(`${this.apiUrl}/superadmin/stores`, data)
      .pipe(finalize(() => this.isCreatingStore$$.next(false)));
  }

  /**
   * Update an existing store
   */
  updateStore(
    id: number,
    data: UpdateStoreDto,
  ): Observable<ApiResponse<Store>> {
    this.isUpdatingStore$$.next(true);
    return this.http
      .patch<ApiResponse<Store>>(`${this.apiUrl}/superadmin/stores/${id}`, data)
      .pipe(finalize(() => this.isUpdatingStore$$.next(false)));
  }

  /**
   * Delete a store
   */
  deleteStore(id: number): Observable<ApiResponse<void>> {
    this.isDeletingStore$$.next(true);
    return this.http
      .delete<ApiResponse<void>>(`${this.apiUrl}/superadmin/stores/${id}`)
      .pipe(finalize(() => this.isDeletingStore$$.next(false)));
  }

  /**
   * Get store stats metrics
   */
  getStoreStats(
    id: number,
    dashboardData?: StoreDashboardDto,
  ): Observable<ApiResponse<StoreDashboardResponse>> {
    let params = new HttpParams();

    if (dashboardData?.start_date)
      params = params.set('start_date', dashboardData.start_date);
    if (dashboardData?.end_date)
      params = params.set('end_date', dashboardData.end_date);

    return this.http.get<ApiResponse<StoreDashboardResponse>>(
      `${this.apiUrl}/superadmin/stores/${id}/stats`,
      { params },
    );
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
    return this.http.get<ApiResponse<any>>(
      `${this.apiUrl}/superadmin/stores/dashboard`,
    );
  }

  /**
   * Get stores by organization ID
   */
  getStoresByOrganization(
    organizationId: number,
    query?: Omit<StoreQueryDto, 'organization_id'>,
  ): Observable<PaginatedResponse<StoreListItem[]>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.store_type) params = params.set('store_type', query.store_type);
    if (query?.is_active !== undefined)
      params = params.set('is_active', query.is_active.toString());

    return this.http.get<PaginatedResponse<StoreListItem[]>>(
      `${this.apiUrl}/organizations/${organizationId}/stores`,
      { params },
    );
  }

  /**
   * Upload store logo
   */
  uploadStoreLogo(
    storeId: number,
    file: File,
  ): Observable<ApiResponse<{ logo_url: string }>> {
    const formData = new FormData();
    formData.append('logo', file);

    return this.http.post<ApiResponse<{ logo_url: string }>>(
      `${this.apiUrl}/superadmin/stores/${storeId}/logo`,
      formData,
    );
  }

  /**
   * Upload store banner
   */
  uploadStoreBanner(
    storeId: number,
    file: File,
  ): Observable<ApiResponse<{ banner_url: string }>> {
    const formData = new FormData();
    formData.append('banner', file);

    return this.http.post<ApiResponse<{ banner_url: string }>>(
      `${this.apiUrl}/superadmin/stores/${storeId}/banner`,
      formData,
    );
  }

  /**
   * Update store settings
   */
  updateStoreSettings(
    storeId: number,
    settingsData: StoreSettingsUpdateDto,
  ): Observable<ApiResponse<Store['settings']>> {
    this.isUpdatingStore$$.next(true);
    return this.http
      .patch<ApiResponse<Store['settings']>>(
        `${this.apiUrl}/superadmin/stores/${storeId}/settings`,
        settingsData,
      )
      .pipe(finalize(() => this.isUpdatingStore$$.next(false)));
  }

  /**
   * Activate store
   */
  activateStore(id: number): Observable<ApiResponse<Store>> {
    return this.http.patch<ApiResponse<Store>>(
      `${this.apiUrl}/superadmin/stores/${id}/activate`,
      {},
    );
  }

  /**
   * Deactivate store
   */
  deactivateStore(id: number): Observable<ApiResponse<Store>> {
    return this.http.patch<ApiResponse<Store>>(
      `${this.apiUrl}/superadmin/stores/${id}/deactivate`,
      {},
    );
  }

  /**
   * Suspend store
   */
  suspendStore(id: number, reason?: string): Observable<ApiResponse<Store>> {
    const body = reason ? { reason } : {};
    return this.http.patch<ApiResponse<Store>>(
      `${this.apiUrl}/superadmin/stores/${id}/suspend`,
      body,
    );
  }

  /**
   * Archive store
   */
  archiveStore(id: number): Observable<ApiResponse<Store>> {
    return this.http.patch<ApiResponse<Store>>(
      `${this.apiUrl}/superadmin/stores/${id}/archive`,
      {},
    );
  }
}
