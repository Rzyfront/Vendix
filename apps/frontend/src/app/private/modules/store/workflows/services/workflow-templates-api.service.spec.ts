import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowTemplatesApiService } from './workflow-templates-api.service';

describe('WorkflowTemplatesApiService', () => {
  let api: WorkflowTemplatesApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(WorkflowTemplatesApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lista las plantillas y expone el arreglo de data', () => {
    let keys: string[] = [];
    api.list().subscribe((rows) => (keys = rows.map((r) => r.key)));
    http
      .expectOne((r) => r.method === 'GET' && r.url.endsWith('/store/workflows/templates'))
      .flush({ data: [{ key: 'pqr', name: 'PQR', stage_count: 5, stages: [] }] });
    expect(keys).toEqual(['pqr']);
  });

  it('activar hace POST a /:key/activate y devuelve el flujo creado', () => {
    let result: unknown;
    api.activate('compras-aprobacion-monto').subscribe((r) => (result = r));
    const req = http.expectOne((r) =>
      r.url.endsWith('/templates/compras-aprobacion-monto/activate'),
    );
    expect(req.request.method).toBe('POST');
    req.flush({
      data: { id: 12, key: 'compras-aprobacion-monto-2', name: 'Compras (2)', version: 1, source_template_key: 'compras-aprobacion-monto' },
    });
    expect(result).toEqual(
      jasmine.objectContaining({ id: 12, key: 'compras-aprobacion-monto-2', version: 1 }),
    );
  });
});
