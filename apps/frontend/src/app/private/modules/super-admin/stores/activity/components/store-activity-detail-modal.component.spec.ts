import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { StoreActivityDetailModalComponent } from './store-activity-detail-modal.component';
import { StoreActivityService } from '../services/store-activity.service';
import { StoreActivityRow, StoreActivitySeries } from '../contracts/store-activity.contract';
import { StoreActivityChartsComponent } from '../../../../../../shared/components/store-activity-charts/store-activity-charts.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../shared/components/index';

/**
 * Regresión del detalle de actividad de Superadmin tras extraer sus gráficas a
 * `app-store-activity-charts` (compartidas con la Cuenta Vendix del CRM): el
 * modal sigue pidiendo detalle y series de la tienda y pinta las mismas
 * gráficas con esas series.
 */
describe('StoreActivityDetailModalComponent · gráficas compartidas', () => {
  const ROW: StoreActivityRow = {
    store_id: 201,
    name: 'Espiga Centro',
    slug: 'espiga-centro',
    organization_name: 'Panadería La Espiga',
    is_active: true,
    score: 12.4,
    orders_count: 9,
    audit_events: 17,
    active_users: 2,
    revenue_operating: 450000,
    last_activity_at: '2026-11-18T20:00:00.000Z',
  };
  const SERIES: StoreActivitySeries = {
    days: [{ date: '2026-11-18', orders: 3, revenue_operating: 150000, audit_events: 5, logins: 1 }],
    by_channel: { pos: 3 },
    by_state: { finished: 3 },
  };

  let fixture: ComponentFixture<StoreActivityDetailModalComponent>;
  let api: { getDetail: jasmine.Spy; getSeries: jasmine.Spy };

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    api = {
      getDetail: jasmine
        .createSpy('getDetail')
        .and.returnValue(of({ data: { summary: { ...ROW, successful_logins: 4 }, timeline: [], total: 0, page: 1, limit: 20 } })),
      getSeries: jasmine.createSpy('getSeries').and.returnValue(of({ data: SERIES })),
    };
    TestBed.configureTestingModule({
      imports: [StoreActivityDetailModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreActivityService, useValue: api },
        { provide: ToastService, useValue: { error: jasmine.createSpy('error') } },
        {
          provide: CurrencyFormatService,
          useValue: {
            format: (v: number) => `$${Math.round(Number(v))}`,
            formatChartAxis: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(StoreActivityDetailModalComponent);
    fixture.componentRef.setInput('store', ROW);
    fixture.componentInstance.isOpen.set(true);
    await settle();
    fixture.componentInstance.reload();
    await settle();
  });

  it('pide la serie de la tienda y se la pasa a app-store-activity-charts', () => {
    expect(api.getSeries).toHaveBeenCalled();
    expect(api.getSeries.calls.mostRecent().args[0]).toBe(201);
    const charts = fixture.debugElement.query(
      (el) => el.componentInstance instanceof StoreActivityChartsComponent,
    );
    expect(charts).withContext('el modal monta las gráficas compartidas').not.toBeNull();
    const instance = charts.componentInstance as StoreActivityChartsComponent;
    expect(instance.series()).toEqual(SERIES);
    // Superadmin tiene su propio hero: no pasa la tira de resumen.
    expect(instance.summary()).toBeNull();
    const [orders] = instance.dailyOptions().series as Array<{ name: string; data: number[] }>;
    expect([orders.name, orders.data]).toEqual(['Pedidos', [3]]);
  });

  it('conserva su hero con los accesos del detalle', () => {
    const content = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(content).toContain('Score de actividad');
    expect(content).toContain('Accesos');
    expect(content).toContain('Actividad diaria');
  });
});
