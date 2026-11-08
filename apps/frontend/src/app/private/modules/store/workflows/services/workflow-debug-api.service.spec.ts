import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionTestResult, InstanceDebug } from '../interfaces/workflow-debug.interfaces';
import { WorkflowDebugApiService } from './workflow-debug-api.service';

describe('WorkflowDebugApiService', () => {
  let api: WorkflowDebugApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(WorkflowDebugApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lee el depurador de la solicitud y expone data', () => {
    let result: InstanceDebug | undefined;
    api.instanceDebug(12).subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/instances/12/debug'));
    expect(req.request.method).toBe('GET');
    req.flush({ data: { instance_id: 12, events: [], current_data: { monto: 1 } } });
    expect(result?.current_data).toEqual({ monto: 1 });
  });

  it('prueba una acción con POST /actions/test y devuelve la vista previa', () => {
    let result: ActionTestResult | undefined;
    api
      .testAction({ action: { action: 'vendix.customer.create', map: {} }, data: { a: '1' } })
      .subscribe((r) => (result = r));
    const req = http.expectOne((r) => r.url.endsWith('/store/workflows/actions/test'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ action: { action: 'vendix.customer.create', map: {} }, data: { a: '1' } });
    req.flush({
      data: {
        mode: 'preview',
        executed: false,
        action: 'vendix.customer.create',
        label: 'Crear cliente',
        resolved_input: {},
        schema_errors: [],
        permission: { required: 'x', granted: true },
      },
    });
    expect(result?.executed).toBe(false);
  });
});
