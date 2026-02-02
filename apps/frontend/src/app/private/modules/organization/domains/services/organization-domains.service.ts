import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

import {
  Domain,
  DomainStats,
  CreateDomainDto,
  UpdateDomainDto,
  DomainQueryDto,
  VerifyDomainResult,
  DomainStatus,
  DomainOwnership,
  AppType,
} from '../interfaces/domain.interface';

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
export class OrganizationDomainsService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Get all domains for current organization with pagination and filtering
   */
  getDomains(query?: DomainQueryDto): Observable<PaginatedResponse<Domain>> {
    let params = new HttpParams();

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params = params.set(key, value.toString());
        }
      });
    }

    return this.http.get<PaginatedResponse<Domain>>(
      `${this.apiUrl}/organization/domains`,
      { params },
    );
  }

  /**
   * Get domain statistics for current organization
   */
  getDomainStats(): Observable<ApiResponse<DomainStats>> {
    return this.http.get<ApiResponse<DomainStats>>(
      `${this.apiUrl}/organization/domains/stats`,
    );
  }

  /**
   * Get domain by ID
   */
  getDomainById(id: number): Observable<ApiResponse<Domain>> {
    return this.http.get<ApiResponse<Domain>>(
      `${this.apiUrl}/organization/domains/${id}`,
    );
  }

  /**
   * Get domain by hostname
   */
  getDomainByHostname(hostname: string): Observable<ApiResponse<Domain>> {
    return this.http.get<ApiResponse<Domain>>(
      `${this.apiUrl}/organization/domains/hostname/${hostname}`,
    );
  }

  /**
   * Create a new domain
   */
  createDomain(data: CreateDomainDto): Observable<ApiResponse<Domain>> {
    return this.http.post<ApiResponse<Domain>>(
      `${this.apiUrl}/organization/domains`,
      {
        ...data,
        config: data.config || {},
      },
    );
  }

  /**
   * Update a domain by hostname
   */
  updateDomain(
    hostname: string,
    data: UpdateDomainDto,
  ): Observable<ApiResponse<Domain>> {
    return this.http.put<ApiResponse<Domain>>(
      `${this.apiUrl}/organization/domains/hostname/${hostname}`,
      data,
    );
  }

  /**
   * Delete a domain by hostname
   */
  deleteDomain(hostname: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/organization/domains/hostname/${hostname}`,
    );
  }

  /**
   * Verify domain DNS configuration
   */
  verifyDomain(hostname: string): Observable<ApiResponse<VerifyDomainResult>> {
    return this.http.post<ApiResponse<VerifyDomainResult>>(
      `${this.apiUrl}/organization/domains/hostname/${hostname}/verify`,
      { checks: ['cname', 'a', 'txt'] },
    );
  }

  /**
   * Get domains by store
   */
  getDomainsByStore(storeId: number): Observable<ApiResponse<Domain[]>> {
    return this.http.get<ApiResponse<Domain[]>>(
      `${this.apiUrl}/organization/domains/store/${storeId}`,
    );
  }

  /**
   * Validate hostname availability
   */
  validateHostname(
    hostname: string,
  ): Observable<ApiResponse<{ valid: boolean; hostname: string; reason?: string }>> {
    return this.http.post<
      ApiResponse<{ valid: boolean; hostname: string; reason?: string }>
    >(`${this.apiUrl}/organization/domains/validate-hostname`, { hostname });
  }

  /**
   * Domain status options for dropdown
   */
  getDomainStatusOptions(): Array<{ value: DomainStatus; label: string }> {
    return [
      { value: DomainStatus.PENDING_DNS, label: 'Pendiente DNS' },
      { value: DomainStatus.PENDING_SSL, label: 'Pendiente SSL' },
      { value: DomainStatus.ACTIVE, label: 'Activo' },
      { value: DomainStatus.DISABLED, label: 'Deshabilitado' },
    ];
  }

  /**
   * Domain ownership options for dropdown
   */
  getDomainOwnershipOptions(): Array<{ value: DomainOwnership; label: string }> {
    return [
      { value: DomainOwnership.VENDIX_SUBDOMAIN, label: 'Subdominio Vendix' },
      { value: DomainOwnership.CUSTOM_DOMAIN, label: 'Dominio Personalizado' },
      { value: DomainOwnership.CUSTOM_SUBDOMAIN, label: 'Subdominio Personalizado' },
      { value: DomainOwnership.THIRD_PARTY_SUBDOMAIN, label: 'Subdominio Terceros' },
    ];
  }

  /**
   * App type options for dropdown
   * Note: Admin types (VENDIX_ADMIN, ORG_ADMIN, STORE_ADMIN) are system-managed
   * and not available for user configuration. Only public-facing app types are shown.
   */
  getAppTypeOptions(): Array<{ value: AppType; label: string }> {
    return [
      { value: AppType.STORE_ECOMMERCE, label: 'E-commerce' },
      { value: AppType.STORE_LANDING, label: 'Landing de Tienda' },
      { value: AppType.ORG_LANDING, label: 'Landing de Organización' },
    ];
  }
}
