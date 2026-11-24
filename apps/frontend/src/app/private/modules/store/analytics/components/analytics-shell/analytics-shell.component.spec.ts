import { signal } from '@angular/core';
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
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

// Agenda unificada F4: las pestañas se filtran por las industrias de la tienda.
const authStub = { storeIndustries: signal<string[]>(['retail']) };

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
    // El servicio siempre expone un rango (la página lo inicializa); con `null`
    // «Ver Reportes» fallaba en `dateRangeToQueryParams`.
    dateRangeSyncSpy = {
      dateRange: jasmine
        .createSpy('dateRange')
        .and.returnValue({ start_date: '2026-11-01', end_date: '2026-11-23', preset: 'thisMonth' }),
    };
    analyticsServiceSpy = jasmine.createSpyObj('AnalyticsService', ['invalidateCache']);
    toastServiceSpy = jasmine.createSpyObj('ToastService', ['success', 'error', 'info', 'warning']);

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: makeRouteStub('sales') },
        { provide: DateRangeSyncService, useValue: dateRangeSyncSpy },
        { provide: AnalyticsService, useValue: analyticsServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
        { provide: AuthFacade, useValue: authStub },
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

  it('does not call refresh() directly on Refreshable children (effect covers it)', () => {
    const refreshableChild = { refresh: jasmine.createSpy('refresh') };
    component.onActivate(refreshableChild);
    component.onActionClick('refresh');
    expect(analyticsServiceSpy.invalidateCache).toHaveBeenCalledTimes(1);
    // Refreshable children reload via the refreshSignal effect; a direct
    // call here would fetch twice.
    expect(refreshableChild.refresh).not.toHaveBeenCalled();
  });

  it('navigates to the report route for the current analytics URL', () => {
    spyOnProperty(router, 'url', 'get').and.returnValue('/admin/analytics/sales/by-product');
    component.onActionClick('view-reports');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.calls.mostRecent().args[0]).toEqual(['/admin/reports/sales/sales-by-product']);
  });

  it('navigates to purchase-trends report route from purchase trends analytics URL', () => {
    spyOnProperty(router, 'url', 'get').and.returnValue('/admin/analytics/purchases/trends');
    component.onActionClick('view-reports');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.calls.mostRecent().args[0]).toEqual(['/admin/reports/purchases/purchase-trends']);
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

describe('AnalyticsShellComponent — pestañas por industria (agenda unificada F4)', () => {
  const tabsFor = (industries: string[]): string[] => {
    authStub.storeIndustries.set(industries);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            data: new Subject<Data>().asObservable(),
            snapshot: { data: { categoryId: 'inventory' } },
          },
        },
        { provide: DateRangeSyncService, useValue: { dateRange: () => null } },
        { provide: AnalyticsService, useValue: jasmine.createSpyObj('AnalyticsService', ['invalidateCache']) },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) },
        { provide: AuthFacade, useValue: authStub },
      ],
    });
    const shell = TestBed.createComponent(AnalyticsShellComponent).componentInstance;
    return shell.headerTabs().map((tab) => tab.id);
  };

  afterEach(() => authStub.storeIndustries.set(['retail']));

  it('una tienda solo retail no ve Consumo de insumos', () => {
    const tabs = tabsFor(['retail']);
    expect(tabs).not.toContain('inventory_ingredient_consumption');
    expect(tabs.length).toBe(getViewsByCategory('inventory').length - 1);
  });

  it('un restaurante sí ve Consumo de insumos', () => {
    expect(tabsFor(['restaurant'])).toContain('inventory_ingredient_consumption');
  });
});
