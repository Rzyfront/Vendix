import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { environment } from '../../../../../../environments/environment';
import { SupportDocumentService } from './support-document.service';

describe('SupportDocumentService (purchase order routes, QUI-684)', () => {
  let service: SupportDocumentService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/store/invoicing`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SupportDocumentService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the purchase order context from its support-documents route', () => {
    service.getPurchaseOrderContext(42).subscribe();
    const req = http.expectOne(`${base}/purchase-orders/42/support-documents`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: {} });
  });

  it('reads the purchase order draft from its support-document-draft route', () => {
    service.getPurchaseOrderDraft(42).subscribe();
    const req = http.expectOne(`${base}/purchase-orders/42/support-document-draft`);
    expect(req.request.method).toBe('GET');
    req.flush({ success: true, data: {} });
  });

  it('posts the document to the purchase order support-document route', () => {
    const dto = {
      issue_date: '2026-11-17',
      payment_form: '1' as const,
      items: [],
      emit_immediately: true,
      client_request_id: 'abc',
    };
    service.createFromPurchaseOrder(42, dto).subscribe();
    const req = http.expectOne(`${base}/purchase-orders/42/support-document`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(dto);
    req.flush({ success: true, data: {} });
  });
});
