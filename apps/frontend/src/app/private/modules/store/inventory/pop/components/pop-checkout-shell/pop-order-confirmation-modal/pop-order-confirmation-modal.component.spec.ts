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
 * Contrato:
 *  - Pinta número + total + estado cuando `isOpen=true`.
 *  - CP-PURCHASE-TRANSPARENCY (T2/D.2): el badge sólo traduce los cinco
 *    valores de `purchase_order_status_enum`. `partial` es recepción parcial,
 *    no pago parcial; sin estado dice «Sin confirmar»; un token fuera del enum
 *    se pinta tal cual en vez de traducirse a un estado inventado.
 *  - El header X, el overlay y el ESC cuentan como «Nueva compra»
 *    (no obligan al operador a elegir un botón).
 *  - El botón «Nueva compra» emite `(newPurchase)`.
 *  - El botón «Ver orden» emite `(viewOrder)` y queda deshabilitado si
 *    no hay `orderId` válido.
 *  - `isOpen=false` no renderiza el modal (verificable por ausencia del
 *    título y del cuerpo).
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
    fixture.componentRef.setInput('state', 'approved');
    fixture.componentRef.setInput('orderId', 42);
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
    expect(text).toContain('Aprobada');
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

  /**
   * `partial` es un valor del EJE de estado de la orden y significa recepción
   * parcial (`PurchaseOrdersService.receive`), no pago parcial: lo pagado vive
   * en `payment_status`, que este badge no lee.
   */
  it('(d) state=partial dice «Recibida parcialmente», no «Pago parcial»', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('state', 'partial');
    fixture.detectChanges();

    expect(component.stateLabel()).toBe('Recibida parcialmente');
    expect(component.stateVariant()).toBe('warning');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Recibida parcialmente');
    expect(text).not.toContain('Pago parcial');
  });

  it('(d2) los cinco valores del enum tienen etiqueta, y sólo esos', () => {
    fixture.componentRef.setInput('isOpen', true);
    const expected: Record<string, string> = {
      draft: 'Borrador',
      approved: 'Aprobada',
      partial: 'Recibida parcialmente',
      received: 'Recibida',
      cancelled: 'Cancelada',
    };
    for (const [state, label] of Object.entries(expected)) {
      fixture.componentRef.setInput('state', state);
      fixture.detectChanges();
      expect(component.stateLabel()).toBe(label);
    }

    // `paid` NO es un estado de la orden — el eje de pago es otra columna.
    // Antes se traducía a «Pagada» y el badge afirmaba algo que `status` no
    // puede decir.
    fixture.componentRef.setInput('state', 'paid');
    fixture.detectChanges();
    expect(component.stateLabel()).toBe('paid');
    expect(component.stateVariant()).toBe('neutral');
  });

  it('(e) state desconocido se pinta tal cual, sin inventar una etiqueta', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('state', 'mystery-state');
    fixture.detectChanges();

    expect(component.stateLabel()).toBe('mystery-state');
    expect(component.stateVariant()).toBe('neutral');
  });

  it('(e2) sin estado el badge dice «Sin confirmar» (no elige uno)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('state', '');
    fixture.detectChanges();

    expect(component.stateLabel()).toBe('Sin confirmar');
    expect(component.stateVariant()).toBe('neutral');
  });

  it('(f) orderNumber vacío cae al placeholder OC (no rompe la UI)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderNumber', '');
    fixture.detectChanges();

    expect(component.displayNumber()).toBe('OC');
  });

  it('(g) click en la X emite (newPurchase) — cierre neutro', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    let newPurchaseEmitted = false;
    let viewOrderEmitted = false;
    component.newPurchase.subscribe(() => (newPurchaseEmitted = true));
    component.viewOrder.subscribe(() => (viewOrderEmitted = true));

    const closeBtn = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Cerrar modal"]',
    ) as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    expect(newPurchaseEmitted).toBe(true);
    expect(viewOrderEmitted).toBe(false);
  });

  it('(h) click en "Nueva compra" emite (newPurchase)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    let newPurchaseEmitted = false;
    let viewOrderEmitted = false;
    component.newPurchase.subscribe(() => (newPurchaseEmitted = true));
    component.viewOrder.subscribe(() => (viewOrderEmitted = true));

    // El botón «Nueva compra» es el primero del grupo de acciones.
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.pop-order-confirmation__actions app-button button',
    );
    expect(buttons.length).toBe(2);
    (buttons[0] as HTMLButtonElement).click();

    expect(newPurchaseEmitted).toBe(true);
    expect(viewOrderEmitted).toBe(false);
  });

  it('(i) click en "Ver orden" emite (viewOrder)', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', 42);
    fixture.detectChanges();

    let newPurchaseEmitted = false;
    let viewOrderEmitted = false;
    component.newPurchase.subscribe(() => (newPurchaseEmitted = true));
    component.viewOrder.subscribe(() => (viewOrderEmitted = true));

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.pop-order-confirmation__actions app-button button',
    );
    expect(buttons.length).toBe(2);
    (buttons[1] as HTMLButtonElement).click();

    expect(viewOrderEmitted).toBe(true);
    expect(newPurchaseEmitted).toBe(false);
  });

  it('(j) "Ver orden" queda deshabilitado cuando no hay orderId válido', () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('orderId', null);
    fixture.detectChanges();

    expect(component.canViewOrder()).toBe(false);

    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.pop-order-confirmation__actions app-button button',
    );
    expect(buttons.length).toBe(2);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });
});
