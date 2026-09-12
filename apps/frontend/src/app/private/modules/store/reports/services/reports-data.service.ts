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
const lastRangePerReport = new Map<string, string>();

@Injectable({
  providedIn: 'root',
})
export class ReportsDataService {
  private http = inject(HttpClient);
  /**
   * Global cache TTL for report datasets (30 seconds).
   *
   * Architectural Rationale & Impact Analysis:
   * - Previously set to 5 minutes (300,000 ms), which caused significant UX friction:
   *   operational mutations (e.g., registering an expense, completing a sale, paying an advance)
   *   were not reflected in reports unless the operator performed a hard page reload (F5).
   * - 30 seconds provides the optimal trade-off:
   *   1. Smooth pagination: rapid navigation between pages (1 -> 2 -> 3 -> 1) remains instant
   *      and memory-cached without re-querying the backend.
   *   2. Freshness: natural navigation between modules guarantees fresh data within 30s.
   *   3. Complementary invalidation: `clearCache()` is actively called by `ReportsEffects` on
   *      report selection/filter change, by `ExpensesEffects` on any expense mutation, and by
   *      the "Actualizar" sticky-header action for immediate on-demand synchronization.
   *   4. Memory safety: expired entries are automatically pruned on each fetch cycle below.
   */
  private readonly CACHE_TTL = 30_000;

  private withCache<T>(key: string, factory: () => Observable<T>): Observable<T> {
    const now = Date.now();

    for (const [k, v] of reportsCache.entries()) {
      if (now - v.lastFetch >= this.CACHE_TTL) {
        reportsCache.delete(k);
      }
    }

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

    // Invalidate previous cache entries for this report ONLY when the date range or fiscal period changes.
    // Preserves cached pages during pagination and tab returns (QUI-544).
    const rangeSignature = JSON.stringify({
      dateRange: options?.dateRange,
      fiscalPeriodId: options?.fiscalPeriodId,
    });
    const lastRange = lastRangePerReport.get(report.id);
    if (lastRange && lastRange !== rangeSignature) {
      const reportPrefix = `${report.id}-`;
      for (const key of reportsCache.keys()) {
        if (key.startsWith(reportPrefix)) {
          reportsCache.delete(key);
        }
      }
    }
    lastRangePerReport.set(report.id, rangeSignature);

    const cacheKey = `${report.id}-${dataEndpoint}-${JSON.stringify(options)}`;
    return this.withCache(cacheKey, () =>
      this.http.get<any>(url, { params }).pipe(
        map((response) => this.adapter.adapt(response, report)),
      ),
    );
  }

  /**
   * Clears report cache entries. If reportId is provided, clears only entries for that report.
   */
  clearCache(reportId?: string): void {
    if (reportId) {
      const reportPrefix = `${reportId}-`;
      for (const key of reportsCache.keys()) {
        if (key.startsWith(reportPrefix)) {
          reportsCache.delete(key);
        }
      }
      lastRangePerReport.delete(reportId);
    } else {
      reportsCache.clear();
      lastRangePerReport.clear();
    }
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
