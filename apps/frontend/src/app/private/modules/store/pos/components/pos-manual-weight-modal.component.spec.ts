import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { PosManualWeightModalComponent } from './pos-manual-weight-modal.component';

/**
 * PR #1062 ronda 2 — requisito de Rafael: el pesado manual abre VACÍO y el
 * número precargado se borra sin que el campo lo reponga.
 */
describe('PosManualWeightModalComponent — campo de cantidad', () => {
  const render = async (initialAmount?: string) => {
    TestBed.configureTestingModule({
      imports: [PosManualWeightModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CurrencyFormatService, useValue: { format: (v: number) => String(v) } },
      ],
    });
    const fixture = TestBed.createComponent(PosManualWeightModalComponent);
    fixture.componentRef.setInput('units', [
      { code: 'kg', name: 'Kilogramo', factorToBase: 1000, isPrincipal: true },
      { code: 'g', name: 'Gramo', factorToBase: 1, isPrincipal: false },
    ]);
    if (initialAmount !== undefined) {
      fixture.componentRef.setInput('initialAmount', initialAmount);
    }
    await fixture.whenStable();
    const input = document.body.querySelector(
      '#manual-weigh-amount',
    ) as HTMLInputElement;
    return { fixture, input };
  };

  afterEach(() => {
    document.body
      .querySelectorAll('#manual-weigh-amount')
      .forEach((el) => el.closest('app-pos-manual-weight-modal')?.remove());
  });

  it('abre vacío aunque llegue una cantidad actual, que queda como placeholder', async () => {
    const { input } = await render('1.5');
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Actual: 1.5');
  });

  it('borrar lo digitado deja el campo vacío al enfocarlo de nuevo', async () => {
    const { fixture, input } = await render('1.5');
    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.amountText()).toBe('2');

    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('focus'));
    await fixture.whenStable();
    expect(input.value).toBe('');
    expect(fixture.componentInstance.canConfirm()).toBeFalse();
  });

  it('sin cantidad actual el placeholder es 0', async () => {
    const { input } = await render();
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('0');
  });

  it('con el chip g se pueden digitar 1.500 g (tope en la principal, PR #1062 ronda 4)', async () => {
    const { fixture, input } = await render();
    fixture.componentInstance.unitCode.set('g');
    input.value = '1500';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.canConfirm()).toBeTrue();
    expect(document.body.textContent).not.toContain('El máximo es');

    input.value = '1000';
    fixture.componentInstance.unitCode.set('kg');
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.canConfirm()).toBeFalse();
    expect(document.body.textContent).toContain('El máximo es 999 kg');
  });
});

/**
 * PR #1062 ronda 6 (R1) — el tope de 999 es de peso: un producto medido en
 * metros acepta 1.200 m.
 */
describe('PosManualWeightModalComponent — medida que no es masa', () => {
  afterEach(() => {
    document.body
      .querySelectorAll('#manual-weigh-amount')
      .forEach((el) => el.closest('app-pos-manual-weight-modal')?.remove());
  });

  it('sin tope (maxAmount null) deja confirmar 1.200 m', async () => {
    TestBed.configureTestingModule({
      imports: [PosManualWeightModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CurrencyFormatService, useValue: { format: (v: number) => String(v) } },
      ],
    });
    const fixture = TestBed.createComponent(PosManualWeightModalComponent);
    fixture.componentRef.setInput('units', [
      { code: 'm', name: 'Metro', factorToBase: 1000, isPrincipal: true },
    ]);
    fixture.componentRef.setInput('maxAmount', null);
    await fixture.whenStable();
    const input = document.body.querySelector(
      '#manual-weigh-amount',
    ) as HTMLInputElement;
    input.value = '1200';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(fixture.componentInstance.overMax()).toBeFalse();
    expect(fixture.componentInstance.canConfirm()).toBeTrue();
    expect(document.body.textContent).not.toContain('El máximo es');
  });

  it('una cantidad inválida pide "cantidad", no "peso" (ronda 6, Q1)', async () => {
    TestBed.configureTestingModule({
      imports: [PosManualWeightModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CurrencyFormatService, useValue: { format: (v: number) => String(v) } },
      ],
    });
    const fixture = TestBed.createComponent(PosManualWeightModalComponent);
    fixture.componentRef.setInput('units', [
      { code: 'm', name: 'Metro', factorToBase: 1000, isPrincipal: true },
    ]);
    await fixture.whenStable();
    const input = document.body.querySelector(
      '#manual-weigh-amount',
    ) as HTMLInputElement;
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(document.body.textContent).toContain('Escribe una cantidad mayor a 0.');
    expect(document.body.textContent).not.toContain('Escribe un peso');
  });
});
