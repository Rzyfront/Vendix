import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReportsDataService } from './reports-data.service';
import { ReportDataAdapterService } from './report-data-adapter.service';
import { getReportById } from '../config/report-registry';
import { environment } from '../../../../../../environments/environment';
import { ReportAdaptedData, ReportDefinition } from '../interfaces/report.interface';

describe('ReportsDataService real HTTP filters and complete exports', () => {
  let service: ReportsDataService;
  let http: HttpTestingController;
  let report: ReportDefinition;
  const dates = { start_date: '2026-07-01', end_date: '2026-07-31' };
  const filters = { category_id: '7', sort_by: 'name', sort_direction: 'desc' };

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date('2026-07-08T15:00:00Z'));
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
      ReportsDataService, ReportDataAdapterService,
    ] });
    service = TestBed.inject(ReportsDataService);
    service.clearCache();
    http = TestBed.inject(HttpTestingController);
    report = getReportById('inventory-low-stock')!;
  });

  afterEach(() => {
    try { http.verify(); }
    finally {
      service.clearCache();
      try { TestBed.resetTestingModule(); }
      finally { jasmine.clock().uninstall(); }
    }
  });

  const at = (endpoint: string) => (request: HttpRequest<unknown>) => request.url === `${environment.apiUrl}/${endpoint}`;

  it('fetches the current snapshot with category/order/page but no dates even if a caller supplies them', () => {
    service.fetchReportData(report.dataEndpoint, report, { dateRange: dates, page: 2, limit: 5, extraParams: filters }).subscribe();
    const request = http.expectOne(at(report.dataEndpoint));
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('category_id')).toBe('7');
    expect(request.request.params.get('sort_by')).toBe('name');
    expect(request.request.params.get('sort_direction')).toBe('desc');
    expect(request.request.params.get('page')).toBe('2');
    expect(request.request.params.get('limit')).toBe('5');
    expect(request.request.params.has('date_from')).toBeFalse();
    expect(request.request.params.has('date_to')).toBeFalse();
    request.flush({ data: [] });
  });

  it('exports a blob with identical filters and no page/limit/date injection through extraParams', () => {
    let result: Blob | undefined;
    const blob = new Blob(['xlsx-bytes']);
    service.exportFromBackend(report.exportEndpoint!, undefined, { ...filters, page: '20', limit: '1', date_from: '1900-01-01', date_to: '1900-01-02' }).subscribe(value => result = value);
    const request = http.expectOne(at(report.exportEndpoint!));
    expect(request.request.responseType).toBe('blob');
    expect(request.request.params.keys().sort()).toEqual(['category_id', 'sort_by', 'sort_direction']);
    expect(request.request.params.get('category_id')).toBe('7');
    expect(request.request.params.get('sort_direction')).toBe('desc');
    request.flush(blob);
    expect(result).toBe(blob);
  });

  it('includes dates on fetch/export for reports that require a temporal window', () => {
    const temporal = getReportById('sales-summary')!;
    service.fetchReportData(temporal.dataEndpoint, temporal, { dateRange: dates }).subscribe();
    service.exportFromBackend(temporal.exportEndpoint!, dates, filters).subscribe();
    const fetch = http.expectOne(at(temporal.dataEndpoint));
    const exported = http.expectOne(at(temporal.exportEndpoint!));
    for (const request of [fetch, exported]) {
      expect(request.request.params.get('date_from')).toBe(dates.start_date);
      expect(request.request.params.get('date_to')).toBe(dates.end_date);
    }
    fetch.flush({ data: [] }); exported.flush(new Blob(['bytes']));
  });

  it('absorbs complete backend totals instead of summing the visible page', () => {
    let result: ReportAdaptedData | undefined;
    service.fetchReportData(report.dataEndpoint, report, { page: 2, limit: 1 }).subscribe(value => result = value);
    http.expectOne(at(report.dataEndpoint)).flush({
      success: true, data: [{ product_id: 2, stock_quantity: 3, stock_value_at_risk: 60 }],
      meta: { total: 2, page: 2, limit: 1, totals: { stock_quantity: 5, stock_value_at_risk: 80 } },
    });
    expect(result?.data.length).toBe(1);
    expect(result?.summaryData?.['stock_quantity']).toBe(5);
    expect(result?.summaryData?.['stock_value_at_risk']).toBe(80);
  });

  it('keeps completed pages cached but uses distinct cache entries for filter changes', () => {
    const fetch = (category: string) => service.fetchReportData(report.dataEndpoint, report, { page: 1, limit: 5, extraParams: { category_id: category } });
    fetch('2').subscribe(); http.expectOne(at(report.dataEndpoint)).flush({ data: [{ product_id: 1 }] });
    fetch('7').subscribe(); const changed = http.expectOne(at(report.dataEndpoint));
    expect(changed.request.params.get('category_id')).toBe('7'); changed.flush({ data: [{ product_id: 2 }] });
    fetch('2').subscribe(); http.expectNone(at(report.dataEndpoint));
  });

  it('clears per-report cache and re-fetches after an explicit refresh', () => {
    service.fetchReportData(report.dataEndpoint, report).subscribe();
    http.expectOne(at(report.dataEndpoint)).flush({ data: [] });
    service.clearCache(report.id);
    service.fetchReportData(report.dataEndpoint, report).subscribe();
    http.expectOne(at(report.dataEndpoint)).flush({ data: [] });
  });

  it('does not reuse a completed query from another report ID', () => {
    service.fetchReportData(report.dataEndpoint, report).subscribe();
    http.expectOne(at(report.dataEndpoint)).flush({ data: [{ product_id: 1 }] });
    const otherReport = { ...report, id: 'another-low-stock-report' };
    service.fetchReportData(report.dataEndpoint, otherReport).subscribe();
    http.expectOne(at(report.dataEndpoint)).flush({ data: [{ product_id: 2 }] });
    service.fetchReportData(report.dataEndpoint, report).subscribe();
    http.expectNone(at(report.dataEndpoint));
  });

  it('expires cached snapshot data at the established 30s TTL', () => {
    service.fetchReportData(report.dataEndpoint, report).subscribe();
    http.expectOne(at(report.dataEndpoint)).flush({ data: [] });
    jasmine.clock().tick(30_000);
    service.fetchReportData(report.dataEndpoint, report).subscribe();
    http.expectOne(at(report.dataEndpoint)).flush({ data: [] });
  });

  it('cancels pending cached HTTP when unsubscribed, then can restart that request', () => {
    const observable = service.fetchReportData(report.dataEndpoint, report, { extraParams: filters });
    const subscription = observable.subscribe();
    const first = http.expectOne(at(report.dataEndpoint));
    subscription.unsubscribe();
    expect(first.cancelled).toBeTrue();
    observable.subscribe();
    const restarted = http.expectOne(at(report.dataEndpoint));
    expect(restarted.request.params.get('category_id')).toBe('7');
    restarted.flush({ data: [] });
  });

  it('propagates export HTTP failure instead of returning a successful empty blob', () => {
    let errorStatus: number | undefined;
    let successes = 0;
    service.exportFromBackend(report.exportEndpoint!, undefined, filters).subscribe({ next: () => successes++, error: error => errorStatus = error.status });
    http.expectOne(at(report.exportEndpoint!)).flush(new Blob(['unavailable']), { status: 503, statusText: 'Unavailable' });
    expect(successes).toBe(0); expect(errorStatus).toBe(503);
  });

  it('cancels an export HTTP subscription without retaining cached blob work', () => {
    const subscription = service.exportFromBackend(report.exportEndpoint!, undefined, filters).subscribe();
    const request = http.expectOne(at(report.exportEndpoint!));
    subscription.unsubscribe(); expect(request.cancelled).toBeTrue();
  });

  it('omits empty filters and protects explicit pagination from extraParams', () => {
    service.fetchReportData(report.dataEndpoint, report, { page: 2, limit: 5, extraParams: { category_id: '', page: '99', limit: '1' } }).subscribe();
    const request = http.expectOne(at(report.dataEndpoint));
    expect(request.request.params.has('category_id')).toBeFalse();
    expect(request.request.params.get('page')).toBe('2'); expect(request.request.params.get('limit')).toBe('5');
    request.flush({ data: [] });
  });
});
