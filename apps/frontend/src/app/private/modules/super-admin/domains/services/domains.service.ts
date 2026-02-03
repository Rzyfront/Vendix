import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap, shareReplay } from 'rxjs/operators';
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

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

let domainsStatsCache: CacheEntry<Observable<ApiResponse<DomainStats>>> | null = null;

@Injectable({
  providedIn: 'root',
})
export class DomainsService {
  private readonly apiUrl = environment.apiUrl;
  private readonly CACHE_TTL = 30000; // 30 segundos

  constructor(private http: HttpClient) { }

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
    const now = Date.now();

    if (domainsStatsCache && (now - domainsStatsCache.lastFetch) < this.CACHE_TTL) {
      return domainsStatsCache.observable;
    }

    const observable$ = this.http
      .get<any>(`${this.apiUrl}/superadmin/domains/dashboard`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((response: any) => {
          if (response.success && response.data) {
            return {
              success: response.success,
              data: response.data as DomainStats,
              message: response.message,
            };
          }
          return response;
        }),
        tap(() => {
          if (domainsStatsCache) {
            domainsStatsCache.lastFetch = Date.now();
          }
        }),
      );

    // Guardar en caché estático
    domainsStatsCache = {
      observable: observable$,
      lastFetch: now,
    };

    return observable$;
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

  /**
   * Invalida el caché de estadísticas
   * Útil después de crear/editar/eliminar dominios
   */
  invalidateCache(): void {
    domainsStatsCache = null;
  }
}
