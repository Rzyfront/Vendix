import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

import {
  Domain,
  DomainListItem,
  CreateDomainDto,
  UpdateDomainDto,
  DomainQueryDto,
  DomainStats,
} from '../interfaces/domain.interface';

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
export class DomainsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get all domains with pagination and filtering
   */
  getDomains(
    query?: DomainQueryDto,
  ): Observable<PaginatedResponse<DomainListItem[]>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.domain_type)
      params = params.set('domain_type', query.domain_type);
    if (query?.status) params = params.set('status', query.status);
    if (query?.organization_id)
      params = params.set('organization_id', query.organization_id.toString());

    return this.http.get<PaginatedResponse<DomainListItem[]>>(
      `${this.apiUrl}/superadmin/domains`,
      { params },
    );
  }

  /**
   * Get domain by ID
   */
  getDomainById(id: number): Observable<ApiResponse<Domain>> {
    return this.http.get<ApiResponse<Domain>>(
      `${this.apiUrl}/superadmin/domains/${id}`,
    );
  }

  /**
   * Create a new domain
   */
  createDomain(data: CreateDomainDto): Observable<ApiResponse<Domain>> {
    return this.http.post<ApiResponse<Domain>>(
      `${this.apiUrl}/superadmin/domains`,
      data,
    );
  }

  /**
   * Update an existing domain
   */
  updateDomain(
    id: number,
    data: UpdateDomainDto,
  ): Observable<ApiResponse<Domain>> {
    return this.http.patch<ApiResponse<Domain>>(
      `${this.apiUrl}/superadmin/domains/${id}`,
      data,
    );
  }

  /**
   * Delete a domain
   */
  deleteDomain(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/superadmin/domains/${id}`,
    );
  }

  /**
   * Get domain statistics (simplified version for dashboard)
   */
  getDomainStatsList(): Observable<ApiResponse<DomainStats>> {
    return this.http
      .get<any>(`${this.apiUrl}/superadmin/domains/dashboard`)
      .pipe(
        map((response: any) => {
          if (response.success && response.data) {
            // Map backend response to frontend interface
            const mappedData: DomainStats = {
              total_domains: response.data.total || 0,
              active_domains: response.data.active || 0,
              pending_domains: response.data.pending || 0,
              verified_domains: response.data.verified || 0,
              customer_domains: response.data.customDomains || 0,
              primary_domains: response.data.platformSubdomains || 0,
              alias_domains: response.data.aliasDomains || 0,
              vendix_subdomains: response.data.platformSubdomains || 0,
              customer_custom_domains: response.data.customDomains || 0,
              customer_subdomains: response.data.clientSubdomains || 0,
            };

            return {
              success: response.success,
              data: mappedData,
              message: response.message,
            };
          }
          return response;
        }),
      );
  }

  /**
   * Verify domain configuration
   */
  verifyDomain(id: number): Observable<ApiResponse<Domain>> {
    return this.http.post<ApiResponse<Domain>>(
      `${this.apiUrl}/superadmin/domains/${id}/verify`,
      {},
    );
  }

  /**
   * Activate domain
   */
  activateDomain(id: number): Observable<ApiResponse<Domain>> {
    return this.http.patch<ApiResponse<Domain>>(
      `${this.apiUrl}/superadmin/domains/${id}/activate`,
      {},
    );
  }

  /**
   * Deactivate domain
   */
  deactivateDomain(id: number): Observable<ApiResponse<Domain>> {
    return this.http.patch<ApiResponse<Domain>>(
      `${this.apiUrl}/superadmin/domains/${id}/deactivate`,
      {},
    );
  }

  /**
   * Get domains by organization ID
   */
  getDomainsByOrganization(
    organizationId: number,
    query?: Omit<DomainQueryDto, 'organization_id'>,
  ): Observable<PaginatedResponse<DomainListItem[]>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.domain_type)
      params = params.set('domain_type', query.domain_type);
    if (query?.status) params = params.set('status', query.status);

    return this.http.get<PaginatedResponse<DomainListItem[]>>(
      `${this.apiUrl}/organizations/${organizationId}/domains`,
      { params },
    );
  }

  /**
   * Get domains by store ID
   */
  getDomainsByStore(
    storeId: number,
    query?: Omit<DomainQueryDto, 'store_id'>,
  ): Observable<PaginatedResponse<DomainListItem[]>> {
    let params = new HttpParams();

    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.domain_type)
      params = params.set('domain_type', query.domain_type);
    if (query?.status) params = params.set('status', query.status);

    return this.http.get<PaginatedResponse<DomainListItem[]>>(
      `${this.apiUrl}/stores/${storeId}/domains`,
      { params },
    );
  }

  /**
   * Resolve domain (public endpoint)
   */
  resolveDomain(hostname: string): Observable<ApiResponse<Domain>> {
    return this.http.get<ApiResponse<Domain>>(
      `${this.apiUrl}/domains/resolve/${hostname}`,
    );
  }
}
