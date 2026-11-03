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
});
