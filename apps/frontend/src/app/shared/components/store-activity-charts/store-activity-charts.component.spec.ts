import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  StoreActivityChartsComponent,
  StoreActivityChartsSeries,
} from './store-activity-charts.component';
import { CurrencyFormatService } from '../../pipes/currency/currency.pipe';

/**
 * Gráficas de actividad de un comercio, compartidas por el detalle de
 * Superadmin y la Cuenta Vendix del CRM: mismas series y opciones en los dos.
 */
describe('StoreActivityChartsComponent', () => {
  const SERIES: StoreActivityChartsSeries = {
    days: [
      { date: '2026-11-17', orders: 1, revenue_operating: 50000, audit_events: 4, logins: 0 },
      { date: '2026-11-18', orders: 3, revenue_operating: 150000.5, audit_events: 5, logins: 1 },
    ],
    by_channel: { pos: 2, ecommerce: 2 },
    by_state: { finished: 4 },
  };

  let fixture: ComponentFixture<StoreActivityChartsComponent>;
  let component: StoreActivityChartsComponent;

  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const text = () => ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [StoreActivityChartsComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyFormatService,
          useValue: {
            format: (v: number) => `$${Math.round(Number(v))}`,
            formatChartAxis: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(StoreActivityChartsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('series', SERIES);
    await settle();
  });

  it('serie diaria: pedidos, eventos y accesos por día', () => {
    const series = component.dailyOptions().series as Array<{ name: string; type: string; data: number[] }>;
    expect(series.map((s) => [s.name, s.type, s.data])).toEqual([
      ['Pedidos', 'line', [1, 3]],
      ['Eventos', 'line', [4, 5]],
      ['Accesos', 'line', [0, 1]],
    ]);
    expect((component.dailyOptions().xAxis as { data: string[] }).data).toHaveSize(2);
  });

  it('ingreso operativo por día en barras, con el formato de moneda en el tooltip', () => {
    const options = component.revenueOptions();
    const [bar] = options.series as Array<{ name: string; type: string; data: number[] }>;
    expect([bar.name, bar.type, bar.data]).toEqual(['Ingreso operativo', 'bar', [50000, 150000.5]]);
    const formatter = (options.tooltip as { formatter: (p: unknown) => string }).formatter;
    expect(formatter([{ name: '18 nov', value: 150000.5 }])).toContain('$150001');
  });

  it('doughnuts por canal y por estado', () => {
    const [channel] = component.channelOptions().series as Array<{ data: unknown[] }>;
    expect(channel.data).toEqual([
      { name: 'pos', value: 2 },
      { name: 'ecommerce', value: 2 },
    ]);
    const [state] = component.stateOptions().series as Array<{ data: unknown[] }>;
    expect(state.data).toEqual([{ name: 'finished', value: 4 }]);
  });

  it('sin pedidos con canal o estado muestra el aviso en vez del doughnut', async () => {
    fixture.componentRef.setInput('series', { ...SERIES, by_channel: {}, by_state: { finished: 0 } });
    await settle();
    expect(text()).toContain('Sin pedidos con canal en el rango.');
    expect(text()).toContain('Sin pedidos con estado en el rango.');
  });

  it('sin `summary` no pinta la tira de métricas; con `summary` sí', async () => {
    const strip = () =>
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="store-activity-summary"]');
    expect(strip()).toBeNull();

    fixture.componentRef.setInput('summary', {
      score: 12.4,
      orders_count: 9,
      revenue_operating: 450000,
      active_users: 2,
      audit_events: 17,
      last_activity_at: null,
    });
    await settle();
    const content = (strip()?.textContent ?? '').replace(/\s+/g, ' ');
    expect(content).toContain('12.4');
    expect(content).toContain('$450000');
    expect(content).toContain('Sin actividad');
  });
});
