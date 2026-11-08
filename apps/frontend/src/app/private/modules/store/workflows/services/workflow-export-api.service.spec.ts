import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowExport, WorkflowExportApiService } from './workflow-export-api.service';

const pending: WorkflowExport = {
  id: 4,
  status: 'pending',
  size_bytes: null,
  file_count: 0,
  counts: {},
  error: null,
  created_at: '2026-11-08T10:00:00.000Z',
  started_at: null,
  completed_at: null,
  expires_at: null,
};

describe('WorkflowExportApiService', () => {
  let api: WorkflowExportApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkflowExportApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('solicita una exportación con POST y devuelve data', () => {
    let status = '';
    api.request().subscribe((e) => (status = e.status));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/exports'));
    expect(req.request.method).toBe('POST');
    req.flush({ data: pending });
    expect(status).toBe('pending');
  });

  it('lista las exportaciones con GET y devuelve data', () => {
    let ids: number[] = [];
    api.list().subscribe((l) => (ids = l.map((e) => e.id)));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/exports'));
    expect(req.request.method).toBe('GET');
    req.flush({ data: [pending] });
    expect(ids).toEqual([4]);
  });

  it('pide la URL de descarga de una exportación', () => {
    let url = '';
    api.download(4).subscribe((d) => (url = d.url));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/exports/4/download'));
    expect(req.request.method).toBe('GET');
    req.flush({ data: { url: 'https://s3.test/x.zip', file_name: 'flujos-exportacion-4.zip', expires_in: 300 } });
    expect(url).toBe('https://s3.test/x.zip');
  });
});
