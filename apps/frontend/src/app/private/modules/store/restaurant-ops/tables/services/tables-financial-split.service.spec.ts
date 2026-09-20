import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TablesService } from './tables.service';
import { environment } from '../../../../../../../environments/environment';

describe('TablesService financial account routes', () => {
  let service: TablesService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/store/orders/41/split`;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TablesService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reads a nullable persisted group, not an order with the account id', () => {
    let result: unknown = undefined;
    service.getFinancialSplit(41).subscribe((value) => (result = value));
    const req = http.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: null });
    expect(result).toBeNull();
  });

  it('previews exact custom amounts with an independent payer per account', () => {
    const dto = {
      mode: 'custom' as const,
      n_splits: 2,
      amounts: [4000, 4000],
      accounts: [{ customer_id: 7 }, { customer_id: 8 }],
    };
    service.previewFinancialSplit(41, dto).subscribe();
    const req = http.expectOne(`${base}/preview`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ data: {} });
  });

  it('keeps the source version and idempotency key on confirmation', () => {
    const dto = {
      mode: 'equal' as const,
      n_splits: 2,
      source_version: 'v1',
      idempotency_key: 'test-key-1',
    };
    service.splitByAmount(41, dto).subscribe();
    const req = http.expectOne(
      `${environment.apiUrl}/store/orders/41/split-by-amount`,
    );
    expect(req.request.body).toEqual(dto);
    req.flush({ data: {} });
  });

  it('pays a financial account without substituting it for source_order_id', () => {
    const dto = {
      store_payment_method_id: 4,
      amount: 4000,
      idempotency_key: 'test-key-pay',
      wompi_payment_method: { type: 'NEQUI', phone_number: '3001234567' },
    };
    service.payFinancialAccount(41, 902, dto).subscribe();
    const req = http.expectOne(`${base}/accounts/902/pay`);
    expect(req.request.body).toEqual(dto);
    req.flush({ data: {} });
  });

  it('updates the account customer without mutating source-order metadata', () => {
    service
      .updateFinancialAccountCustomer(41, 902, { customer_id: 8 })
      .subscribe();
    const req = http.expectOne(`${base}/accounts/902/customer`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ customer_id: 8 });
    req.flush({ data: {} });
  });

  it('confirms only the named pending payment on the account endpoint', () => {
    service.confirmFinancialAccountPayment(41, 902, 71).subscribe();
    const req = http.expectOne(`${base}/accounts/902/payments/71/confirm`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: {} });
  });

  it('creates a draft invoice via the real invoicing base route', () => {
    service.invoiceFinancialAccount(902).subscribe();
    const req = http.expectOne(
      `${environment.apiUrl}/store/invoicing/from-financial-account/902`,
    );
    expect(req.request.method).toBe('POST');
    req.flush({ data: { id: 72, status: 'draft' } });
  });

  it('keeps recovery separate from the read endpoint', () => {
    service.reconcileFinancialSplit(41).subscribe();
    const req = http.expectOne(`${base}/reconcile`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: {} });
  });

  it('does not turn an API rejection into success', () => {
    let failure: { status?: number } | undefined;
    service
      .payFinancialAccount(41, 902, {
        store_payment_method_id: 4,
        amount: 4000,
        idempotency_key: 'test-key-pay',
      })
      .subscribe({ error: (error) => (failure = error) });
    http
      .expectOne(`${base}/accounts/902/pay`)
      .flush(
        { error_code: 'SPLIT_ORDER_ITEMS_MISSING' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(failure?.status).toBe(409);
  });
});
