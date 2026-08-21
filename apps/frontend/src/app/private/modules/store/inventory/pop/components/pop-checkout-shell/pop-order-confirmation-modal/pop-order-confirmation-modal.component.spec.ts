import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PopOrderConfirmationModalComponent } from './pop-order-confirmation-modal.component';
import { CurrencyFormatService } from '../../../../../../../../shared/pipes/currency/currency.pipe';

const buildCurrencyStub = () =>
  ({
    format: (n: number | string | null | undefined) =>
      `$${Number(n ?? 0).toFixed(2)}`,
    loadCurrency: () => undefined,
  }) as unknown as CurrencyFormatService;

/**
 * CP-ID-VNDX-2026-08-21-POP-MODAL — Contrato del modal standalone post-creación.
 *
 * Cubre los tres puntos del contrato:
 *  - Pinta número + total + estado cuando `isOpen=true`.
 *  - Click en la X del header emite `(closed)`.
 *  - `isOpen=false` no renderiza el modal (verificable por ausencia del
 *    título y del cuerpo).
 *
 * Sin botones: el modal es info-only.
 */
describe('PopOrderConfirmationModalComponent', () => {
  let fixture: ComponentFixture<PopOrderConfirmationModalComponent>;
  let component: PopOrderConfirmationModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PopOrderConfirmationModalComponent],
      providers: [
        { provide: CurrencyFormatService, useFactory: buildCurrencyStub },
      ],
    });
    fixture = TestBed.createComponent(PopOrderConfirmationModalComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('isOpen', false);
    fixture.componentRef.setInput('orderNumber', 'ORC-1234');
    fixture.componentRef.setInput('total', 250000);
    fixture.componentRef.setInput('state', 'created');
    fixture.detectChanges();
  });

  it('(a) isOpen=false no pinta ni el título ni el cuerpo', () => {
    fixture.componentRef.setInput('isOpen', false);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h3')).toBeNull();
    expect(root.querySelector('.pop-order-confirmation')).toBeNull();
  });

  it('(b) isOpen=true pinta número + total + estado', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('¡Orden creada!');
    expect(text).toContain('ORC-1234');
    expect(text).toContain('$250000.00');
    expect(text).toContain('Creada');
  });

  it('(c) state=received mapea a etiqueta Recibida y variante success', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('state', 'received');
    fixture.detectChanges();

    expect(component.stateLabel()).toBe('Recibida');
    expect(component.stateVariant()).toBe('success');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Recibida');
  });

  it('(d) state=paid mapea a etiqueta Pagada', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('state', 'paid');
    fixture.detectChanges();

    expect(component.stateLabel()).toBe('Pagada');
    expect(component.stateVariant()).toBe('success');
  });

  it('(e) state desconocido cae al genérico Creada (defensivo)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('state', 'mystery-state');
    fixture.detectChanges();

    expect(component.stateLabel()).toBe('Creada');
    expect(component.stateVariant()).toBe('primary');
  });

  it('(f) orderNumber vacío cae al placeholder OC (no rompe la UI)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderNumber', '');
    fixture.detectChanges();

    expect(component.displayNumber()).toBe('OC');
  });

  it('(g) click en la X emite (closed)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    let emitted = false;
    component.closed.subscribe(() => (emitted = true));

    const closeBtn = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Cerrar modal"]',
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    expect(emitted).toBe(true);
  });
});