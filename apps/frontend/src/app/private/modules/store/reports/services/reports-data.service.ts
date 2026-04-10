import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { DateRangeFilter as DateRange } from '../../analytics/interfaces/analytics.interface';

interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

const reportsCache = new Map<string, CacheEntry<Observable<any>>>();

@Injectable({
  providedIn: 'root',
})
export class ReportsDataService {
  private http = inject(HttpClient);
  private readonly CACHE_TTL = 60000;

  private withCache<T>(key: string, factory: () => Observable<T>): Observable<T> {
    const now = Date.now();
    const cached = reportsCache.get(key);
    if (cached && now - cached.lastFetch < this.CACHE_TTL) {
      return cached.observable as Observable<T>;
    }
    const obs$ = factory().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    reportsCache.set(key, { observable: obs$, lastFetch: now });
    return obs$;
  }

  /**
   * Fetch report data from any endpoint defined in the registry.
   * Handles both analytics-style (ApiResponse wrapper) and direct responses.
   */
  fetchReportData(
    dataEndpoint: string,
    options?: {
      dateRange?: DateRange;
      fiscalPeriodId?: number | null;
    },
  ): Observable<{ data: any[]; meta?: Record<string, any> }> {
    const url = `${environment.apiUrl}/${dataEndpoint}`;
    let params = new HttpParams();

    if (options?.dateRange) {
      if (options.dateRange.start_date) {
        params = params.set('date_from', options.dateRange.start_date);
      }
      if (options.dateRange.end_date) {
        params = params.set('date_to', options.dateRange.end_date);
      }
    }

    if (options?.fiscalPeriodId) {
      params = params.set('fiscal_period_id', String(options.fiscalPeriodId));
    }

    const cacheKey = `${dataEndpoint}-${JSON.stringify(options)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<any>(url, { params }).pipe(
        map((response) => {
          // Handle both { data: [...] } wrapper and direct array responses
          if (response?.data && Array.isArray(response.data)) {
            const { data, ...meta } = response;
            return { data, meta };
          }
          if (Array.isArray(response)) {
            return { data: response };
          }
          // Single object response — wrap in array
          if (response?.data && !Array.isArray(response.data)) {
            return { data: [response.data], meta: response };
          }
          return { data: [], meta: response };
        }),
      ),
    );
  }

  /**
   * Download export blob from backend.
   */
  exportFromBackend(exportEndpoint: string, dateRange?: DateRange): Observable<Blob> {
    const url = `${environment.apiUrl}/${exportEndpoint}`;
    let params = new HttpParams();

    if (dateRange) {
      if (dateRange.start_date) {
        params = params.set('date_from', dateRange.start_date);
      }
      if (dateRange.end_date) {
        params = params.set('date_to', dateRange.end_date);
      }
    }

    return this.http.get(url, { params, responseType: 'blob' });
  }
}
