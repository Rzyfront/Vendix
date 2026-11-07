import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { WorkflowsApiService } from './workflows-api.service';

/** The shapes here are the backend's real responses, seen in the live QA of P0. */
describe('WorkflowsApiService — contrato con el backend', () => {
  let api: WorkflowsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    api = TestBed.inject(WorkflowsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('publicar expone el número de versión, no el objeto de la versión', () => {
    let version: unknown;
    api.publishDefinition(3).subscribe((r) => (version = r.version));
    http
      .expectOne((r) => r.url.endsWith('/definitions/3/publish'))
      .flush({ data: { unchanged: false, version: { id: 9, version: 2 }, warnings: [] } });
    expect(version).toBe(2);
  });

  it('iniciar expone el id de la solicitud y manda la clave idempotente', () => {
    let result: unknown;
    api
      .startInstance({ definition_id: 3 }, 'k-1')
      .subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url.endsWith('/instances'));
    expect(req.request.headers.get('Idempotency-Key')).toBe('k-1');
    req.flush({
      data: { instance: { id: 6, reference: 'FLU-000006' }, replayed: false },
    });
    expect(result).toEqual({ id: 6, reference: 'FLU-000006', replayed: false });
  });
});
