import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

import {
  CreditInvoiceModalComponent,
  DEFAULT_CREDIT_TERM_DAYS,
  localDatePlusDays,
} from './credit-invoice-modal.component';

describe('CreditInvoiceModalComponent — prefilled and Consumidor final option', () => {
  const setup = () => {
    TestBed.configureTestingModule({
      imports: [CreditInvoiceModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(CreditInvoiceModalComponent);
    fixture.componentRef.setInput('balance', 100000);
    fixture.componentRef.setInput('customerName', 'Juan Pérez');
    fixture.componentInstance.isOpen.set(true);
    fixture.detectChanges();
    return fixture;
  };

  it('opens with the recommended due date (today + 30 days) and payment means «Sin definir»', () => {
    const fixture = setup();
    const value = fixture.componentInstance.form.getRawValue();
    expect(DEFAULT_CREDIT_TERM_DAYS).toBe(30);
    expect(value.due_date).toBe(localDatePlusDays(30));
    expect(value.payment_means_code).toBe('');
    expect(fixture.componentInstance.form.valid).toBe(true);
  });

  it('confirms the prefilled data without editing anything', () => {
    const fixture = setup();
    const emitted: unknown[] = [];
    fixture.componentInstance.confirmed.subscribe((v) => emitted.push(v));
    (fixture.componentInstance as unknown as { onConfirm(): void }).onConfirm();
    expect(emitted).toEqual([{ due_date: localDatePlusDays(30) }]);
  });

  it('shows today as the issue date and offers «Emitir como Consumidor final (contado)»', () => {
    const fixture = setup();
    const text = (document.body.textContent ?? '') + (fixture.nativeElement.textContent ?? '');
    expect(text).toContain('Fecha de emisión');
    expect(text).toContain('Emitir como Consumidor final (contado)');
  });

  it('«Emitir como Consumidor final (contado)» emits finalConsumer', () => {
    const fixture = setup();
    let calls = 0;
    fixture.componentInstance.finalConsumer.subscribe(() => calls++);
    (fixture.componentInstance as unknown as { onUseFinalConsumer(): void }).onUseFinalConsumer();
    expect(calls).toBe(1);
  });

  it('order without an identified customer: asks to assign one instead of the credit form, keeps Consumidor final', () => {
    const fixture = setup();
    fixture.componentRef.setInput('customerRequired', true);
    fixture.detectChanges();
    const text = (document.body.textContent ?? '') + (fixture.nativeElement.textContent ?? '');
    expect(text).toContain('Esta orden no tiene un cliente identificado');
    expect(text).toContain('Asignar cliente');
    expect(text).toContain('Emitir como Consumidor final (contado)');
    let assign = 0;
    const emitted: unknown[] = [];
    fixture.componentInstance.assignCustomer.subscribe(() => assign++);
    fixture.componentInstance.confirmed.subscribe((v) => emitted.push(v));
    (fixture.componentInstance as unknown as { onAssignCustomer(): void }).onAssignCustomer();
    (fixture.componentInstance as unknown as { onConfirm(): void }).onConfirm();
    expect(assign).toBe(1);
    expect(emitted).toEqual([]);
  });
});
