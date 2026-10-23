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

  // QUI-713 — cambiar CUOTAS / CADA (DÍAS) recalcula sin pulsar "Generar".
  // El bloque `@if (installments)` del template lee `form.controls.mode.value`
  // (no signal) y en zoneless no se re-renderiza tras `setValue`; se invoca el
  // handler del `(change)` con un evento falso, igual que el binding del template.
  function commitInput(field: 'count' | 'everyDays', value: number): void {
    const event = { target: { value: String(value) } } as unknown as Event;
    component.onInstallmentParamsChange(event, field);
    fixture.detectChanges();
  }

  it('(g) QUI-713: cambiar CUOTAS a 4 regenera 4 filas que cuadran con el saldo', () => {
    setMode('installments');
    component.generateInstallments();
    fixture.detectChanges();
    expect(component.form.controls.installments.length).toBe(2);

    commitInput('count', 4);

    const rows = component.plan().payment_installments;
    expect(rows.length).toBe(4);
    const sum = rows.reduce((s, i) => s + Number(i.amount ?? 0), 0);
    expect(Math.abs(sum - component.pendingBalance())).toBeLessThanOrEqual(0.01);
    const dates = rows.map((r) => r.scheduled_date);
    expect(new Set(dates).size).toBe(4);
    expect([...dates].sort()).toEqual(dates);
  });

  it('(h) QUI-713: cambiar CADA (DÍAS) regenera las fechas con el nuevo intervalo', () => {
    setMode('installments');
    component.generateInstallments();
    fixture.detectChanges();
    const before = component.plan().payment_installments.map((r) => r.scheduled_date);

    commitInput('everyDays', 10);

    const after = component.plan().payment_installments.map((r) => r.scheduled_date);
    expect(after.length).toBe(2);
    expect(after).not.toEqual(before);
    const diffDays = Math.round(
      (Date.parse(after[1]) - Date.parse(after[0])) / 86_400_000,
    );
    expect(diffDays).toBe(10);
  });

  it('(i) QUI-713: fuera de modo installments el change no genera filas', () => {
    setMode('installments');
    commitInput('count', 3);
    setMode('partial');
    expect(component.form.controls.installments.length).toBe(3);
    component.form.controls.installments.clear();
    component.onInstallmentParamsChange(
      { target: { value: '5' } } as unknown as Event,
      'count',
    );
    expect(component.form.controls.installments.length).toBe(0);
  });
});
