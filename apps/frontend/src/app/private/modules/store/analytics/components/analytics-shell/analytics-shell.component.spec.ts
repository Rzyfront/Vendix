import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, Data } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { AnalyticsShellComponent } from './analytics-shell.component';
import {
  AnalyticsCategoryId,
  getCategoryById,
  getViewsByCategory,
} from '../../config/analytics-registry';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';
import { AnalyticsService } from '../../services/analytics.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

describe('AnalyticsShellComponent', () => {
  let fixture: ComponentFixture<AnalyticsShellComponent>;
  let component: AnalyticsShellComponent;
  let router: Router;
  let navigateSpy: jasmine.Spy;
  let dateRangeSyncSpy: { dateRange: jasmine.Spy };
  let analyticsServiceSpy: jasmine.SpyObj<AnalyticsService>;
  let toastServiceSpy: jasmine.SpyObj<ToastService>;

  const makeRouteStub = (
    categoryId: AnalyticsCategoryId,
  ): { data: Observable<Data>; snapshot: unknown } => ({
    data: new Subject<Data>().asObservable(),
    snapshot: { data: { categoryId } },
  });

  beforeEach(() => {
    dateRangeSyncSpy = { dateRange: jasmine.createSpy('dateRange').and.returnValue(null) };
    analyticsServiceSpy = jasmine.createSpyObj('AnalyticsService', ['invalidateCache']);
    toastServiceSpy = jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']);

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: makeRouteStub('sales') },
        { provide: DateRangeSyncService, useValue: dateRangeSyncSpy },
        { provide: AnalyticsService, useValue: analyticsServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
      ],
    });

    router = TestBed.inject(Router);
    navigateSpy = spyOn(router, 'navigate');
    fixture = TestBed.createComponent(AnalyticsShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('exposes the category from the route data', () => {
    expect(component.category()?.id).toBe('sales');
    expect(component.category()?.label).toBe(getCategoryById('sales')!.label);
  });

// The previous `tabs()` API has been retired; analytics exposes its tabs
// declaratively in the template, not as a public signal on the component.
// The header now owns the primary 'Ver Reportes' action, asserted below.
  it('exposes the category id from the route data', () => {
    expect(component.category()?.id).toBe('sales');
  });

  it('derives sticky-header tabs from the sales registry views', () => {
    const tabs = component.headerTabs();
    expect(tabs.length).toBe(getViewsByCategory('sales').length);
    expect(tabs[0].route).toBe('/admin/analytics/sales/summary');
    expect(tabs.every((tab) => !!tab.route)).toBe(true);
  });

  it('renders the header actions including Actualizar and Ver Reportes', () => {
    const actions = component.headerActions();
    expect(actions.length).toBe(2);
    expect(actions.some((a) => a.id === 'refresh')).toBe(true);
    expect(actions.some((a) => a.id === 'view-reports')).toBe(true);
  });

  it('handles refresh action by invalidating cache and toasting', () => {
    const childMock = { loadData: jasmine.createSpy('loadData') };
    component.onActivate(childMock);
    component.onActionClick('refresh');
    expect(analyticsServiceSpy.invalidateCache).toHaveBeenCalledTimes(1);
    expect(childMock.loadData).toHaveBeenCalledTimes(1);
    expect(toastServiceSpy.success).toHaveBeenCalledWith('Datos de analítica actualizados');
  });

  it('delegates refresh action to child implementing Refreshable contract', () => {
    const refreshableChild = { refresh: jasmine.createSpy('refresh') };
    component.onActivate(refreshableChild);
    component.onActionClick('refresh');
    expect(analyticsServiceSpy.invalidateCache).toHaveBeenCalledTimes(1);
    expect(refreshableChild.refresh).toHaveBeenCalledTimes(1);
  });

  it('navigates to the report route for the current analytics URL', () => {
    spyOnProperty(router, 'url', 'get').and.returnValue('/admin/analytics/sales/by-product');
    component.onActionClick('view-reports');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.calls.mostRecent().args[0]).toEqual(['/admin/reports/sales/sales-by-product']);
  });

  it('falls back to the category-level report route for unmapped URLs', () => {
    spyOnProperty(router, 'url', 'get').and.returnValue('/admin/analytics/sales/some-unmapped');
    component.onActionClick('view-reports');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.calls.mostRecent().args[0]).toEqual(['/admin/reports/sales']);
  });

  it('ignores unknown action ids', () => {
    component.onActionClick('some-other-action');
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

