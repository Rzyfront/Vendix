import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { VendixAccountActivityComponent, activityRange } from './vendix-account-activity.component';
import { PlatformCrmService } from './platform-crm.service';
import { CoveredStore, PlatformStoreActivityView } from './platform-crm.interface';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { StoreActivityChartsComponent } from '../../../../shared/components/store-activity-charts/store-activity-charts.component';

/**
 * Cuenta Vendix · «Actividad».
 * Como comercial de Vendix, elijo un comercio enlazado y un rango (7/30/90
 * días) y veo las mismas gráficas de actividad que en Superadmin.
 */
describe('VendixAccountActivityComponent', () => {
  const STORES: CoveredStore[] = [
    {
      store_id: 201,
      store_name: 'Espiga Centro',
      organization_name: 'Panadería La Espiga',
      plan_name: 'Plan Pro',
      subscription_state: 'active',
    },
    {
      store_id: 301,
      store_name: 'Clavo Principal',
      organization_name: 'Ferretería El Clavo',
      plan_name: null,
      subscription_state: null,
    },
  ];
  const activity = (storeId = 201): PlatformStoreActivityView => ({
    store: { store_id: storeId, store_name: 'x', organization_name: 'y' },
    window: { from: '2026-10-21', to: '2026-11-19', days: 30 },
    summary: {
      score: 12.4,
      orders_count: 9,
      revenue_operating: 450000,
      active_users: 2,
      audit_events: 17,
      last_activity_at: '2026-11-18T20:00:00.000Z',
    },
    series: {
      days: [{ date: '2026-11-18', orders: 3, revenue_operating: 150000, audit_events: 5, logins: 1 }],
      by_channel: { pos: 2 },
      by_state: { finished: 3 },
    },
  });

  let service: { getStoreActivity: jasmine.Spy };
  let fixture: ComponentFixture<VendixAccountActivityComponent>;

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const text = () => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
  const charts = () =>
    fixture.debugElement.query((el) => el.componentInstance instanceof StoreActivityChartsComponent)
      ?.componentInstance as StoreActivityChartsComponent | undefined;

  const setup = async (spy: jasmine.Spy, stores: CoveredStore[] = STORES) => {
    service = { getStoreActivity: spy };
    TestBed.configureTestingModule({
      imports: [VendixAccountActivityComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PlatformCrmService, useValue: service },
        {
          provide: CurrencyFormatService,
          useValue: {
            format: (v: number) => `$${Math.round(v)}`,
            formatChartAxis: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(VendixAccountActivityComponent);
    fixture.componentRef.setInput('customerId', 55);
    fixture.componentRef.setInput('stores', stores);
    await settle();
  };

  it('el rango de N días cierra hoy en UTC', () => {
    expect(activityRange(30, new Date('2026-11-19T23:30:00-05:00'))).toEqual({
      from: '2026-10-22',
      to: '2026-11-20',
    });
    expect(activityRange(7, new Date('2026-11-19T12:00:00Z'))).toEqual({
      from: '2026-11-13',
      to: '2026-11-19',
    });
  });

  it('carga el primer comercio con 30 días y pasa series y resumen a las gráficas compartidas', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(activity())));

    const [customerId, storeId, range] = service.getStoreActivity.calls.mostRecent().args;
    expect([customerId, storeId]).toEqual([55, 201]);
    expect(range).toEqual(activityRange(30));
    const chart = charts()!;
    expect(chart).toBeDefined();
    expect(chart.series()).toEqual(activity().series);
    expect(chart.summary()).toEqual(activity().summary);
    expect(text()).toContain('Actividad diaria');
    expect(text()).toContain('Última actividad');
  });

  it('cambiar de comercio o de rango vuelve a consultar', async () => {
    await setup(jasmine.createSpy('get').and.returnValue(of(activity())));

    fixture.componentInstance['onStoreChange'](301);
    await settle();
    expect(service.getStoreActivity.calls.mostRecent().args.slice(0, 2)).toEqual([55, 301]);

    fixture.componentInstance['onRangeChange'](7);
    await settle();
    expect(service.getStoreActivity.calls.mostRecent().args).toEqual([55, 301, activityRange(7)]);

    // Un rango fuera de la lista se ignora.
    const calls = service.getStoreActivity.calls.count();
    fixture.componentInstance['onRangeChange'](365);
    await settle();
    expect(service.getStoreActivity.calls.count()).toBe(calls);
  });

  it('un comercio que ya no está enlazado (404) lo dice sin toast ni gráfica', async () => {
    await setup(
      jasmine.createSpy('get').and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 }))),
    );
    expect(text()).toContain('Este comercio ya no está enlazado a este cliente.');
    expect(charts()).toBeUndefined();
  });

  it('otro error ofrece «Reintentar»', async () => {
    const spy = jasmine
      .createSpy('get')
      .and.returnValues(throwError(() => new HttpErrorResponse({ status: 500 })), of(activity()));
    await setup(spy);

    expect(text()).toContain('No pudimos cargar la actividad.');
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'))
      .find((b) => (b.textContent ?? '').includes('Reintentar'))!
      .click();
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(charts()).toBeDefined();
  });

  it('sin comercios no consulta', async () => {
    await setup(jasmine.createSpy('get'), []);
    expect(service.getStoreActivity).not.toHaveBeenCalled();
    expect(text()).toContain('Sin comercios para mostrar.');
  });
});
