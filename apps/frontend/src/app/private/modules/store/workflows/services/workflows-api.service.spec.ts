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

  it('el interruptor hace PATCH /enabled y devuelve la fila', () => {
    let row: unknown;
    api.setDefinitionEnabled(3, false).subscribe((r) => (row = r));
    const req = http.expectOne((r) => r.url.endsWith('/definitions/3/enabled'));
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({ data: { id: 3, is_enabled: false } });
    expect(row).toEqual({ id: 3, is_enabled: false } as never);
  });

  it('la vista previa de migración manda la versión y el mapa de etapas', () => {
    let total: unknown;
    const body = { from_version_id: 4, stage_map: { revision: 'revision_jefe' } };
    api.previewMigration(3, body).subscribe((r) => (total = r.total));
    const req = http.expectOne((r) => r.url.endsWith('/definitions/3/migrations/preview'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ data: { total: 2, ready: true, stages: [], target_stages: [] } });
    expect(total).toBe(2);
  });

  it('migrar hace POST /migrations y expone migradas y fallidas', () => {
    let result: unknown;
    const body = { from_version_id: 4, stage_map: { a: 'b' } };
    api.migrateInstances(3, body).subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url.endsWith('/definitions/3/migrations'));
    expect(req.request.body).toEqual(body);
    req.flush({ data: { migrated: 1, failed: [] } });
    expect(result).toEqual({ migrated: 1, failed: [] });
  });

  it('reintentar una acción fallida hace POST al reintento de esa acción', () => {
    let retried: unknown;
    api.retryFailedAction(8, 21).subscribe((r) => (retried = r.retried));
    const req = http.expectOne((r) => r.url.endsWith('/instances/8/failed-actions/21/retry'));
    expect(req.request.method).toBe('POST');
    req.flush({ data: { retried: true } });
    expect(retried).toBeTrue();
  });

  it('probar un paso de IA hace POST a ai-step-test y desenvuelve la respuesta', () => {
    let result: unknown;
    const body = { stage_key: 'clasificar', data: { asunto: 'Hola' } };
    api.testAiStep(3, body).subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url.endsWith('/definitions/3/ai-step-test'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(body);
    req.flush({ data: { status: 'skipped_quota', message: 'Sin cupo' } });
    expect(result).toEqual({ status: 'skipped_quota', message: 'Sin cupo' });
  });
});
