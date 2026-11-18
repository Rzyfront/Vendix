import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../../environments/environment';
import { MonitoringAlertsService } from './monitoring-alerts.service';

describe('MonitoringAlertsService', () => {
  let service: MonitoringAlertsService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/superadmin/monitoring/alerts`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MonitoringAlertsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists alerts sending status, page, limit and only the filters that are set', () => {
    let result: unknown;
    service
      .list({ status: 'open', severity: 'critical', search: ' pagos ', page: 2, limit: 20 })
      .subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('status')).toBe('open');
    expect(req.request.params.get('severity')).toBe('critical');
    expect(req.request.params.get('search')).toBe('pagos');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('20');
    expect(req.request.params.has('source')).toBeFalse();
    const meta = { total: 1, page: 2, limit: 20, totalPages: 1 };
    req.flush({ data: [{ id: 1 }], meta });
    expect(result).toEqual({ data: [{ id: 1 }] as never, meta });
  });

  it('omits severity and search when they are empty', () => {
    service.list({ status: 'all', search: '  ', page: 1, limit: 20 }).subscribe();
    const req = http.expectOne((r) => r.url === base);
    expect(req.request.params.has('severity')).toBeFalse();
    expect(req.request.params.has('search')).toBeFalse();
    req.flush({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } });
  });

  it('GETs the stats and unwraps data', () => {
    let result: unknown;
    service.getStats().subscribe((r) => (result = r));
    const req = http.expectOne(`${base}/stats`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { open_critical: 2 } });
    expect(result).toEqual({ open_critical: 2 } as never);
  });

  it('GETs one alert by id', () => {
    let result: unknown;
    service.getById(7).subscribe((r) => (result = r));
    const req = http.expectOne(`${base}/7`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { id: 7 } });
    expect(result).toEqual({ id: 7 } as never);
  });

  it('POSTs resolve to the alert id', () => {
    let result: unknown;
    service.resolve(7).subscribe((r) => (result = r));
    const req = http.expectOne(`${base}/7/resolve`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { id: 7, status: 'resolved' } });
    expect(result).toEqual({ id: 7, status: 'resolved' } as never);
  });

  it('POSTs the test alert with the chosen severity in the body', () => {
    let result: unknown;
    service.sendTest('critical').subscribe((r) => (result = r));
    const req = http.expectOne(`${base}/test`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ severity: 'critical' });
    req.flush({ data: { alert_id: 1, occurrences: 3, ticket_number: 'INC-1', telegram_sent: true } });
    expect(result).toEqual({
      alert_id: 1,
      occurrences: 3,
      ticket_number: 'INC-1',
      telegram_sent: true,
    });
  });
});
