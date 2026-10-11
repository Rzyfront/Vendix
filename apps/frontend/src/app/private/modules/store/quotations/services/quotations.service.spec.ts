import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { QuotationsService } from './quotations.service';
import { Quotation } from '../interfaces/quotation.interface';

describe('QuotationsService — complete-conversion destination gate', () => {
  let service: QuotationsService;
  const quote = (destination?: Quotation['destination'], status: Quotation['status'] = 'accepted'): Quotation => ({
    id: 4, store_id: 1, quotation_number: 'COT-004', status, destination,
    channel: 'admin', subtotal_amount: 100, discount_amount: 0, tax_amount: 0, shipping_cost: 0,
    grand_total: 100, created_at: '', updated_at: '', quotation_items: [],
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(QuotationsService);
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
});
