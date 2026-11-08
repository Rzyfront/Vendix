import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../../../../environments/environment';
import { WorkflowsOpsApiService } from './workflows-ops-api.service';

describe('WorkflowsOpsApiService', () => {
  let service: WorkflowsOpsApiService;
  let http: HttpTestingController;
  const base = `${environment.apiUrl}/superadmin/workflows-ops`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowsOpsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs the platform metrics and unwraps data', () => {
    let result: unknown;
    service.getMetrics().subscribe((r) => (result = r));
    const req = http.expectOne(`${base}/metrics`);
    expect(req.request.method).toBe('GET');
    req.flush({ data: { generated_at: 'x' } });
    expect(result).toEqual(jasmine.objectContaining({ generated_at: 'x' }));
  });

  it('GETs one page of alerts and maps the pagination meta', () => {
    let result: unknown;
    service.getAlerts(2, 10).subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url === `${base}/alerts`);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush({
      data: [{ id: 5 }],
      meta: { total: 21, page: 2, limit: 10, totalPages: 3 },
    });
    expect(result).toEqual({
      alerts: [{ id: 5 } as never],
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
  });
});
