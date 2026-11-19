import { ComponentRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { DialogService, ToastService } from '../../../../../../../shared/components';
import { storeToday } from '../../../../../../../shared/utils/date.util';
import { addDays } from '../../../../scheduled-orders/utils/ymd.util';
import { ProductionOrdersService, ProductionSseService } from '../../services';
import { ProductionDayListComponent } from './production-day-list.component';

const TZ = 'America/Bogota';
const EMPTY_DAY = {
  date: '2026-03-10',
  timezone: TZ,
  cards: [],
  summary: { waiting: 0, in_progress: 0, completed: 0 },
  next_cursor: null,
};

function setup(data: Record<string, unknown>, date: string | null) {
  const router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
  const service = { getDay: jasmine.createSpy('getDay').and.returnValue(of(EMPTY_DAY)) };
  const queryParamMap = convertToParamMap(date ? { date } : {});

  TestBed.configureTestingModule({
    providers: [
      // La sesión de planta (QUI-1013) lee la tienda activa del AuthFacade.
      { provide: AuthFacade, useValue: { userStore: () => ({ id: 1 }) } },
      { provide: Router, useValue: router },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { data, queryParamMap }, queryParamMap: of(queryParamMap) },
      },
      { provide: ProductionOrdersService, useValue: service },
      {
        provide: ProductionSseService,
        useValue: { canStream: () => false, listen: () => undefined },
      },
      { provide: StoreSettingsFacade, useValue: { timezone: () => TZ } },
      { provide: ToastService, useValue: {} },
      { provide: DialogService, useValue: {} },
    ],
  });
  // Template and child components are out of scope: only the state logic is tested.
  TestBed.overrideComponent(ProductionDayListComponent, {
    set: { template: '', imports: [] },
  });
  const fixture = TestBed.createComponent(ProductionDayListComponent);
  fixture.detectChanges();
  return {
    fixture,
    ref: fixture.componentRef as ComponentRef<ProductionDayListComponent>,
    component: fixture.componentInstance,
    router,
    service,
  };
}

describe('ProductionDayListComponent', () => {
  describe('routed', () => {
    const data = {
      detailBase: '/admin/scheduled-orders/orders',
      activeBase: '/admin/scheduled-orders/active',
      consolidatedPath: '/admin/scheduled-orders/consolidated',
    };

    it('reads route data and the date query param', () => {
      const { component, service } = setup(data, '2026-03-10');
      expect(component.embedded()).toBeFalse();
      expect(component.detailBase()).toBe('/admin/scheduled-orders/orders');
      expect(component.activeBase()).toBe('/admin/scheduled-orders/active');
      expect(component.consolidatedPath()).toBe('/admin/scheduled-orders/consolidated');
      expect(component.date()).toBe('2026-03-10');
      expect(service.getDay.calls.mostRecent().args[0]).toBe('2026-03-10');
      expect(component.headerActions().map((a) => a.id)).toEqual(['consolidated', 'active']);
    });

    it('navigates with the date query param when the day changes', () => {
      const { component, router } = setup(data, '2026-03-10');
      component.goToDay(1);
      expect(router.navigate).toHaveBeenCalledWith(
        [],
        jasmine.objectContaining({
          queryParams: { date: '2026-03-11' },
          queryParamsHandling: 'merge',
        }),
      );
    });

    it('hides the active action when the route has no activeBase', () => {
      const { component } = setup({ detailBase: '/x/orders' }, null);
      expect(component.activeBase()).toBeNull();
      expect(component.headerActions()).toEqual([]);
    });
  });

  describe('embedded', () => {
    it('falls back to the restaurant-ops defaults without route data', () => {
      const { component } = setup({}, null);
      expect(component.embedded()).toBeTrue();
      expect(component.detailBase()).toBe('/admin/restaurant-ops/production/orders');
      expect(component.activeBase()).toBe('/admin/restaurant-ops/production/active');
      expect(component.consolidatedPath()).toBeNull();
      expect(component.date()).toBe(storeToday(TZ));
    });

    it('changing the day keeps local state and does not navigate', () => {
      const { component, router, fixture, service } = setup({}, null);
      const today = storeToday(TZ);
      component.goToDay(1);
      fixture.detectChanges();
      expect(component.date()).toBe(addDays(today, 1));
      expect(router.navigate).not.toHaveBeenCalled();
      expect(service.getDay.calls.mostRecent().args[0]).toBe(addDays(today, 1));
      component.goToToday();
      expect(component.date()).toBe(today);
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('inputs take precedence over route data and `embedded` forces local date', () => {
      const { component, ref, router, fixture } = setup(
        { detailBase: '/route/orders', activeBase: '/route/active' },
        '2026-03-10',
      );
      ref.setInput('detailBase', '/input/orders');
      ref.setInput('activeBase', null);
      ref.setInput('consolidatedPath', '/input/consolidated');
      ref.setInput('embedded', true);
      fixture.detectChanges();
      expect(component.detailBase()).toBe('/input/orders');
      expect(component.activeBase()).toBeNull();
      expect(component.consolidatedPath()).toBe('/input/consolidated');
      expect(component.embedded()).toBeTrue();
      component.goToDay(-1);
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});
