import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { PopCheckoutShellComponent } from './pop-checkout-shell.component';

const buildCurrencyStub = () =>
  ({
    currencyFormatStyle: () => 'comma_dot',
    currencyDecimals: () => 0,
    currencySymbol: () => '$',
    currencyPosition: () => 'before',
    currentCurrency: () => ({ format_style: 'comma_dot', decimal_places: 0 }),
    format: (n: number | string | null | undefined) => `$${Number(n ?? 0)}`,
    loadCurrency: () => undefined,
  }) as unknown as CurrencyFormatService;

/**
 * QUI-942 — el estado «OC creada, una etapa posterior falló» no tenía vista:
 * el cuerpo del shell quedaba en blanco y el pie seguía ofreciendo
 * «Confirmar», cuyo segundo clic enviaba una OC vacía (400 de
 * `supplier_id`/`location_id`/`items`).
 *
 * Contrato:
 *  - Con `orderResult.failedStage` se pinta el panel parcial con la orden, el
 *    estado de cada etapa y el motivo.
 *  - Con un resultado en pantalla el pie solo ofrece «Cerrar»: no hay
 *    Confirmar / Siguiente / Anterior en escritorio ni en móvil.
 *  - Sin resultado el pie sigue siendo el del asistente (regresión).
 */
describe('PopCheckoutShellComponent — QUI-942 resultado parcial', () => {
  let fixture: ComponentFixture<PopCheckoutShellComponent>;
  let root: HTMLElement;

  const partialPayFailure = {
    id: 774,
    total: 0,
    orderNumber: 'PO-774',
    state: 'received',
    failedStage: 'pay' as const,
    stages: [
      { name: 'create' as const, label: 'Orden creada', status: 'success' as const },
      { name: 'receive' as const, label: 'Mercancía recibida', status: 'success' as const },
      {
        name: 'pay' as const,
        label: 'Pago registrado',
        status: 'failed' as const,
        errorMessage: 'No tienes permiso para registrar pagos',
      },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PopCheckoutShellComponent],
      providers: [
        { provide: CurrencyFormatService, useFactory: buildCurrencyStub },
        // El paso Pago (montado en el asistente) lee la zona horaria.
        {
          provide: StoreSettingsFacade,
          useValue: { settings: () => ({ general: { timezone: 'America/Bogota' } }) },
        },
      ],
    });
    fixture = TestBed.createComponent(PopCheckoutShellComponent);
    root = fixture.nativeElement as HTMLElement;
  });

  function render(orderResult: unknown): void {
    fixture.componentRef.setInput('orderResult', orderResult);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
  }

  it('fallo de pago: pinta el panel parcial con la orden, cada etapa y el motivo', () => {
    render(partialPayFailure);

    const panel = root.querySelector('.pop-partial-result');
    expect(panel).not.toBeNull();
    const text = panel?.textContent ?? '';
    expect(text).toContain('La orden PO-774 se creó, pero un paso no terminó');
    expect(text).toContain('Pago registrado');
    expect(text).toContain('Falló');
    expect(text).toContain('No tienes permiso para registrar pagos');
    expect(root.querySelectorAll('.pop-partial-result__stage').length).toBe(3);
    // Fallo de pago: no se ofrece reintentar recepción.
    expect(text).not.toContain('Reintentar recepción');
  });

  it('con resultado en pantalla el pie solo ofrece «Cerrar»: nada vuelve a enviar la compra', () => {
    render(partialPayFailure);

    const footer = root.querySelector('.pop-checkout-footer') as HTMLElement;
    expect(footer).not.toBeNull();
    expect(footer.querySelector('.btn-confirm')).toBeNull();
    expect(footer.querySelector('.btn-next')).toBeNull();
    expect(footer.querySelector('.btn-prev')).toBeNull();
    expect(footer.querySelector('.btn-cta-mobile')).toBeNull();
    expect(footer.querySelector('.btn-cancel')?.textContent?.trim()).toBe('Cerrar');
    expect(footer.querySelector('.footer-mobile')?.textContent).toContain('Cerrar');
  });

  it('fallo de recepción: ofrece «Reintentar recepción» y emite retryOrder', () => {
    render({
      ...partialPayFailure,
      failedStage: 'receive',
      stages: [
        { name: 'create', label: 'Orden creada', status: 'success' },
        { name: 'receive', label: 'Mercancía recibida', status: 'failed', errorMessage: 'x' },
        { name: 'pay', label: 'Pago registrado', status: 'skipped' },
      ],
    });

    let retried = false;
    fixture.componentInstance.retryOrder.subscribe(() => (retried = true));
    const retry = root.querySelector('.pop-partial-result__actions .btn-confirm') as HTMLButtonElement;
    expect(retry?.textContent).toContain('Reintentar recepción');
    retry.click();
    expect(retried).toBeTrue();
  });

  it('sin resultado el pie sigue siendo el del asistente (comportamiento previo)', () => {
    render(null);

    expect(root.querySelector('.pop-partial-result')).toBeNull();
    const footer = root.querySelector('.pop-checkout-footer') as HTMLElement;
    expect(footer.querySelector('.btn-cancel')?.textContent?.trim()).toBe('Cancelar');
    expect(
      footer.querySelector('.btn-next') ?? footer.querySelector('.btn-confirm'),
    ).not.toBeNull();
  });
});
