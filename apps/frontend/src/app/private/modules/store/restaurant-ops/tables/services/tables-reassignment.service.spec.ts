import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../../../../../environments/environment';
import { TablesService } from './tables.service';

describe('TablesService table reassignment', () => {
  let service: TablesService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/store`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TablesService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('reads financial evidence from the scoped order detail', () => {
    let result: unknown;
    service.getOrderReassignmentEvidence(41).subscribe((value) => (result = value));
    const request = http.expectOne(`${base}/orders/41`);
    expect(request.request.method).toBe('GET');
    const evidence = { id: 41, state: 'draft', total_paid: '0',
      active_financial_split_id: null, payments: [], invoices: [] };
    request.flush({ data: evidence });
    expect(result).toEqual(evidence);
  });

  it('posts only order and destination ids, then refreshes floor map', () => {
    const session = { id: 77, order_id: 41, table_id: 8 };
    let result: unknown;
    (service as any).reassignOrderToTable(41, 8).subscribe((value: unknown) => (result = value));
    const post = http.expectOne(`${base}/table-sessions/reassign`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({ order_id: 41, target_table_id: 8 });
    post.flush({ data: session });
    const floor = http.expectOne(`${base}/tables/floor-map`);
    floor.flush({ data: [{ id: 8, status: 'occupied' }] });
    expect(result).toEqual(session);
    expect(service.floorTables()[0].id).toBe(8);
  });

  it('keeps the committed reassignment successful when floor refresh fails', () => {
    const session = { id: 77, order_id: 41, table_id: 8 };
    let result: unknown;
    service.reassignOrderToTable(41, 8).subscribe((value) => (result = value));
    http.expectOne(`${base}/table-sessions/reassign`).flush({ data: session });
    http.expectOne(`${base}/tables/floor-map`).flush(
      { message: 'floor unavailable' }, { status: 503, statusText: 'Unavailable' },
    );
    expect(result).toEqual(session);
  });

  it('uses typed financial rejection reason instead of English devMessage', () => {
    let message: unknown;
    (service as any).reassignOrderToTable(41, 8).subscribe({ error: (error: unknown) => (message = error) });
    http.expectOne(`${base}/table-sessions/reassign`).flush({
      error_code: 'ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001',
      message: 'This order has financial activity that prevents table reassignment',
      details: { reason: 'issued_invoice' },
    }, { status: 409, statusText: 'Conflict' });
    expect(message).toContain('factura');
    expect(message).not.toContain('financial activity');
    http.expectNone(`${base}/tables/floor-map`);
  });

  it('explains a lost table-status race and does not refresh floor on failure', () => {
    let message: unknown;
    (service as any).reassignOrderToTable(41, 8).subscribe({ error: (error: unknown) => (message = error) });
    http.expectOne(`${base}/table-sessions/reassign`).flush({
      error_code: 'SYS_CONFLICT_001', message: 'Resource conflict',
    }, { status: 409, statusText: 'Conflict' });
    expect(message).toContain('cambió de estado');
    http.expectNone(`${base}/tables/floor-map`);
  });

  for (const [code, reason, phrase] of [
    ['ORD_TABLE_REASSIGN_ORDER_STATE_001', null, 'cancelada'],
    ['ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001', 'settled_payment', 'pago'],
    ['ORD_TABLE_REASSIGN_NOT_ELIGIBLE_001', 'active_financial_split', 'divididas'],
    ['TABLE_SESSION_NOT_FOUND', null, 'no venía de una mesa'],
    ['TABLE_INVALID_STATUS', null, 'reservada o en limpieza'],
    ['TABLE_SESSION_ALREADY_OPEN', null, 'cuenta abierta'],
  ] as const) {
    it(`explains typed rejection ${code} (${reason ?? 'no reason'})`, () => {
      let message: unknown;
      service.reassignOrderToTable(41, 8).subscribe({ error: (error) => (message = error) });
      http.expectOne(`${base}/table-sessions/reassign`).flush({
        error_code: code,
        message: 'Technical English devMessage',
        details: reason ? { reason } : {},
      }, { status: code === 'TABLE_SESSION_NOT_FOUND' ? 404 : 409, statusText: 'Rejected' });
      expect(message).toContain(phrase);
      expect(message).not.toContain('Technical English');
    });
  }
});
