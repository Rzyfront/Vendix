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
