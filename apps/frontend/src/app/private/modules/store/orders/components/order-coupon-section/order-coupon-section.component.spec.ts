import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OrderCouponSectionComponent } from './order-coupon-section.component';
import type { Order } from '../../interfaces/order.interface';

describe('OrderCouponSectionComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderCouponSectionComponent],
      providers: [provideZonelessChangeDetection()],
    })
      .overrideComponent(OrderCouponSectionComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
  });

  it('derives applied coupon from coupon_uses when present', () => {
    const fixture = TestBed.createComponent(OrderCouponSectionComponent);
    fixture.componentRef.setInput('order', {
      id: 1,
      discount_amount: 100,
      coupon_uses: [
        {
          id: 5,
          coupon_id: 11,
          discount_applied: 119,
          coupon: {
            id: 11,
            code: 'DESC10',
            name: '10% OFF',
            discount_type: 'PERCENTAGE',
            discount_value: 10,
          },
        },
      ],
    } as unknown as Order);
    fixture.detectChanges();

    expect(fixture.componentInstance.appliedCoupon()).toEqual({
      code: 'DESC10',
      name: '10% OFF',
      percent: '10',
      discountAmount: 119,
    });
    fixture.destroy();
  });

  it('falls back to pending order.coupon / order.coupon_code on draft orders without coupon_uses', () => {
    const fixture = TestBed.createComponent(OrderCouponSectionComponent);
    fixture.componentRef.setInput('order', {
      id: 2,
      state: 'draft',
      discount_amount: 100,
      coupon_id: 11,
      coupon_code: 'BORRADOR10',
      coupon: {
        id: 11,
        code: 'BORRADOR10',
        name: 'Cupón borrador',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
      },
      order_promotions: [],
      coupon_uses: [],
    } as unknown as Order);
    fixture.detectChanges();

    expect(fixture.componentInstance.appliedCoupon()).toEqual({
      code: 'BORRADOR10',
      name: 'Cupón borrador',
      percent: '10',
      discountAmount: 100,
    });
    fixture.destroy();
  });

  it('emits uppercased trimmed code on apply and emits removeCoupon on remove', () => {
    const fixture = TestBed.createComponent(OrderCouponSectionComponent);
    const component = fixture.componentInstance;
    const applied: string[] = [];
    let removed = 0;
    component.applyCoupon.subscribe((c) => applied.push(c));
    component.removeCoupon.subscribe(() => removed++);

    component.couponCode.set('  promo15  ');
    component.onApply();
    expect(applied).toEqual(['PROMO15']);

    component.onRemove();
    expect(removed).toBe(1);
    fixture.destroy();
  });

  it('does not emit while loading or disabled', () => {
    const fixture = TestBed.createComponent(OrderCouponSectionComponent);
    fixture.componentRef.setInput('isLoading', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const applied: string[] = [];
    let removed = 0;
    component.applyCoupon.subscribe((c) => applied.push(c));
    component.removeCoupon.subscribe(() => removed++);

    component.couponCode.set('PROMO15');
    component.onApply();
    component.onRemove();
    expect(applied).toEqual([]);
    expect(removed).toBe(0);
    fixture.destroy();
  });
});
