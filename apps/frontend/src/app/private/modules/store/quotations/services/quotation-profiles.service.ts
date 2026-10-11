import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay, tap, throwError, catchError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { QuotationProfileCatalogEntry } from '../interfaces/quotation.interface';
import {
  PaginatedQuotationProfilesResponse,
  QuotationProfile,
  QuotationProfileQuery,
  QuotationProfileVersionPage,
  SaveQuotationProfileDto,
} from '../interfaces/quotation-profile.interface';

interface ApiEnvelope<T> { data?: T; meta?: { total?: number; page?: number; limit?: number }; }

@Injectable({ providedIn: 'root' })
export class QuotationProfilesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthFacade);
  private readonly apiUrl = `${environment.apiUrl}/store/quotation-profiles`;
  private readonly cacheTtlMs = 30_000;
  private catalogCache: { storeId: number | null; requestedAt: number; value$: Observable<QuotationProfileCatalogEntry[]> } | null = null;

  getCatalog(): Observable<QuotationProfileCatalogEntry[]> {
    const storeId = this.auth.userStore()?.id ?? null;
    const now = Date.now();
    const cache = this.catalogCache;
    if (storeId !== null && cache && cache.storeId === storeId && now - cache.requestedAt < this.cacheTtlMs) {
      return cache.value$;
    }
    const value$ = this.http.get<QuotationProfileCatalogEntry[] | ApiEnvelope<QuotationProfileCatalogEntry[]>>(`${this.apiUrl}/catalog`).pipe(
      map((response) => Array.isArray(response) ? response : response.data ?? []),
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error) => {
        if (this.catalogCache?.value$ === value$) this.catalogCache = null;
        return throwError(() => new Error(extractApiErrorMessage(error)));
      }),
    );
    this.catalogCache = storeId === null ? null : { storeId, requestedAt: now, value$ };
    return value$;
  }

  getProfile(id: number): Observable<QuotationProfile> {
    return this.http.get<QuotationProfile | ApiEnvelope<QuotationProfile>>(`${this.apiUrl}/${id}`).pipe(
      map((response) => unwrap<QuotationProfile>(response)),
      catchError((error) => throwError(() => new Error(extractApiErrorMessage(error)))),
    );
  }

  getProfiles(query: QuotationProfileQuery = {}): Observable<PaginatedQuotationProfilesResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    const suffix = params.toString();
    return this.http.get<PaginatedProfilesEnvelope>(`${this.apiUrl}${suffix ? `?${suffix}` : ''}`).pipe(
      map((response) => {
        const payload = response.data;
        const nested = Array.isArray(payload) ? null : payload;
        const meta = response.meta ?? {};
        // The real envelope is { data: rows, meta: { total, page, limit } };
        // accept the legacy nested pagination shape if an interceptor wraps it.
        return {
          data: Array.isArray(payload) ? payload : nested?.data ?? [],
          total: nested?.total ?? meta.total ?? nested?.pagination?.total ?? 0,
          page: nested?.page ?? meta.page ?? nested?.pagination?.page ?? query.page ?? 1,
          limit: nested?.limit ?? meta.limit ?? nested?.pagination?.limit ?? query.limit ?? 20,
        };
      }),
      catchError((error) => throwError(() => new Error(extractApiErrorMessage(error)))),
    );
  }

  getVersions(id: number, page = 1, limit = 20): Observable<QuotationProfileVersionPage> {
    return this.http.get<PaginatedVersionsEnvelope>(`${this.apiUrl}/${id}/versions`, { params: { page, limit } }).pipe(
      map((response) => {
        const payload = response.data;
        const nested = Array.isArray(payload) ? null : payload;
        const meta = response.meta ?? {};
        return {
          data: Array.isArray(payload) ? payload : nested?.data ?? [],
          total: nested?.total ?? meta.total ?? 0,
          page: nested?.page ?? meta.page ?? page,
          limit: nested?.limit ?? meta.limit ?? limit,
        };
      }),
      catchError((error) => throwError(() => new Error(extractApiErrorMessage(error)))),
    );
  }

  create(dto: SaveQuotationProfileDto): Observable<QuotationProfile> {
    return this.mutate<QuotationProfile>(this.http.post<ApiEnvelope<QuotationProfile> | QuotationProfile>(this.apiUrl, dto));
  }

  update(id: number, dto: SaveQuotationProfileDto): Observable<QuotationProfile> {
    return this.mutate<QuotationProfile>(this.http.patch<ApiEnvelope<QuotationProfile> | QuotationProfile>(`${this.apiUrl}/${id}`, dto));
  }

  clone(id: number, name: string): Observable<QuotationProfile> {
    return this.mutate<QuotationProfile>(this.http.post<ApiEnvelope<QuotationProfile> | QuotationProfile>(`${this.apiUrl}/${id}/clone`, { name }));
  }

  setDefault(id: number): Observable<unknown> {
    return this.mutate<unknown>(this.http.post<ApiEnvelope<unknown> | unknown>(`${this.apiUrl}/${id}/set-default`, {}));
  }

  setActive(id: number, active: boolean): Observable<unknown> {
    return this.mutate<unknown>(this.http.post<ApiEnvelope<unknown> | unknown>(`${this.apiUrl}/${id}/${active ? 'activate' : 'deactivate'}`, {}));
  }

  remove(id: number): Observable<unknown> {
    return this.mutate<unknown>(this.http.delete<ApiEnvelope<unknown> | unknown>(`${this.apiUrl}/${id}`));
  }

  invalidateCache(): void {
    this.catalogCache = null;
  }

  private mutate<T>(request: Observable<ApiEnvelope<T> | T>): Observable<T> {
    return request.pipe(
      map((response) => unwrap<T>(response)),
      tap(() => this.invalidateCache()),
      catchError((error) => throwError(() => new Error(extractApiErrorMessage(error)))),
    );
  }
}

interface PaginatedProfilesEnvelope {
  data: QuotationProfile[] | { data?: QuotationProfile[]; total?: number; page?: number; limit?: number; pagination?: { total?: number; page?: number; limit?: number } };
  meta?: { total?: number; page?: number; limit?: number };
}

interface PaginatedVersionsEnvelope {
  data: QuotationProfileVersionPage['data'] | { data?: QuotationProfileVersionPage['data']; total?: number; page?: number; limit?: number };
  meta?: { total?: number; page?: number; limit?: number };
}

function unwrap<T>(response: T | ApiEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as ApiEnvelope<T>).data as T;
  }
  return response as T;
}
