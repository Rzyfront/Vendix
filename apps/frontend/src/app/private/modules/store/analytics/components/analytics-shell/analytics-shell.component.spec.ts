import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, Data } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { AnalyticsShellComponent } from './analytics-shell.component';
import {
  AnalyticsCategoryId,
  getCategoryById,
} from '../../config/analytics-registry';
import { DateRangeSyncService } from '../../../shared/services/date-range-sync.service';

describe('AnalyticsShellComponent', () => {
  let fixture: ComponentFixture<AnalyticsShellComponent>;
  let component: AnalyticsShellComponent;
  let router: Router;
  let navigateSpy: jasmine.Spy;
  let dateRangeSyncSpy: { dateRange: jasmine.Spy };

  const makeRouteStub = (
    categoryId: AnalyticsCategoryId,
  ): { data: Observable<Data>; snapshot: unknown } => ({
    data: new Subject<Data>().asObservable(),
    snapshot: { data: { categoryId } },
  });

  beforeEach(() => {
    dateRangeSyncSpy = { dateRange: jasmine.createSpy('dateRange').and.returnValue(null) };

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: makeRouteStub('sales') },
        { provide: DateRangeSyncService, useValue: dateRangeSyncSpy },
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

  it('renders the Ver Reportes header action', () => {
    const actions = component.headerActions();
    expect(actions.length).toBe(1);
    expect(actions[0].id).toBe('view-reports');
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

