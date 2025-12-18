import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import { Organization } from '../../../../../core/models/organization.model';

// Define interfaces that are missing from the core models
export interface CreateOrganizationDto {
  name: string;
  email: string;
  phone?: string;
  website?: string;
  description?: string;
  legal_name?: string;
  tax_id?: string;
  state?: string;
}

export interface UpdateOrganizationDto {
  name?: string;
  slug?: string;
  legal_name?: string;
  tax_id?: string;
  email?: string;
  phone?: string;
  website?: string;
  logo_url?: string;
  description?: string;
  state?: string;
}

export interface OrganizationQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  state?: string;
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

@Injectable({
  providedIn: 'root',
})
export class OrganizationsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get all organizations with pagination and filtering
   */
  getOrganizations(
    query?: OrganizationQueryDto,
  ): Observable<PaginatedResponse<Organization[]>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.state) params = params.set('state', query.state);

    return this.http.get<PaginatedResponse<Organization[]>>(
      `${this.apiUrl}/superadmin/organizations`,
      { params },
    );
  }

  /**
   * Get organization by ID
   */
  getOrganizationById(id: number): Observable<ApiResponse<Organization>> {
    return this.http.get<ApiResponse<Organization>>(
      `${this.apiUrl}/superadmin/organizations/${id}`,
    );
  }

  /**
   * Get organization by slug
   */
  getOrganizationBySlug(slug: string): Observable<ApiResponse<Organization>> {
    return this.http.get<ApiResponse<Organization>>(
      `${this.apiUrl}/superadmin/organizations/slug/${slug}`,
    );
  }

  /**
   * Create a new organization
   */
  createOrganization(
    data: CreateOrganizationDto,
  ): Observable<ApiResponse<Organization>> {
    return this.http.post<ApiResponse<Organization>>(
      `${this.apiUrl}/superadmin/organizations`,
      data,
    );
  }

  /**
   * Update an existing organization
   */
  updateOrganization(
    id: number,
    data: UpdateOrganizationDto,
  ): Observable<ApiResponse<Organization>> {
    return this.http.patch<ApiResponse<Organization>>(
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
      totalStores: number;
      totalUsers: number;
      recentOrganizations: any[];
    }>
  > {
    return this.http.get<ApiResponse<any>>(
      `${this.apiUrl}/superadmin/organizations/dashboard`,
    );
  }
}
