import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { ProductionDaySupplies } from '../../interfaces';
import { ProductionOrdersService } from '../../services/production-orders.service';
import { ProductionDaySuppliesComponent } from './production-day-supplies.component';
import { shouldAutoOpenDaySummary } from './production-day-supplies.util';

describe('ProductionDaySuppliesComponent — S5 / S6', () => {
  let fixture: ComponentFixture<ProductionDaySuppliesComponent>;
  let getDaySupplies: jasmine.Spy;

  const dayOf = (extra: Partial<ProductionDaySupplies> = {}): ProductionDaySupplies => ({
    date: '2026-11-11',
    timezone: 'America/Bogota',
    orders_total: 4,
    orders_completed: 2,
    orders_without_breakdown: 0,
    supplies: [
      { product_id: 1, name: 'Harina', sku: null, unit: 'kg', planned: 10, consumed: 6, pending: 4, difference: 1 },
      { product_id: 2, name: 'Azúcar', sku: null, unit: 'kg', planned: 5, consumed: 5, pending: 0, difference: 0 },
    ],
    ...extra,
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const headers = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('th')).map((th) =>
      (th.textContent ?? '').trim(),
    );
  const hasSummaryButton = () =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).some((b) =>
      (b.textContent ?? '').includes('Resumen del día'),
    );

  const render = async (supplies: ProductionDaySupplies = dayOf()) => {
    getDaySupplies.and.returnValue(of(supplies));
    fixture = TestBed.createComponent(ProductionDaySuppliesComponent);
    fixture.componentRef.setInput('date', '2026-11-11');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const setSummary = async (waiting: number, in_progress: number, completed: number) => {
    fixture.componentRef.setInput('summary', { waiting, in_progress, completed });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getDaySupplies = jasmine.createSpy('getDaySupplies');
    TestBed.configureTestingModule({
      providers: [{ provide: ProductionOrdersService, useValue: { getDaySupplies } }],
    });
  });

  it('asks the service for the day and scope it was given', async () => {
    getDaySupplies.and.returnValue(of(dayOf()));
    fixture = TestBed.createComponent(ProductionDaySuppliesComponent);
    fixture.componentRef.setInput('date', '2026-11-11');
    fixture.componentRef.setInput('apiScope', 'manufacturing');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(getDaySupplies).toHaveBeenCalledOnceWith('2026-11-11', 'manufacturing');
  });

  it('renders the columns and one row per supply', async () => {
    await render();
    expect(headers()).toEqual(['Insumo', 'Unidad', 'Planificado', 'Consumido', 'Pendiente']);
    expect(text()).toContain('Harina');
    expect(text()).toContain('Azúcar');
  });

  it('shows quantities only: no cost anywhere', async () => {
    await render();
    expect(text().toLowerCase()).not.toContain('costo');
    expect(text()).not.toContain('$');
  });

  it('shows the empty message when the day has no supplies', async () => {
    await render(dayOf({ supplies: [] }));
    expect(text()).toContain('No hay insumos planificados para este día.');
  });

  it('shows the without-breakdown note with the number of orders', async () => {
    await render(dayOf({ orders_without_breakdown: 3 }));
    expect(text().replace(/\s+/g, ' ')).toContain(
      '3 órdenes finalizadas antes de este cambio no tienen desglose de consumo.',
    );
  });

  it('hides the note when every finished order has its breakdown', async () => {
    await render();
    expect(text()).not.toContain('antes de este cambio');
  });

  it('reloads when the refresh token changes', async () => {
    await render();
    expect(getDaySupplies).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('refreshToken', { reloaded: true });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getDaySupplies).toHaveBeenCalledTimes(2);
  });

  it('collapses and expands the panel', async () => {
    await render();
    expect(text()).toContain('Harina');
    fixture.componentInstance.toggle();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeNull();
    fixture.componentInstance.toggle();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).not.toBeNull();
  });

  describe('summary modal', () => {
    it('opens by itself when the day goes from pending to closed with finished orders', async () => {
      await render();
      await setSummary(1, 1, 1);
      expect(fixture.componentInstance.summaryOpen()).toBeFalse();

      await setSummary(0, 0, 2);
      expect(fixture.componentInstance.summaryOpen()).toBeTrue();
    });

    it('does not open when the page starts with the day already closed', async () => {
      await render();
      await setSummary(0, 0, 3);
      expect(fixture.componentInstance.summaryOpen()).toBeFalse();
      expect(hasSummaryButton()).toBeTrue();
    });

    it('does not open when the day closes with nothing finished', async () => {
      await render();
      await setSummary(1, 0, 0);
      await setSummary(0, 0, 0);
      expect(fixture.componentInstance.summaryOpen()).toBeFalse();
    });

    it('does not carry the previous day over when the date changes', async () => {
      await render();
      await setSummary(2, 0, 1);
      fixture.componentRef.setInput('date', '2026-11-12');
      fixture.componentRef.setInput('summary', { waiting: 0, in_progress: 0, completed: 4 });
      fixture.detectChanges();
      await fixture.whenStable();
      expect(fixture.componentInstance.summaryOpen()).toBeFalse();
    });

    it('shows the "Resumen del día" button only with finished orders', async () => {
      await render();
      await setSummary(2, 0, 0);
      expect(hasSummaryButton()).toBeFalse();

      await setSummary(1, 0, 1);
      expect(hasSummaryButton()).toBeTrue();
    });

    it('reopens from the button and shows finished of total plus the Diferencia column', async () => {
      await render();
      await setSummary(0, 0, 2);
      fixture.componentInstance.summaryOpen.set(false);
      fixture.detectChanges();

      fixture.componentInstance.openSummary();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const body = document.body.textContent ?? '';
      expect(body).toContain('Resumen de producción del día');
      expect(body.replace(/\s+/g, ' ')).toContain('2 de 4 órdenes finalizadas');
      expect(body).toContain('Diferencia');
    });

    it('prints with the print body class and removes it afterwards', async () => {
      await render();
      let classDuringPrint = false;
      spyOn(window, 'print').and.callFake(() => {
        classDuringPrint = document.body.classList.contains('production-supplies-printing');
      });
      fixture.componentInstance.print();
      expect(classDuringPrint).toBeTrue();
      expect(document.body.classList.contains('production-supplies-printing')).toBeFalse();
    });
  });
});

describe('shouldAutoOpenDaySummary — S6', () => {
  const c = (waiting: number, in_progress: number, completed: number) => ({
    waiting,
    in_progress,
    completed,
  });

  it('is true on the pending -> closed transition with finished orders', () => {
    expect(shouldAutoOpenDaySummary(c(0, 1, 1), c(0, 0, 2))).toBeTrue();
    expect(shouldAutoOpenDaySummary(c(2, 0, 0), c(0, 0, 2))).toBeTrue();
  });

  it('is false without an earlier reading', () => {
    expect(shouldAutoOpenDaySummary(null, c(0, 0, 2))).toBeFalse();
  });

  it('is false while something is still pending or nothing is finished', () => {
    expect(shouldAutoOpenDaySummary(c(2, 0, 0), c(1, 0, 1))).toBeFalse();
    expect(shouldAutoOpenDaySummary(c(1, 0, 0), c(0, 0, 0))).toBeFalse();
  });

  it('is false when the day was already closed', () => {
    expect(shouldAutoOpenDaySummary(c(0, 0, 2), c(0, 0, 3))).toBeFalse();
  });
});
