import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowAuditApiService, WorkflowAuditPage } from './workflow-audit-api.service';

describe('WorkflowAuditApiService', () => {
  let api: WorkflowAuditApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkflowAuditApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists with page, limit and only the filters that were set', () => {
    const result: WorkflowAuditPage[] = [];
    api
      .list({ from: '2026-11-01', category: 'secret', search: '', definition_id: 7 }, 2, 10)
      .subscribe((p) => result.push(p));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/audit'));
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('from')).toBe('2026-11-01');
    expect(req.request.params.get('category')).toBe('secret');
    expect(req.request.params.get('definition_id')).toBe('7');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('10');
    expect(req.request.params.has('search')).toBeFalse();
    expect(req.request.params.has('to')).toBeFalse();
    req.flush({ data: [], meta: { total: 31, page: 2, limit: 10, totalPages: 4 } });
    expect(result[0]).toEqual({ items: [], total: 31, page: 2, limit: 10, totalPages: 4 });
  });

  it('verifies the chain and returns data', () => {
    const broken: Array<string | null> = [];
    api.verify().subscribe((v) => broken.push(v.broken_at_seq));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/audit/verify'));
    expect(req.request.method).toBe('GET');
    req.flush({ data: { valid: false, count: 12, broken_at_seq: '5' } });
    expect(broken).toEqual(['5']);
  });

  it('exports the workbook as a blob with the same filters', () => {
    const blobs: Blob[] = [];
    api.export({ to: '2026-11-08', category: 'export' }).subscribe((b) => blobs.push(b));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/audit/export'));
    expect(req.request.responseType).toBe('blob');
    expect(req.request.params.get('to')).toBe('2026-11-08');
    expect(req.request.params.get('category')).toBe('export');
    req.flush(new Blob(['x']));
    expect(blobs.length).toBe(1);
  });
});
