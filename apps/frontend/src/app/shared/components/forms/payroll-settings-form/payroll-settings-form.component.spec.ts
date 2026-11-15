import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import {
  PayrollSettingsFormComponent,
  PayrollSettingsValue,
} from './payroll-settings-form.component';

/**
 * QUI-414: a disabled (read-only / submitting) form must not report itself
 * as invalid, otherwise the wizard step keeps both the inputs and the
 * "Continuar" button locked.
 */
describe('PayrollSettingsFormComponent (validez)', () => {
  let emitted: boolean[];

  async function create(inputs: { disabled?: boolean; initialValue?: Partial<PayrollSettingsValue> | null }) {
    const fixture = TestBed.createComponent(PayrollSettingsFormComponent);
    emitted = [];
    fixture.componentInstance.validityChange.subscribe((v) => emitted.push(v));
    fixture.componentRef.setInput('disabled', inputs.disabled ?? false);
    fixture.componentRef.setInput('initialValue', inputs.initialValue ?? null);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('deshabilitado con valor inicial reporta válido', async () => {
    const fixture = await create({
      disabled: true,
      initialValue: { payment_frequency: 'QUINCENAL' },
    });
    expect(fixture.componentInstance.form.disabled).toBeTrue();
    expect(fixture.componentInstance.valid()).toBeTrue();
    expect(emitted.at(-1)).toBeTrue();
  });

  it('un valor realmente inválido sigue reportando inválido', async () => {
    const fixture = await create({});
    fixture.componentInstance.form.controls.pila_operator.setValue('x'.repeat(61));
    expect(fixture.componentInstance.valid()).toBeFalse();
    expect(emitted.at(-1)).toBeFalse();
  });

  it('al sembrar actualiza la frecuencia del resumen', async () => {
    const fixture = await create({ initialValue: { payment_frequency: 'SEMANAL' } });
    expect(fixture.componentInstance.paymentFrequency()).toBe('SEMANAL');
  });
});
