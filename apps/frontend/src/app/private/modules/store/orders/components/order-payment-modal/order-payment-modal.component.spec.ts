import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PaymentSubmit } from '../../../../../../shared/components';
import { OrderPaymentModalComponent } from './order-payment-modal.component';

describe('OrderPaymentModalComponent credit abonos', () => {
  const payment = (amount: number): PaymentSubmit => ({
    amount,
    storePaymentMethodId: 2,
    methodType: 'bank_transfer',
    mode: 'contado',
    method: {
      id: '2',
      name: 'Transferencia',
      type: 'bank_transfer',
      icon: 'banknote',
      enabled: true,
    },
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderPaymentModalComponent],
      providers: [provideZonelessChangeDetection()],
    })
      .overrideComponent(OrderPaymentModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });

  it('blocks an excess abono locally, but accepts the exact outstanding amount', () => {
    const fixture = TestBed.createComponent(OrderPaymentModalComponent);
    fixture.componentRef.setInput('isCreditOrder', true);
    fixture.componentRef.setInput('remainingBalance', 18000);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const emitted: PaymentSubmit[] = [];
    component.paymentSubmitted.subscribe((value) => emitted.push(value));

    expect(component.creditAmountExceedsBalance(18000.01)).toBeTrue();
    component.submitPayment(payment(18000.01));
    expect(emitted).toHaveSize(0);
    component.submitPayment(payment(18000));
    expect(emitted).toHaveSize(1);
    expect(emitted[0].amount).toBe(18000);
    fixture.destroy();
  });

  it('does not fall back to the grand total once a credit is fully paid', () => {
    const fixture = TestBed.createComponent(OrderPaymentModalComponent);
    fixture.componentRef.setInput('isCreditOrder', true);
    fixture.componentRef.setInput('remainingBalance', 0);
    fixture.detectChanges();
    expect(fixture.componentInstance.chargeAmount()).toBe(0);
    expect(fixture.componentInstance.creditAmountExceedsBalance(1)).toBeTrue();
    fixture.destroy();
  });

  it('does not apply the credit cap to a contado payment', () => {
    const fixture = TestBed.createComponent(OrderPaymentModalComponent);
    fixture.componentRef.setInput('isCreditOrder', false);
    fixture.componentRef.setInput('remainingBalance', 100);
    fixture.detectChanges();
    const emitted: PaymentSubmit[] = [];
    fixture.componentInstance.paymentSubmitted.subscribe((value) => emitted.push(value));
    expect(fixture.componentInstance.creditAmountExceedsBalance(200)).toBeFalse();
    fixture.componentInstance.submitPayment(payment(200));
    expect(emitted).toHaveSize(1);
    fixture.destroy();
  });
});

describe('OrderPaymentModalComponent Fase 2 (paso 8) — cobro manual', () => {
  const payment = (amount: number): PaymentSubmit => ({
    amount,
    storePaymentMethodId: 1,
    methodType: 'cash',
    mode: 'contado',
    method: {
      id: '1',
      name: 'Efectivo',
      type: 'cash',
      icon: 'banknote',
      enabled: true,
    },
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderPaymentModalComponent],
      providers: [provideZonelessChangeDetection()],
    })
      .overrideComponent(OrderPaymentModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });

  function setup(remaining: number, grandTotal: number): OrderPaymentModalComponent {
    const fixture = TestBed.createComponent(OrderPaymentModalComponent);
    fixture.componentRef.setInput('isCreditOrder', false);
    fixture.componentRef.setInput('manualPaymentPending', true);
    fixture.componentRef.setInput('remainingBalance', remaining);
    fixture.componentRef.setInput('order', { grand_total: grandTotal } as never);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('sugiere el saldo, bloquea el exceso y deja pasar el parcial', () => {
    const component = setup(100000, 100000);
    expect(component.chargeAmount()).toBe(100000);
    expect(component.collectorRemaining()).toBe(100000);
    expect(component.manualAmountExceedsBalance(100000.01)).toBeTrue();
    expect(component.manualAmountExceedsBalance(100000)).toBeFalse();
    expect(component.manualAmountExceedsBalance(60000)).toBeFalse();
    expect(component.manualRemainingAfter(60000)).toBe(40000);
    expect(component.manualRemainingAfter(100000)).toBe(0);
    expect(component.submitLabel()).toBe('Registrar Pago');

    const emitted: PaymentSubmit[] = [];
    component.paymentSubmitted.subscribe((value) => emitted.push(value));
    component.submitPayment(payment(100000.01));
    expect(emitted).toHaveSize(0);
    component.submitPayment(payment(60000));
    expect(emitted).toHaveSize(1);
    expect(emitted[0].amount).toBe(60000);
  });

  it('cae al gran total cuando el saldo aún no está computado', () => {
    const component = setup(0, 85000);
    expect(component.chargeAmount()).toBe(85000);
    expect(component.collectorRemaining()).toBe(85000);
    expect(component.manualAmountExceedsBalance(85001)).toBeTrue();
    expect(component.manualAmountExceedsBalance(85000)).toBeFalse();
  });

  it('no aplica el tope manual fuera del contexto manual', () => {
    const fixture = TestBed.createComponent(OrderPaymentModalComponent);
    fixture.componentRef.setInput('isCreditOrder', false);
    fixture.componentRef.setInput('manualPaymentPending', false);
    fixture.componentRef.setInput('remainingBalance', 100);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.manualAmountExceedsBalance(200)).toBeFalse();
    expect(component.submitLabel()).toBe('Confirmar Pago');
    fixture.destroy();
  });
});
