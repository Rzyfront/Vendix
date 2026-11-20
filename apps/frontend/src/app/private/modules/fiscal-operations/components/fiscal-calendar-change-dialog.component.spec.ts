import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import {
  FiscalCalendarChangeDialogComponent,
  VAT_PERIODICITY_LABELS,
} from './fiscal-calendar-change-dialog.component';
import { FiscalCalendarChangePreview } from '../interfaces/fiscal-operations.interface';

const PREVIEW: FiscalCalendarChangePreview = {
  current_periodicity: 'bimonthly',
  next_periodicity: 'four_monthly',
  changed: true,
  pending_reminders: 6,
  pending_obligations: 3,
};

/**
 * Diálogo del cambio de periodicidad de IVA (F3): la persona que ya tenía
 * avisos del calendario bimestral decide si los reemplaza por los del
 * cuatrimestral o los conserva.
 */
describe('FiscalCalendarChangeDialogComponent', () => {
  let decisions: ('replace' | 'keep')[];

  function create() {
    const fixture = TestBed.createComponent(
      FiscalCalendarChangeDialogComponent,
    );
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('preview', PREVIEW);
    decisions = [];
    fixture.componentInstance.decision.subscribe((d) => decisions.push(d));
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FiscalCalendarChangeDialogComponent],
      providers: [provideZonelessChangeDetection()],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('cuenta en palabras los avisos y obligaciones pendientes del calendario anterior', () => {
    const text = (create().nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('6 recordatorios pendientes');
    expect(text).toContain('3 obligaciones sin empezar');
    expect(text).toContain('calendario bimestral');
    expect(text).toContain('calendario cuatrimestral');
    // Lo ya presentado/pagado nunca se toca: se dice explícitamente.
    expect(text).toContain('no se');
    expect(text).toContain('modifican');
  });

  it('«Reemplazar» emite replace y cierra el diálogo', () => {
    const fixture = create();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    const replace = buttons.find((b) =>
      (b.textContent ?? '').includes('Reemplazar por el'),
    );
    expect(replace).toBeTruthy();
    replace!.click();
    fixture.detectChanges();

    expect(decisions).toEqual(['replace']);
    expect(fixture.componentInstance.isOpen()).toBe(false);
  });

  it('«Conservar los anteriores» emite keep', () => {
    const fixture = create();
    const keep = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => (b.textContent ?? '').includes('Conservar'));
    expect(keep).toBeTruthy();
    keep!.click();
    fixture.detectChanges();

    expect(decisions).toEqual(['keep']);
  });

  it('singulariza cuando solo hay un aviso y una obligación', () => {
    const fixture = create();
    fixture.componentRef.setInput('preview', {
      ...PREVIEW,
      pending_reminders: 1,
      pending_obligations: 1,
    });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1 recordatorio pendiente');
    expect(text).toContain('1 obligación sin empezar');
  });

  it('conoce las tres periodicidades de IVA del art. 600 ET', () => {
    expect(VAT_PERIODICITY_LABELS).toEqual({
      monthly: 'mensual',
      bimonthly: 'bimestral',
      four_monthly: 'cuatrimestral',
    });
  });
});
