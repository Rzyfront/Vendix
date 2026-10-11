import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../../../../environments/environment';
import { of } from 'rxjs';
import { QuotationsService } from './quotations.service';
import { Quotation } from '../interfaces/quotation.interface';

describe('QuotationsService — complete-conversion destination gate', () => {
  let service: QuotationsService;
  let http: HttpTestingController;
  const quote = (destination?: Quotation['destination'], status: Quotation['status'] = 'accepted'): Quotation => ({
    id: 4, store_id: 1, quotation_number: 'COT-004', status, destination,
    channel: 'admin', subtotal_amount: 100, discount_amount: 0, tax_amount: 0, shipping_cost: 0,
    grand_total: 100, created_at: '', updated_at: '', quotation_items: [],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(QuotationsService);
    http = TestBed.inject(HttpTestingController);
    spyOn(service, 'convertToOrder').and.returnValue(of(quote('sale', 'converted')));
    spyOn(service, 'sendQuotation').and.returnValue(of(quote('sale', 'sent')));
    spyOn(service, 'acceptQuotation').and.returnValue(of(quote('sale', 'accepted')));
  });

  it('never calls sale endpoints for contract, other, or contracted quotes', () => {
    for (const candidate of [quote('contract'), quote('other'), quote('contract', 'contracted')]) {
      let error: unknown;
      service.processCompleteQuotation(candidate).subscribe({ error: (value) => error = value });
      expect(error).toBeTruthy();
    }
    expect(service.sendQuotation).not.toHaveBeenCalled();
    expect(service.acceptQuotation).not.toHaveBeenCalled();
    expect(service.convertToOrder).not.toHaveBeenCalled();
  });

  it('keeps legacy missing destination on the sale conversion path', () => {
    service.processCompleteQuotation(quote(undefined)).subscribe();
    expect(service.convertToOrder).toHaveBeenCalledOnceWith(4);
  });

  it('posts authoritative contract preview input to the contract-only endpoint', () => {
    const request = {
      quotation_id: 7,
      contract_object: 'Obra acordada',
      aiu_value: 0,
      items: [{ product_name: 'Mano de obra', quantity: 1, unit_price: 100, total_price: 100 }],
    };
    const response = { schema_version: 1, direct_cost: '100.00' } as any;
    let result: unknown;
    service.previewContractEconomics(request).subscribe((value) => result = value);
    const pending = http.expectOne(`${environment.apiUrl}/store/quotations/contract-preview`);
    expect(pending.request.method).toBe('POST');
    expect(pending.request.body).toEqual(request);
    pending.flush({ success: true, data: response });
    expect(result).toEqual(response);
    http.verify();
  });
});
