import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../../../environments/environment';
import { MetaWhatsappConfigService } from './meta-whatsapp-config.service';

describe('MetaWhatsappConfigService', () => {
  let service: MetaWhatsappConfigService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/superadmin/social-sales/meta/config`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MetaWhatsappConfigService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs the masked config and unwraps data', () => {
    let result: unknown;
    service.getConfig().subscribe((r) => (result = r));
    const req = http.expectOne(url);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { configured: true, app_id: '123' } });
    expect(result).toEqual(jasmine.objectContaining({ app_id: '123' }));
  });

  it('PATCHes exactly the dto it receives', () => {
    service.updateConfig({ app_id: '999' }).subscribe();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ app_id: '999' });
    req.flush({ data: { configured: false } });
  });

  it('derives the webhook URL from environment.apiUrl', () => {
    expect(service.webhookUrl()).toBe(
      `${environment.apiUrl}/public/meta/whatsapp/webhook`,
    );
  });
});
