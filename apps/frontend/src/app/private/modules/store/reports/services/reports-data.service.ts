import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { DateRangeFilter as DateRange } from '../../analytics/interfaces/analytics.interface';
import { ReportDataAdapterService } from './report-data-adapter.service';
import { ReportDefinition, ReportAdaptedData } from '../interfaces/report.interface';

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
  private adapter = inject(ReportDataAdapterService);
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
   * Uses ReportDataAdapterService to normalize and map response keys.
   */
  fetchReportData(
    dataEndpoint: string,
    report: ReportDefinition,
    options?: {
      dateRange?: DateRange;
      fiscalPeriodId?: number | null;
      page?: number;
      limit?: number;
    },
  ): Observable<ReportAdaptedData> {
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

    if (options?.page) {
      params = params.set('page', String(options.page));
    }
    if (options?.limit) {
      params = params.set('limit', String(options.limit));
    }

    const cacheKey = `${report.id}-${dataEndpoint}-${JSON.stringify(options)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<any>(url, { params }).pipe(
        map((response) => this.adapter.adapt(response, report)),
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
