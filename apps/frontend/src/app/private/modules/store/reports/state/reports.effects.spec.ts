import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Action } from '@ngrx/store';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { Actions } from '@ngrx/effects';
import { Subject, Subscription } from 'rxjs';
import { ReportsEffects } from './reports.effects';
import { ReportsActions } from './reports.actions';
import { reportsReducer } from './reports.reducer';
import { initialReportsState, ReportsState } from './reports.state';
import { selectSelectedReport } from './reports.selectors';
import { getReportById } from '../config/report-registry';
import { ReportsDataService } from '../services/reports-data.service';
import { ReportExportService } from '../services/report-export.service';
import { ReportAdaptedData } from '../interfaces/report.interface';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

describe('ReportsEffects snapshot filters and cancellation', () => {
  let effects: ReportsEffects;
  let store: MockStore;
  let actions: Subject<Action>;
  let state: ReportsState;
  let data: jasmine.SpyObj<Pick<ReportsDataService, 'fetchReportData' | 'exportFromBackend' | 'clearCache'>>;
  let exporter: jasmine.SpyObj<ReportExportService>;
  let toast: jasmine.SpyObj<Pick<ToastService, 'success' | 'error'>>;
  let subscriptions: Subscription;
  let loads: Subject<ReportAdaptedData>[];
  let exports: Subject<Blob>[];
  const range = { start_date: '2026-07-01', end_date: '2026-07-31', preset: 'custom' as const };

  beforeEach(() => {
    actions = new Subject<Action>();
    subscriptions = new Subscription();
    loads = [];
    exports = [];
    state = { ...initialReportsState, selectedReportId: 'inventory-low-stock', dateRange: range, currentPage: 2, itemsPerPage: 5, dataFilters: { category_id: '7', order: 'desc' }, dataFiltersByReport: {} };
    data = jasmine.createSpyObj('ReportsDataService', ['fetchReportData', 'exportFromBackend', 'clearCache']);
    data.fetchReportData.and.callFake(() => { const request = new Subject<ReportAdaptedData>(); loads.push(request); return request; });
    data.exportFromBackend.and.callFake(() => { const request = new Subject<Blob>(); exports.push(request); return request; });
    exporter = jasmine.createSpyObj('ReportExportService', ['downloadBlob']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(), provideMockStore({ initialState: { reports: state } }), ReportsEffects,
      { provide: Actions, useValue: new Actions(actions) },
      { provide: ReportsDataService, useValue: data },
      { provide: ReportExportService, useValue: exporter },
      { provide: ToastService, useValue: toast },
    ] });
    store = TestBed.inject(MockStore);
    effects = TestBed.inject(ReportsEffects);
  });

  afterEach(() => {
    try { subscriptions.unsubscribe(); actions.complete(); store.resetSelectors(); }
    finally { TestBed.resetTestingModule(); }
  });

  function send(action: Action): void {
    state = reportsReducer(state, action);
    store.setState({ reports: state });
    actions.next(action);
  }

  it('declares current low-stock snapshot without a date selector contract', () => {
    const report = getReportById('inventory-low-stock')!;
    expect(report.requiresDateRange).toBeFalse();
    expect(report.exportEndpoint).toBe('store/analytics/inventory/low-stock/export');
    expect(report.dataFilters?.map(filter => filter.key)).toEqual(['order', 'category_id']);
  });

  it('uses identical translated category/order for load and complete export, without snapshot dates', () => {
    subscriptions.add(effects.loadReportData$.subscribe());
    subscriptions.add(effects.exportReport$.subscribe());
    send(ReportsActions.loadReportData());
    send(ReportsActions.exportReport());
    const options = data.fetchReportData.calls.mostRecent().args[2]!;
    expect(options.extraParams).toEqual({ category_id: '7', sort_by: 'name', sort_direction: 'desc' });
    expect(options.dateRange).toBeUndefined();
    expect(options.page).toBe(2);
    expect(options.limit).toBe(5);
    expect(data.exportFromBackend).toHaveBeenCalledWith('store/analytics/inventory/low-stock/export', undefined, options.extraParams);
    expect(options.extraParams?.['page']).toBeUndefined();
    expect(options.extraParams?.['limit']).toBeUndefined();
  });

  it('sends dates for a temporal report on both load and export', () => {
    state = { ...state, selectedReportId: 'sales-summary' };
    store.setState({ reports: state });
    subscriptions.add(effects.loadReportData$.subscribe());
    subscriptions.add(effects.exportReport$.subscribe());
    send(ReportsActions.loadReportData()); send(ReportsActions.exportReport());
    expect(data.fetchReportData.calls.mostRecent().args[2]?.dateRange).toEqual(range);
    expect(data.exportFromBackend.calls.mostRecent().args[1]).toEqual(range);
  });

  it('does not leak reserved paging/date params through data filters', () => {
    state = { ...state, dataFilters: { category_id: '7', order: 'asc', page: '9', limit: '1', date_from: '1900-01-01', date_to: '1900-01-02' } };
    store.setState({ reports: state });
    subscriptions.add(effects.exportReport$.subscribe());
    send(ReportsActions.exportReport());
    expect(data.exportFromBackend.calls.mostRecent().args[2]).toEqual({ category_id: '7', sort_by: 'name', sort_direction: 'asc' });
  });

  it('uses cleared filters for both requests without adding a second reload owner', () => {
    const reloads: Action[] = [];
    subscriptions.add(effects.reloadOnFilterChange$.subscribe(action => reloads.push(action)));
    subscriptions.add(effects.loadReportData$.subscribe()); subscriptions.add(effects.exportReport$.subscribe());
    send(ReportsActions.setDataFilters({ filters: { category_id: null, order: null } }));
    expect(reloads).toEqual([]); // GenericReportPage owns the following explicit load.
    send(ReportsActions.loadReportData()); send(ReportsActions.exportReport());
    expect(data.fetchReportData.calls.mostRecent().args[2]?.extraParams).toEqual({});
    expect(data.fetchReportData.calls.mostRecent().args[2]?.page).toBe(1);
    expect(data.exportFromBackend.calls.mostRecent().args[2]).toEqual({});
  });

  it('restores saved filters via the real reducer when returning to a report', () => {
    subscriptions.add(effects.exportReport$.subscribe());
    send(ReportsActions.setDataFilters({ filters: { category_id: '7', order: 'desc' } }));
    send(ReportsActions.selectReport({ reportId: 'sales-summary' }));
    send(ReportsActions.setDataFilters({ filters: { order: 'asc' } }));
    send(ReportsActions.selectReport({ reportId: 'inventory-low-stock' }));
    send(ReportsActions.exportReport());
    expect(data.exportFromBackend.calls.mostRecent().args[2]).toEqual({ category_id: '7', sort_by: 'name', sort_direction: 'desc' });
  });

  it('cancels an earlier load and never dispatches its stale success/error', () => {
    const results: Action[] = [];
    subscriptions.add(effects.loadReportData$.subscribe(action => results.push(action)));
    send(ReportsActions.loadReportData());
    send(ReportsActions.setDataFilters({ filters: { category_id: '2', order: 'asc' } }));
    send(ReportsActions.loadReportData());
    expect(loads[0].observed).toBeFalse();
    loads[0].next({ data: [{ id: 'stale' }] }); loads[0].error(new Error('stale'));
    expect(results).toEqual([]);
    loads[1].next({ data: [{ id: 'current' }] });
    expect(results).toEqual([ReportsActions.loadReportDataSuccess({ data: [{ id: 'current' }], meta: undefined, isSummary: undefined, summaryData: undefined })]);
  });

  it('keeps one active load through a burst of filter changes', () => {
    subscriptions.add(effects.loadReportData$.subscribe());
    for (let id = 1; id <= 20; id++) {
      send(ReportsActions.setDataFilters({ filters: { category_id: String(id) } }));
      send(ReportsActions.loadReportData());
    }
    expect(loads.filter(request => request.observed).length).toBe(1);
    expect(data.fetchReportData.calls.mostRecent().args[2]?.extraParams).toEqual({ category_id: '20' });
  });

  it('cancels an older export on a repeated click and downloads only the latest', () => {
    const results: Action[] = [];
    subscriptions.add(effects.exportReport$.subscribe(action => results.push(action)));
    send(ReportsActions.exportReport());
    send(ReportsActions.setDataFilters({ filters: { category_id: '2' } }));
    send(ReportsActions.exportReport());
    expect(exports[0].observed).toBeFalse();
    exports[0].next(new Blob(['old']));
    expect(exporter.downloadBlob).not.toHaveBeenCalled();
    const blob = new Blob(['new']); exports[1].next(blob);
    expect(exporter.downloadBlob).toHaveBeenCalledOnceWith(blob, 'stock_bajo');
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(results).toEqual([ReportsActions.exportReportSuccess()]);
  });

  it('reports export failure with no download or success toast', () => {
    const results: Action[] = [];
    subscriptions.add(effects.exportReport$.subscribe(action => results.push(action)));
    send(ReportsActions.exportReport()); exports[0].error({ error: { message: 'export failed' } });
    expect(results).toEqual([ReportsActions.exportReportFailure({ error: 'export failed' })]);
    expect(exporter.downloadBlob).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });

  it('reports forbidden load separately without inventing successful data', () => {
    const results: Action[] = [];
    subscriptions.add(effects.loadReportData$.subscribe(action => results.push(action)));
    send(ReportsActions.loadReportData()); loads[0].error({ status: 403 });
    expect(results).toEqual([ReportsActions.loadReportDataFailure({ error: 'Sin permisos para ver este reporte', isForbidden: true })]);
  });

  it('rejects export without a configured endpoint', () => {
    store.overrideSelector(selectSelectedReport, { ...getReportById('inventory-low-stock')!, exportEndpoint: undefined });
    store.refreshState();
    const results: Action[] = [];
    subscriptions.add(effects.exportReport$.subscribe(action => results.push(action)));
    send(ReportsActions.exportReport());
    expect(results).toEqual([ReportsActions.exportReportFailure({ error: 'Este reporte no admite exportación' })]);
    expect(data.exportFromBackend).not.toHaveBeenCalled();
  });

  it('skips loading when no report is selected', () => {
    state = { ...state, selectedReportId: null }; store.setState({ reports: state });
    subscriptions.add(effects.loadReportData$.subscribe()); send(ReportsActions.loadReportData());
    expect(data.fetchReportData).not.toHaveBeenCalled();
  });

  it('releases pending work when effect subscriptions are disposed', () => {
    subscriptions.add(effects.loadReportData$.subscribe()); subscriptions.add(effects.exportReport$.subscribe());
    send(ReportsActions.loadReportData()); send(ReportsActions.exportReport());
    subscriptions.unsubscribe();
    expect(loads[0].observed).toBeFalse(); expect(exports[0].observed).toBeFalse();
  });
});
