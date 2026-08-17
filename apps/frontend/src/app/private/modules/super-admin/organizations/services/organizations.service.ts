import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

import { Organization } from '../../../../../core/models/organization.model';

import type {
  OrganizationListItem,
  OrganizationDetail,
  OrganizationCreatePayload,
  OrganizationUpdatePayload,
} from '../contracts/organization.contract';

// Legacy DTO aliases — keep the historical names so existing consumers
// (`organization-create-modal.component.ts`, etc.) keep compiling.
export type CreateOrganizationDto = OrganizationCreatePayload;
export type UpdateOrganizationDto = OrganizationUpdatePayload;

export interface OrganizationQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  state?: string;
  mode?: 'production' | 'demo' | 'test';
  include_non_production?: boolean;
}

export interface OrganizationDashboardDto {
  start_date?: string;
  end_date?: string;
}

export interface OrganizationDashboardResponse {
  totalStores: number;
  activeStores: number;
  totalUsers: number;
  totalProducts: number;
  totalOrders: number;
  totalRevenue: number;
}

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

let organizationsStatsCache: CacheEntry<Observable<any>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class OrganizationsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  constructor(private http: HttpClient) {}

  /**
   * Get all organizations with pagination and filtering.
   * Returns the rich list shape (phone, logo_url, description, legal_name,
   * tax_id, document_type, …) so the parent table can render reasonable
   * columns without a per-row detail round-trip.
   */
  getOrganizations(
    query?: OrganizationQueryDto,
  ): Observable<PaginatedResponse<OrganizationListItem[]>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.state) params = params.set('state', query.state);
    if (query?.mode) params = params.set('mode', query.mode);
    if (query?.include_non_production) params = params.set('include_non_production', 'true');

    return this.http.get<PaginatedResponse<OrganizationListItem[]>>(
      `${this.apiUrl}/superadmin/organizations`,
      { params },
    );
  }

  /**
   * Get organization by ID — returns the normalized `OrganizationDetail`
   * shape (DIAN fields, branding aliases, primary_address, full _count, …).
   */
  getOrganizationById(id: number): Observable<ApiResponse<OrganizationDetail>> {
    return this.http.get<ApiResponse<OrganizationDetail>>(
      `${this.apiUrl}/superadmin/organizations/${id}`,
    );
  }

  /**
   * Get organization by slug — returns the normalized `OrganizationDetail`
   * shape.
   */
  getOrganizationBySlug(slug: string): Observable<ApiResponse<OrganizationDetail>> {
    return this.http.get<ApiResponse<OrganizationDetail>>(
      `${this.apiUrl}/superadmin/organizations/slug/${slug}`,
    );
  }

  /**
   * Create a new organization — returns the normalized `OrganizationDetail`
   * shape so the modal can rehydrate on success without a separate GET.
   */
  createOrganization(
    data: CreateOrganizationDto,
  ): Observable<ApiResponse<OrganizationDetail>> {
    return this.http.post<ApiResponse<OrganizationDetail>>(
      `${this.apiUrl}/superadmin/organizations`,
      data,
    );
  }

  /**
   * Update an existing organization — returns the normalized
   * `OrganizationDetail` shape so the modal can refresh from the response
   * instead of issuing a follow-up GET.
   */
  updateOrganization(
    id: number,
    data: UpdateOrganizationDto,
  ): Observable<ApiResponse<OrganizationDetail>> {
    return this.http.patch<ApiResponse<OrganizationDetail>>(
      `${this.apiUrl}/superadmin/organizations/${id}`,
      data,
    );
  }

  /**
   * Delete an organization
   */
  deleteOrganization(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/superadmin/organizations/${id}`,
    );
  }

  /**
   * Get organization stats metrics
   */
  getOrganizationStats(
    id: number,
    dashboardData?: OrganizationDashboardDto,
  ): Observable<ApiResponse<OrganizationDashboardResponse>> {
    let params = new HttpParams();

    if (dashboardData?.start_date)
      params = params.set('start_date', dashboardData.start_date);
    if (dashboardData?.end_date)
      params = params.set('end_date', dashboardData.end_date);

    return this.http.get<ApiResponse<OrganizationDashboardResponse>>(
      `${this.apiUrl}/superadmin/organizations/${id}/stats`,
      { params },
    );
  }

  /**
   * Get dashboard statistics for organizations
   */
  getOrganizationStatsList(): Observable<
    ApiResponse<{
      totalOrganizations: number;
      activeOrganizations: number;
      inactiveOrganizations: number;
      suspendedOrganizations: number;
      demoOrganizations: number;
      testOrganizations: number;
      totalStores: number;
      totalUsers: number;
      recentOrganizations: any[];
    }>
  > {
    const now = Date.now();

    if (organizationsStatsCache && (now - organizationsStatsCache.lastFetch) < this.CACHE_TTL) {
      return organizationsStatsCache.observable;
    }

    const observable$ = this.http.get<ApiResponse<any>>(
      `${this.apiUrl}/superadmin/organizations/dashboard`,
    ).pipe(
      tap(() => {
        if (organizationsStatsCache) {
          organizationsStatsCache.lastFetch = Date.now();
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    // Guardar en caché estático
    organizationsStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar organizaciones
   */
  invalidateCache(): void {
    organizationsStatsCache = null;
  }
}
