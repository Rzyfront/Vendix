import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { OrderDetailComponent } from './order-detail.component';
import { AccountService, OrderDetail } from '../../../services/account.service';
import { EcommerceBookingService } from '../../../services/ecommerce-booking.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

const orderFixture = (types: ('physical' | 'service' | 'prepared' | null)[] = ['physical'], state = 'pending'): OrderDetail => ({
  id: 95, order_number: 'ORD95', state: 'pending_payment', grand_total: 119, currency: 'COP',
  created_at: '2026-10-07T19:00:00Z', placed_at: null, completed_at: null, item_count: types.length, first_item_name: 'Producto',
  subtotal_amount: 100, discount_amount: 0, tax_amount: 19, shipping_cost: 0, shipping_address: null, invoice_url: null,
  items: types.map((product_type, index) => ({ id: index + 1, product_id: 10, product_name: 'Producto', variant_sku: null, variant_attributes: null,
    quantity: 1, unit_price: 100, total_price: 100, unit_price_gross: 119, line_total_gross: 119, image_url: null, product_type })),
  payments: [{ id: 63, amount: 119, state, method: 'Mi transferencia', method_type: 'bank_transfer', paid_at: null, reference: null }], bookings: [],
});

describe('OrderDetailComponent account mapper and Wompi confirmation', () => {
  let component: OrderDetailComponent;
  let account: jasmine.SpyObj<Pick<AccountService, 'getOrderDetail'>>;
  let queryParams: BehaviorSubject<Params>;
  let snapshot: { params: Params; queryParams: Params };
  let toast: jasmine.SpyObj<Pick<ToastService, 'warning' | 'error' | 'success'>>;

  beforeEach(() => {
    jasmine.clock().install(); jasmine.clock().mockDate(new Date('2026-10-07T19:00:00Z'));
    account = jasmine.createSpyObj('AccountService', ['getOrderDetail']);
    account.getOrderDetail.and.returnValue(of({ success: true, data: orderFixture() }));
    queryParams = new BehaviorSubject<Params>({}); snapshot = { params: { id: '95' }, queryParams: {} };
    toast = jasmine.createSpyObj('ToastService', ['warning', 'error', 'success']);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: ToastService, useValue: toast }] });
    component = TestBed.runInInjectionContext(() => new OrderDetailComponent(
      account as unknown as AccountService, {} as EcommerceBookingService,
      { snapshot, queryParams } as unknown as ActivatedRoute, {} as Router,
    ));
  });
  afterEach(() => {
    try { component.ngOnDestroy(); queryParams.complete(); TestBed.resetTestingModule(); }
    finally { jasmine.clock().uninstall(); }
  });
  function startCallback(params: Params = { wompi_callback: 'true' }): void {
    snapshot.queryParams = params; queryParams.next(params); component.ngOnInit();
  }

  it('preserves service-only types for parent physical gate and child mapper', () => {
    component.order.set(orderFixture(['service']));
    expect(component.hasOnlyServices()).toBeTrue(); expect(component.hasServiceItems()).toBeTrue(); expect(component.hasPhysicalItems()).toBeFalse();
    expect(component.guestSummary()?.order.items[0].product_type).toBe('service');
  });
  it('keeps both service and physical behavior for mixed orders', () => {
    component.order.set(orderFixture(['service', 'prepared']));
    expect(component.hasOnlyServices()).toBeFalse(); expect(component.hasServiceItems()).toBeTrue(); expect(component.hasPhysicalItems()).toBeTrue();
    expect(component.guestSummary()?.order.items.map(item => item.product_type)).toEqual(['service', 'prepared']);
  });
  it('preserves physical and unknown historical item compatibility', () => {
    component.order.set(orderFixture(['physical'])); expect(component.hasPhysicalItems()).toBeTrue();
    component.order.set(orderFixture([null])); expect(component.hasPhysicalItems()).toBeTrue();
  });
  it('maps actual backend gross aliases without recomputing taxes and preserves method_type', () => {
    component.order.set(orderFixture());
    expect(component.guestSummary()?.order.items[0].unit_price).toBe(119);
    expect(component.guestSummary()?.order.items[0].total_price).toBe(119);
    expect(component.guestSummary()?.order.payments?.[0].method_type).toBe('bank_transfer');
  });
  it('uses zero gross as authoritative, then shadow/net fallbacks when aliases are absent', () => {
    const order = orderFixture(); order.items[0].unit_price_gross = 0; order.items[0].line_total_gross = 0;
    component.order.set(order); expect(component.guestSummary()?.order.items[0].unit_price).toBe(0);
    const fallback = orderFixture(); delete fallback.items[0].unit_price_gross; delete fallback.items[0].line_total_gross;
    component.order.set(fallback); expect(component.guestSummary()?.order.items[0].unit_price).toBe(100);
    component.order.set({ ...fallback, items: [{ ...fallback.items[0], final_unit_price: 110, final_total_price: 110 }] });
    expect(component.guestSummary()?.order.items[0].total_price).toBe(110);
  });
  it('confirms Wompi succeeded reactively without a success query parameter', () => {
    account.getOrderDetail.and.returnValues(of({ success: true, data: orderFixture() }), of({ success: true, data: orderFixture(['physical'], 'succeeded') }));
    startCallback(); expect(component.is_new_order()).toBeFalse(); jasmine.clock().tick(5000);
    expect(component.is_new_order()).toBeTrue(); expect(component.verifyingWompiPayment()).toBeFalse();
    jasmine.clock().tick(20_000); expect(account.getOrderDetail).toHaveBeenCalledTimes(2);
  });
  it('does not accept success=true before callback verification actually succeeds', () => {
    startCallback({ wompi_callback: 'true', success: 'true' });
    expect(component.is_new_order()).toBeFalse();
  });
  it('preserves checkout success without a Wompi callback', () => {
    snapshot.queryParams = { success: 'true' }; queryParams.next(snapshot.queryParams); component.ngOnInit();
    expect(component.is_new_order()).toBeTrue();
  });
  for (const state of ['failed', 'cancelled', 'refunded']) {
    it(`never shows purchase confirmation after payment ${state}`, () => {
      account.getOrderDetail.and.returnValue(of({ success: true, data: orderFixture(['physical'], state) }));
      startCallback(); jasmine.clock().tick(5000);
      expect(component.is_new_order()).toBeFalse(); expect(component.verifyingWompiPayment()).toBeFalse();
    });
  }
  it('does not show confirmation for a mixed completed/failed payment result', () => {
    const order = orderFixture(['physical'], 'succeeded'); order.payments.push({ ...order.payments[0], id: 64, state: 'failed' });
    account.getOrderDetail.and.returnValue(of({ success: true, data: order })); startCallback(); jasmine.clock().tick(5000);
    expect(component.is_new_order()).toBeFalse();
  });
  it('stops after60 pending responses without a confirmation banner', () => {
    startCallback(); jasmine.clock().tick(300_000);
    expect(component.is_new_order()).toBeFalse(); expect(component.verifyingWompiPayment()).toBeFalse(); expect(toast.warning).toHaveBeenCalled();
    expect(account.getOrderDetail).toHaveBeenCalledTimes(61);
  });
  it('stops after60 failed HTTP/body responses without claiming success', () => {
    account.getOrderDetail.and.returnValue(of({ success: false, data: orderFixture() }));
    startCallback(); jasmine.clock().tick(300_000);
    expect(component.is_new_order()).toBeFalse(); expect(component.verifyingWompiPayment()).toBeFalse(); expect(toast.warning).toHaveBeenCalled();
  });
  it('does not start duplicate timers on repeated callback params', () => {
    startCallback(); queryParams.next({ wompi_callback: 'true' }); queryParams.next({ wompi_callback: 'true' });
    jasmine.clock().tick(5000); expect(account.getOrderDetail).toHaveBeenCalledTimes(2);
  });
  it('cleans polling interval and pending responses when destroyed', () => {
    const pending = new Subject<{ success: boolean; data: OrderDetail }>();
    account.getOrderDetail.and.returnValues(of({ success: true, data: orderFixture() }), pending);
    startCallback(); jasmine.clock().tick(5000); expect(pending.observed).toBeTrue();
    component.ngOnDestroy(); TestBed.resetTestingModule(); expect(pending.observed).toBeFalse();
    pending.next({ success: true, data: orderFixture(['physical'], 'succeeded') }); jasmine.clock().tick(10_000);
    expect(component.is_new_order()).toBeFalse(); expect(account.getOrderDetail).toHaveBeenCalledTimes(2);
  });
  it('ignores an older in-flight callback after a terminal failed result', () => {
    const older = new Subject<{ success: boolean; data: OrderDetail }>();
    const newer = new Subject<{ success: boolean; data: OrderDetail }>();
    account.getOrderDetail.and.returnValues(of({ success: true, data: orderFixture() }), older, newer);
    startCallback(); jasmine.clock().tick(10_000);
    newer.next({ success: true, data: orderFixture(['physical'], 'failed') });
    older.next({ success: true, data: orderFixture(['physical'], 'succeeded') });
    expect(component.is_new_order()).toBeFalse();
    expect(component.order()?.payments[0].state).toBe('failed');
  });
  it('does not let a late HTTP error erase an already confirmed payment', () => {
    const pending = new Subject<{ success: boolean; data: OrderDetail }>();
    let calls = 0;
    account.getOrderDetail.and.callFake(() => ++calls === 1 ? of({ success: true, data: orderFixture() }) : pending);
    startCallback(); jasmine.clock().tick(300_000);
    pending.next({ success: true, data: orderFixture(['physical'], 'succeeded') });
    pending.error(new Error('older request failed'));
    expect(component.is_new_order()).toBeTrue();
  });
  it('cleans a pending initial detail load via real Angular DestroyRef', () => {
    const pending = new Subject<{ success: boolean; data: OrderDetail }>(); account.getOrderDetail.and.returnValue(pending);
    component.loadOrder(95); TestBed.resetTestingModule(); expect(pending.observed).toBeFalse();
    pending.next({ success: true, data: orderFixture() }); expect(component.order()).toBeNull();
  });
  it('stops repeated HTTP errors at the same attempt bound', () => {
    account.getOrderDetail.and.returnValue(throwError(() => new Error('network'))); startCallback(); jasmine.clock().tick(300_000);
    expect(component.is_new_order()).toBeFalse(); expect(component.verifyingWompiPayment()).toBeFalse();
  });
});
