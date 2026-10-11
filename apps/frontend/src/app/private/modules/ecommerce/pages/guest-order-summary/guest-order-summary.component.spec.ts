import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { Subject, of, throwError } from 'rxjs';
import { GuestOrderSummaryComponent, GuestOrderSummary, GuestOrderPayment } from './guest-order-summary.component';
import { AccountService } from '../../services/account.service';
import { CheckoutService } from '../../services/checkout.service';
import { GuestOrderSseService } from '../../services/guest-order-sse.service';
import { OrderReviewsService } from '../../services/order-reviews.service';
import { GuestOrderPrintService } from '../../services/guest-order-print.service';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

const SUMMARY: GuestOrderSummary = {
  token: '', order: { order_number: 'ORD95', state: 'pending_payment', items: [],
    discount_amount: 0, subtotal_amount: 100, tax_amount: 19, shipping_cost: 0, grand_total: 119,
    prep_minutes_max: 15, estimated_ready_at: '2026-10-07T20:00:00Z',
    payments: [{ payment_id: 63, state: 'pending', method: 'Transferencia', method_type: 'bank_transfer', has_receipt: true }],
  },
};

describe('GuestOrderSummaryComponent embedded physical/purchase/receipt gates', () => {
  let fixture: ComponentFixture<GuestOrderSummaryComponent>;
  let component: GuestOrderSummaryComponent;
  let account: jasmine.SpyObj<Pick<AccountService, 'uploadPaymentReceipt' | 'getPaymentReceiptUrl'>>;
  let checkout: jasmine.SpyObj<Pick<CheckoutService, 'getGuestOrderSummary' | 'uploadGuestPaymentReceipt'>>;
  let printer: jasmine.SpyObj<GuestOrderPrintService>;
  let toast: jasmine.SpyObj<Pick<ToastService, 'success' | 'error' | 'warning'>>;
  let config: Record<string, unknown>;
  let queryParams: Record<string, string>;
  let sse: { connect: jasmine.Spy; disconnect: jasmine.Spy; markReceiptUploaded: jasmine.Spy };
  const uploadResponse = { success: true, data: { payment_id: 63, has_receipt: true, receipt_content_type: 'application/pdf', receipt_uploaded_at: '2026-10-07T19:00:00Z' } };
  const file = () => new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    jasmine.clock().install(); jasmine.clock().mockDate(new Date('2026-10-07T19:00:00Z'));
    account = jasmine.createSpyObj('AccountService', ['uploadPaymentReceipt', 'getPaymentReceiptUrl']);
    account.uploadPaymentReceipt.and.returnValue(of(uploadResponse));
    account.getPaymentReceiptUrl.and.returnValue(of({ success: true, data: { url: 'https://signed.example/receipt.pdf', expires_at: '2026-10-07T19:05:00Z', content_type: 'application/pdf' } }));
    checkout = jasmine.createSpyObj('CheckoutService', ['getGuestOrderSummary', 'uploadGuestPaymentReceipt']);
    checkout.getGuestOrderSummary.and.returnValue(of({ success: true, data: SUMMARY }));
    checkout.uploadGuestPaymentReceipt.and.returnValue(of(uploadResponse));
    printer = jasmine.createSpyObj('GuestOrderPrintService', ['printVoucher']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
    config = {}; queryParams = {};
    sse = { connect: jasmine.createSpy('connect'), disconnect: jasmine.createSpy('disconnect'), markReceiptUploaded: jasmine.createSpy('markReceiptUploaded') };
    TestBed.configureTestingModule({ providers: [
      provideZonelessChangeDetection(),
      { provide: AccountService, useValue: account }, { provide: CheckoutService, useValue: checkout },
      { provide: GuestOrderPrintService, useValue: printer }, { provide: ToastService, useValue: toast },
      { provide: TenantFacade, useValue: { getCurrentDomainConfig: () => config } },
      { provide: CurrencyFormatService, useValue: { currencyCode: signal('COP'), loadCurrency: jasmine.createSpy('loadCurrency') } },
      { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (value: string) => value } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token: 'guest-token' }), get queryParamMap() { return convertToParamMap(queryParams); } } } },
      { provide: OrderReviewsService, useValue: { getStatusByToken: () => throwError(() => new Error('reviews off')), getStatusByOrder: () => throwError(() => new Error('reviews off')) } },
      { provide: GuestOrderSseService, useValue: { ...sse, orderState: signal(null), deliveryType: signal(null), kitchenByProduct: signal({}), paymentsLive: signal([]), eta: signal(null), connectionState: signal('idle'), prefersReducedMotion: signal(false) } },
    ] });
    // Shallow view only: actual component inputs/computed/effect/lifecycle are
    // compiled by Angular, without rendering the heavyweight invoice/SSE widgets.
    TestBed.overrideComponent(GuestOrderSummaryComponent, { set: { imports: [], styles: [], template: `
      @if (justPurchased()) { <span class="confirmed">Compra confirmada</span> }
      @if (trackingShown()) { <span class="tracking">Progreso físico</span> }
      @if (etaVisible()) { <span class="eta">Preparación</span> }
    ` } });
  });

  afterEach(() => {
    try { TestBed.resetTestingModule(); }
    finally { jasmine.clock().uninstall(); }
  });

  function create(embedded = true): void {
    fixture = TestBed.createComponent(GuestOrderSummaryComponent); component = fixture.componentInstance;
    fixture.componentRef.setInput('embedded', embedded);
    if (embedded) fixture.componentRef.setInput('summaryInput', SUMMARY);
    fixture.detectChanges();
  }
  const payment = (method_type: string | null = 'bank_transfer', state = 'pending'): GuestOrderPayment => ({ payment_id: 63, state, method_type, has_receipt: true });

  it('hides tracking/ETA and print preparation for service-only opt-out', () => {
    create(); fixture.componentRef.setInput('physicalProgressAllowed', false); fixture.detectChanges();
    expect(component.trackingShown()).toBeFalse(); expect(component.etaVisible()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.tracking')).toBeNull(); expect(fixture.nativeElement.querySelector('.eta')).toBeNull();
    component.print(); expect(printer.printVoucher).toHaveBeenCalledWith(SUMMARY, { hidePrepEta: true, hideTracking: false });
  });

  it('allows physical and mixed progress reactively without recreating the component', () => {
    create(); fixture.componentRef.setInput('physicalProgressAllowed', false); fixture.detectChanges();
    fixture.componentRef.setInput('physicalProgressAllowed', true); fixture.detectChanges();
    expect(component.trackingShown()).toBeTrue(); expect(component.etaVisible()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.tracking')).not.toBeNull();
    component.print(); expect(printer.printVoucher).toHaveBeenCalledWith(SUMMARY, { hidePrepEta: false, hideTracking: false });
  });

  it('retains store opt-outs even when physical progress is allowed', () => {
    config = { customConfig: { ecommerce: { orders: { hide_prep_eta: true, hide_tracking_progress: true } } } };
    create(); expect(component.trackingShown()).toBeFalse(); expect(component.etaVisible()).toBeFalse();
    component.print(); expect(printer.printVoucher).toHaveBeenCalledWith(SUMMARY, { hidePrepEta: true, hideTracking: true });
  });

  it('changes the confirmation banner through public reactive input without query success', () => {
    create(); expect(component.justPurchased()).toBeFalse();
    fixture.componentRef.setInput('purchaseConfirmed', true); fixture.detectChanges();
    expect(component.justPurchased()).toBeTrue(); expect(fixture.nativeElement.querySelector('.confirmed')).not.toBeNull();
    fixture.componentRef.setInput('purchaseConfirmed', false); fixture.detectChanges();
    expect(component.justPurchased()).toBeFalse(); expect(fixture.nativeElement.querySelector('.confirmed')).toBeNull();
  });

  it('does not trust query success for embedded purchases without parent confirmation', () => {
    queryParams = { success: 'true' }; create();
    expect(component.justPurchased()).toBeFalse();
  });

  it('preserves legacy standalone query confirmation and unknown physical-type behavior', () => {
    queryParams = { success: 'true' }; create(false);
    expect(component.justPurchased()).toBeTrue(); expect(component.trackingShown()).toBeTrue(); expect(component.etaVisible()).toBeTrue();
    expect(sse.connect).toHaveBeenCalled(); expect(checkout.getGuestOrderSummary).toHaveBeenCalledWith('guest-token');
  });

  it('does not fetch or connect guest SSE in embedded mode', () => {
    create(); expect(checkout.getGuestOrderSummary).not.toHaveBeenCalled(); expect(sse.connect).not.toHaveBeenCalled();
  });

  it('accepts only canonical bank_transfer/voucher for embedded uploads, not display labels', () => {
    create();
    expect(component.receiptUploadAllowed('pending_payment', payment('bank_transfer'))).toBeTrue();
    expect(component.receiptUploadAllowed('pending_payment', payment('voucher'))).toBeTrue();
    for (const type of ['cash', 'card', 'payment_gateway', null]) {
      expect(component.receiptUploadAllowed('pending_payment', { ...payment(type), method: 'Transferencia' })).toBeFalse();
    }
  });

  it('keeps order/payment terminal policies while allowing a legitimate receipt viewer', async () => {
    create();
    for (const state of ['cancelled', 'refunded', 'finished', 'delivered']) expect(component.receiptUploadAllowed(state, payment())).toBeFalse();
    for (const state of ['succeeded', 'captured', 'refunded', 'cancelled']) expect(component.receiptUploadAllowed('pending_payment', payment('bank_transfer', state))).toBeFalse();
    await component.viewReceipt(payment('cash', 'succeeded'));
    expect(account.getPaymentReceiptUrl).toHaveBeenCalledWith(63); expect(component.showReceiptModal()).toBeTrue();
  });

  it('guards the upload handler using current canonical method, not forged event metadata', async () => {
    create(); fixture.componentRef.setInput('summaryInput', { ...SUMMARY, order: { ...SUMMARY.order, payments: [payment('cash')] } });
    await component.onReceiptFile(payment('bank_transfer'), file());
    expect(account.uploadPaymentReceipt).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });

  it('uploads allowed receipts and emits parent refresh only after actual success', async () => {
    create(); const emitted: number[] = []; component.receiptUploaded.subscribe(value => emitted.push(value));
    await component.onReceiptFile(payment(), file());
    expect(account.uploadPaymentReceipt).toHaveBeenCalledTimes(1); expect(emitted).toEqual([63]); expect(toast.success).toHaveBeenCalled();
    expect(component.uploadingReceiptId()).toBeNull();
  });

  it('does not emit success/refresh after an upload failure', async () => {
    create(); account.uploadPaymentReceipt.and.returnValue(throwError(() => new Error('upload failed')));
    const emitted: number[] = []; component.receiptUploaded.subscribe(value => emitted.push(value));
    await component.onReceiptFile(payment(), file());
    expect(emitted).toEqual([]); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).toHaveBeenCalled(); expect(component.uploadingReceiptId()).toBeNull();
  });

  it('blocks a concurrent upload while the first is pending', async () => {
    create(); const pending = new Subject<typeof uploadResponse>(); account.uploadPaymentReceipt.and.returnValue(pending);
    const first = component.onReceiptFile(payment(), file());
    const second = component.onReceiptFile(payment(), file());
    expect(account.uploadPaymentReceipt).toHaveBeenCalledTimes(1);
    pending.next(uploadResponse); pending.complete(); await Promise.all([first, second]);
  });

  it('validates MIME/5MB without calling backend upload', async () => {
    create(); await component.onReceiptFile(payment(), new File(['x'], 'receipt.txt', { type: 'text/plain' }));
    await component.onReceiptFile(payment(), new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], 'receipt.pdf', { type: 'application/pdf' }));
    expect(account.uploadPaymentReceipt).not.toHaveBeenCalled(); expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('preserves legacy standalone method absence while blocking a known unsupported method', () => {
    create(false); expect(component.receiptUploadAllowed('pending_payment', payment(null))).toBeTrue();
    expect(component.receiptUploadAllowed('pending_payment', payment('cash'))).toBeFalse();
  });

  it('disconnects standalone SSE on fixture destruction', () => {
    create(false); fixture.destroy(); expect(sse.disconnect).toHaveBeenCalled();
  });
});
