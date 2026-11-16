import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../../../environments/environment';
import { MessagingPricesService } from './messaging-prices.service';

describe('MessagingPricesService', () => {
  let service: MessagingPricesService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/superadmin/messaging/prices`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MessagingPricesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs the prices and unwraps data', () => {
    let result: unknown;
    service.getPrices().subscribe((r) => (result = r));
    const req = http.expectOne(url);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { key: 'messaging:prices' } });
    expect(result).toEqual(jasmine.objectContaining({ key: 'messaging:prices' }));
  });

  it('PATCHes exactly the dto it receives, nulls included', () => {
    service.updatePrices({ email_price_usd: null }).subscribe();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ email_price_usd: null });
    req.flush({ data: { key: 'messaging:prices' } });
  });
});
