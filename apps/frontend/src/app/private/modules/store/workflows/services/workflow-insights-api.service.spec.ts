import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowInsightsApiService } from './workflow-insights-api.service';

describe('WorkflowInsightsApiService', () => {
  let api: WorkflowInsightsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkflowInsightsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('pide el consumo del mes indicado y devuelve data', () => {
    let tokens = -1;
    api.getAiUsage('2026-10').subscribe((u) => (tokens = u.flows_tokens));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/ai-usage'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('month')).toBe('2026-10');
    req.flush({
      data: { month: '2026-10', quota: null, flows_tokens: 1200, calls: 3, skipped: 0, by_flow: [], by_purpose: [] },
    });
    expect(tokens).toBe(1200);
  });

  it('sin mes no envía el parámetro', () => {
    api.getAiUsage().subscribe();
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/ai-usage'));
    expect(req.request.params.has('month')).toBeFalse();
    req.flush({
      data: { month: '2026-11', quota: null, flows_tokens: 0, calls: 0, skipped: 0, by_flow: [], by_purpose: [] },
    });
  });

  it('lista los resúmenes con el límite', () => {
    let canGenerate = false;
    api.listSummaries(5).subscribe((l) => (canGenerate = l.can_generate));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/insights/summaries'));
    expect(req.request.params.get('limit')).toBe('5');
    req.flush({ data: { items: [], can_generate: true, next_generate_at: null } });
    expect(canGenerate).toBeTrue();
  });

  it('genera un resumen con POST', () => {
    let status = '';
    api.generateSummary().subscribe((s) => (status = s.status));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/insights/summaries/generate'));
    expect(req.request.method).toBe('POST');
    req.flush({
      data: {
        id: 1, kind: 'manual', status: 'skipped_quota', period_from: '2026-10-08', period_to: '2026-11-07',
        week_key: null, content: null, tokens_used: 0, model: null, error: null, created_at: '2026-11-07T10:00:00Z',
      },
    });
    expect(status).toBe('skipped_quota');
  });
});
