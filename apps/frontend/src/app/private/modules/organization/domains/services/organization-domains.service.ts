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
  DnsInstructions,
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
      { value: DomainStatus.PENDING_OWNERSHIP, label: 'Pendiente propiedad' },
      { value: DomainStatus.VERIFYING_OWNERSHIP, label: 'Verificando propiedad' },
      { value: DomainStatus.PENDING_SSL, label: 'Pendiente SSL' },
      { value: DomainStatus.PENDING_CERTIFICATE, label: 'Pendiente certificado' },
      { value: DomainStatus.ISSUING_CERTIFICATE, label: 'Emitiendo certificado' },
      { value: DomainStatus.PENDING_ALIAS, label: 'Pendiente alias' },
      { value: DomainStatus.PROPAGATING, label: 'Propagando' },
      { value: DomainStatus.FAILED_OWNERSHIP, label: 'Falló propiedad' },
      { value: DomainStatus.FAILED_CERTIFICATE, label: 'Falló certificado' },
      { value: DomainStatus.FAILED_ALIAS, label: 'Falló alias' },
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
   * Domain app type is the runtime router target for custom domains.
   */
  getAppTypeOptions(): Array<{ value: AppType; label: string }> {
    return [
      { value: AppType.STORE_ECOMMERCE, label: 'E-commerce' },
      { value: AppType.STORE_LANDING, label: 'Landing de Tienda' },
      { value: AppType.STORE_ADMIN, label: 'Admin de Tienda' },
      { value: AppType.ORG_LANDING, label: 'Landing de Organización' },
      { value: AppType.ORG_ADMIN, label: 'Admin de Organización' },
    ];
  }

  /**
   * Renew SSL certificate for a domain
   */
  renewSsl(domainId: number): Observable<ApiResponse<{ renewed: boolean; ssl_status: string; message: string }>> {
    return this.http.post<ApiResponse<{ renewed: boolean; ssl_status: string; message: string }>>(
      `${this.apiUrl}/organization/domains/${domainId}/ssl-renew`,
      {},
    );
  }

  provisionNext(domainId: number): Observable<ApiResponse<Domain>> {
    return this.http.post<ApiResponse<Domain>>(
      `${this.apiUrl}/organization/domains/${domainId}/provision-next`,
      {},
    );
  }

  /**
   * Get DNS instructions for a domain
   */
  getDnsInstructions(hostname: string): Observable<ApiResponse<DnsInstructions>> {
    return this.http.get<ApiResponse<DnsInstructions>>(
      `${this.apiUrl}/organization/domains/dns-instructions/${hostname}`,
    );
  }
}
