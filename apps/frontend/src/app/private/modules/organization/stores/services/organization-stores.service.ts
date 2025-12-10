import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import {
  Store,
  StoreListItem,
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
  StoreStats,
  PaginatedStoresResponse,
  StoreSettings,
  StoreSettingsUpdateDto,
  StoreFilters,
  StoreDashboardDto,
  StoreDashboardResponse,
  StoreType,
  StoreState,
} from '../interfaces/store.interface';

// All interfaces now available locally

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

@Injectable({
  providedIn: 'root',
})
export class OrganizationStoresService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get all stores for current organization with pagination and filtering
   */
  getStores(
    query?: Omit<StoreQueryDto, 'organization_id'>,
  ): Observable<PaginatedResponse<StoreListItem[]>> {
    let params = new HttpParams();

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params = params.set(key, value.toString());
        }
      });
    }

    // Organization scoping is handled automatically by backend
    return this.http.get<PaginatedResponse<StoreListItem[]>>(
      `${this.apiUrl}/organization/stores`,
      { params },
    );
  }

  /**
   * Create a new store for the current organization
   */
  createStore(
    storeData: Omit<CreateStoreDto, 'organization_id'>,
  ): Observable<ApiResponse<Store>> {
    // Organization scoping is handled automatically by backend
    return this.http.post<ApiResponse<Store>>(
      `${this.apiUrl}/organization/stores`,
      storeData,
    );
  }

  /**
   * Update a store (only if belongs to current organization)
   */
  updateStore(
    id: number,
    storeData: UpdateStoreDto,
  ): Observable<ApiResponse<Store>> {
    return this.http.patch<ApiResponse<Store>>(
      `${this.apiUrl}/organization/stores/${id}`,
      storeData,
    );
  }

  /**
   * Delete a store (only if belongs to current organization)
   */
  deleteStore(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/organization/stores/${id}`,
    );
  }

  /**
   * Get store dashboard statistics
   */
  getStoreDashboard(
    id: number,
    dashboardQuery?: StoreDashboardDto,
  ): Observable<ApiResponse<StoreDashboardResponse>> {
    let params = new HttpParams();

    if (dashboardQuery) {
      if (dashboardQuery.start_date) {
        params = params.set('start_date', dashboardQuery.start_date);
      }
      if (dashboardQuery.end_date) {
        params = params.set('end_date', dashboardQuery.end_date);
      }
    }

    return this.http.get<ApiResponse<StoreDashboardResponse>>(
      `${this.apiUrl}/organization/stores/${id}/stats`,
      { params },
    );
  }

  /**
   * Get global store statistics for current organization
   */
  getOrganizationStoreStats(): Observable<ApiResponse<StoreStats>> {
    return this.http.get<ApiResponse<StoreStats>>(
      `${this.apiUrl}/organization/stores/stats`,
    );
  }

  /**
   * Update store settings
   */
  updateStoreSettings(
    id: number,
    settings: StoreSettingsUpdateDto,
  ): Observable<ApiResponse<any>> {
    return this.http.patch<ApiResponse<any>>(
      `${this.apiUrl}/organization/stores/${id}/settings`,
      settings,
    );
  }

  /**
   * Activate store
   */
  activateStore(id: number): Observable<ApiResponse<Store>> {
    return this.updateStore(id, { is_active: true });
  }

  /**
   * Deactivate store
   */
  deactivateStore(id: number): Observable<ApiResponse<Store>> {
    return this.updateStore(id, { is_active: false });
  }

  /**
   * Store type options for dropdown
   */
  getStoreTypeOptions(): Array<{ value: StoreType; label: string }> {
    return [
      { value: StoreType.PHYSICAL, label: 'Tienda Física' },
      { value: StoreType.ONLINE, label: 'Tienda Online' },
      { value: StoreType.HYBRID, label: 'Tienda Híbrida' },
      { value: StoreType.POPUP, label: 'Tienda Popup' },
      { value: StoreType.KIOSKO, label: 'Kiosko' },
    ];
  }

  /**
   * Store state options for dropdown
   */
  getStoreStateOptions(): Array<{ value: StoreState; label: string }> {
    return [
      { value: StoreState.ACTIVE, label: 'Activa' },
      { value: StoreState.INACTIVE, label: 'Inactiva' },
      { value: StoreState.DRAFT, label: 'Borrador' },
      { value: StoreState.SUSPENDED, label: 'Suspendida' },
      { value: StoreState.ARCHIVED, label: 'Archivada' },
    ];
  }

  /**
   * Common timezones for dropdown
   */
  getTimezoneOptions(): Array<{ value: string; label: string }> {
    return [
      { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
      { value: 'America/Medellin', label: 'Medellín (UTC-5)' },
      { value: 'America/Cali', label: 'Cali (UTC-5)' },
      { value: 'America/Barranquilla', label: 'Barranquilla (UTC-5)' },
      { value: 'America/Cartagena', label: 'Cartagena (UTC-5)' },
      { value: 'America/Bucaramanga', label: 'Bucaramanga (UTC-5)' },
      { value: 'America/Pereira', label: 'Pereira (UTC-5)' },
      { value: 'America/Cucuta', label: 'Cúcuta (UTC-5)' },
      { value: 'America/Santa_Marta', label: 'Santa Marta (UTC-5)' },
      { value: 'America/Ibague', label: 'Ibagué (UTC-5)' },
      { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
      { value: 'America/New_York', label: 'Nueva York (UTC-5)' },
      { value: 'America/Los_Angeles', label: 'Los Ángeles (UTC-8)' },
      { value: 'Europe/Madrid', label: 'Madrid (UTC+1)' },
      { value: 'Europe/Paris', label: 'París (UTC+1)' },
    ];
  }

  /**
   * Common currency codes for dropdown
   */
  getCurrencyOptions(): Array<{ value: string; label: string }> {
    return [
      { value: 'COP', label: 'Peso Colombiano (COP)' },
      { value: 'USD', label: 'Dólar Americano (USD)' },
      { value: 'EUR', label: 'Euro (EUR)' },
      { value: 'GBP', label: 'Libra Esterlina (GBP)' },
      { value: 'MXN', label: 'Peso Mexicano (MXN)' },
      { value: 'BRL', label: 'Real Brasileño (BRL)' },
      { value: 'CAD', label: 'Dólar Canadiense (CAD)' },
      { value: 'AUD', label: 'Dólar Australiano (AUD)' },
      { value: 'JPY', label: 'Yen Japonés (JPY)' },
      { value: 'CNY', label: 'Yuan Chino (CNY)' },
    ];
  }
}
