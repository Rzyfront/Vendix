import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PopPaymentStepComponent } from './pop-payment-step.component';
import { CurrencyFormatService } from '../../../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../../../core/store/store-settings/store-settings.facade';

const buildCurrencyStub = () =>
  ({
    format: (n: number | string | null | undefined) =>
      `$${Number(n ?? 0).toFixed(2)}`,
    loadCurrency: () => undefined,
  }) as unknown as CurrencyFormatService;

const buildSettingsStub = () =>
  ({
    settings: () => ({ general: { timezone: 'America/Bogota' } }),
  }) as unknown as StoreSettingsFacade;

/**
 * Contrato del paso Pago del wizard POP — Bug #2.
 *
 * Reproduce el bug original: el puente `formStatus = toSignal(form.statusChanges)`
 * deduplicaba por `Object.is` y la `computed` `plan()` quedaba congelada en
 * `payment_plan: 'immediate'` aunque el operador eligiera 'partial', 'deferred'
 * o 'installments'. El control `mode` no tiene validadores, por lo que
 * `setValue` no emite en `statusChanges`. El puente `valueChanges`-tick
 * garantiza un valor distinto por emisión — los casos (b)-(d) abajo fallan
 * contra el código viejo y pasan con el fix.
 */
describe('PopPaymentStepComponent — payment plan reactive bridge', () => {
  let fixture: ComponentFixture<PopPaymentStepComponent>;
  let component: PopPaymentStepComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PopPaymentStepComponent],
      providers: [
        { provide: CurrencyFormatService, useFactory: buildCurrencyStub },
        { provide: StoreSettingsFacade, useFactory: buildSettingsStub },
      ],
    });
    fixture = TestBed.createComponent(PopPaymentStepComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('cartState', {
      summary: { total: 300000 },
    } as any);
    fixture.detectChanges();
  });

  function setMode(
    mode: 'immediate' | 'partial' | 'deferred' | 'installments',
  ): void {
    component.form.controls.mode.setValue(mode);
    fixture.detectChanges();
  }

  it('(a) initial plan es immediate con down_payment_amount=0 y sin cuotas', () => {
    expect(component.plan().payment_plan).toBe('immediate');
    expect(component.plan().down_payment_amount).toBe(0);
    expect(component.plan().payment_installments).toEqual([]);
  });

  it('(b) plan refleja "deferred" tras setValue y refleja la fecha', () => {
    setMode('deferred');
    expect(component.plan().payment_plan).toBe('deferred');
    component.form.controls.dueDate.setValue('2099-01-15');
    fixture.detectChanges();
    expect(component.plan().payment_due_date).toBe('2099-01-15');
    expect(component.plan().down_payment_amount).toBe(0);
    expect(component.plan().payment_installments).toEqual([]);
  });

  it('(c) plan refleja "installments" con N cuotas generadas', () => {
    setMode('installments');
    component.generateInstallments();
    fixture.detectChanges();
    expect(component.plan().payment_plan).toBe('installments');
    expect(component.plan().payment_installments.length).toBe(2);
    const sum = component.plan().payment_installments.reduce(
      (s, i) => s + Number(i.amount ?? 0),
      0,
    );
    expect(Math.abs(sum - 300000)).toBeLessThanOrEqual(0.01);
  });

  it('(d) plan refleja "partial" con down_payment_amount>0', () => {
    setMode('partial');
    component.form.controls.downPayment.setValue(50000);
    fixture.detectChanges();
    expect(component.plan().payment_plan).toBe('partial');
    expect(component.plan().down_payment_amount).toBe(50000);
    expect(component.plan().payment_installments).toEqual([]);
  });

  it('(e) isValid() bloquea "deferred" sin fecha y desbloquea con fecha', () => {
    setMode('deferred');
    expect(component.isValid()).toBe(false);
    component.form.controls.dueDate.setValue('2099-01-15');
    fixture.detectChanges();
    expect(component.isValid()).toBe(true);
  });

  it('(f) installmentsBalanced() en vivo: cuadre se actualiza al editar monto', () => {
    setMode('installments');
    component.generateInstallments();
    fixture.detectChanges();
    expect(component.installmentsBalanced()).toBe(true);
    const groups = component.form.controls.installments.controls;
    const ctrl = groups[0].controls['amount'];
    ctrl.setValue(Number(ctrl.value) + 1000);
    fixture.detectChanges();
    expect(component.installmentsBalanced()).toBe(false);
  });
});