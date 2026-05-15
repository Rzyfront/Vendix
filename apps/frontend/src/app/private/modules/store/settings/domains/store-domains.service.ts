import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import { toObservable } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../environments/environment';
import {
  StoreDomain,
  CreateStoreDomainDto,
  UpdateStoreDomainDto,
  StoreDomainQueryDto,
  CreateDomainRootAssignmentDto,
  CreateDomainRootDto,
  DomainRootResponse,
  DomainRootsResponse,
  PaginatedDomainsResponse,
  SingleDomainResponse,
  DnsInstructionsResponse,
  VerifyDomainResponse,
} from './domain.interface';

@Injectable({
  providedIn: 'root',
})
export class StoreDomainsService {
  private readonly api_url = environment.apiUrl;

  // Signals — Angular 20 Zoneless
  readonly domains = signal<StoreDomain[]>([]);
  readonly domains$ = toObservable(this.domains);

  readonly loading = signal(false);
  readonly loading$ = toObservable(this.loading);
  readonly is_loading$ = this.loading$; // Alias para compatibilidad

  constructor(private http: HttpClient) {}

  /**
   * Get all domains for the current store with pagination
   */
  getDomains(
    query?: StoreDomainQueryDto,
    options?: { silent?: boolean },
  ): Observable<PaginatedDomainsResponse> {
    if (!options?.silent) {
      this.loading.set(true);
    }

    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.domain_type)
      params = params.set('domain_type', query.domain_type);
    if (query?.app_type) params = params.set('app_type', query.app_type);
    if (query?.status) params = params.set('status', query.status);

    return this.http
      .get<PaginatedDomainsResponse>(`${this.api_url}/store/domains`, {
        params,
      })
      .pipe(
        tap((response) => {
          if (response.success && response.data) {
            this.domains.set(response.data);
          }
        }),
        finalize(() => {
          if (!options?.silent) {
            this.loading.set(false);
          }
        }),
      );
  }

  /**
   * Get a single domain by ID
   */
  getDomainById(id: number): Observable<SingleDomainResponse> {
    return this.http.get<SingleDomainResponse>(
      `${this.api_url}/store/domains/${id}`,
    );
  }

  /**
   * Create a new domain
   */
  createDomain(dto: CreateStoreDomainDto): Observable<SingleDomainResponse> {
    return this.http.post<SingleDomainResponse>(
      `${this.api_url}/store/domains`,
      dto,
    );
  }

  createRoot(dto: CreateDomainRootDto): Observable<DomainRootResponse> {
    return this.http.post<DomainRootResponse>(
      `${this.api_url}/store/domains/roots`,
      dto,
    );
  }

  getRoots(): Observable<DomainRootsResponse> {
    return this.http.get<DomainRootsResponse>(
      `${this.api_url}/store/domains/roots`,
    );
  }

  getRoot(id: number): Observable<DomainRootResponse> {
    return this.http.get<DomainRootResponse>(
      `${this.api_url}/store/domains/roots/${id}`,
    );
  }

  getRootDnsInstructions(id: number): Observable<DnsInstructionsResponse> {
    return this.http.get<DnsInstructionsResponse>(
      `${this.api_url}/store/domains/roots/${id}/dns-instructions`,
    );
  }

  verifyRoot(id: number): Observable<VerifyDomainResponse> {
    return this.http.post<VerifyDomainResponse>(
      `${this.api_url}/store/domains/roots/${id}/verify`,
      {},
    );
  }

  provisionRootNext(id: number): Observable<DomainRootResponse> {
    return this.http.post<DomainRootResponse>(
      `${this.api_url}/store/domains/roots/${id}/provision-next`,
      {},
    );
  }

  createRootAssignment(
    id: number,
    dto: CreateDomainRootAssignmentDto,
  ): Observable<SingleDomainResponse> {
    return this.http.post<SingleDomainResponse>(
      `${this.api_url}/store/domains/roots/${id}/assignments`,
      dto,
    );
  }

  /**
   * Update an existing domain
   */
  updateDomain(
    id: number,
    dto: UpdateStoreDomainDto,
  ): Observable<SingleDomainResponse> {
    return this.http.patch<SingleDomainResponse>(
      `${this.api_url}/store/domains/${id}`,
      dto,
    );
  }

  /**
   * Delete a domain
   */
  deleteDomain(id: number): Observable<any> {
    return this.http.delete(`${this.api_url}/store/domains/${id}`);
  }

  /**
   * Set a domain as primary
   */
  setAsPrimary(id: number): Observable<SingleDomainResponse> {
    return this.http.post<SingleDomainResponse>(
      `${this.api_url}/store/domains/${id}/set-primary`,
      {},
    );
  }

  getDnsInstructions(id: number): Observable<DnsInstructionsResponse> {
    return this.http.get<DnsInstructionsResponse>(
      `${this.api_url}/store/domains/${id}/dns-instructions`,
    );
  }

  verifyDomain(id: number): Observable<VerifyDomainResponse> {
    return this.http.post<VerifyDomainResponse>(
      `${this.api_url}/store/domains/${id}/verify`,
      {},
    );
  }

  provisionNext(id: number): Observable<SingleDomainResponse> {
    return this.http.post<SingleDomainResponse>(
      `${this.api_url}/store/domains/${id}/provision-next`,
      {},
    );
  }
}
