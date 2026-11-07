import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { Observable, of, throwError } from 'rxjs';
import { WorkflowActionDef } from '../../../../../../../shared/workflows/contract/workflow-contract';
import { ActionTestResult } from '../../../interfaces/workflow-debug.interfaces';
import { WorkflowDebugApiService } from '../../../services/workflow-debug-api.service';
import { ActionTestButtonComponent } from './action-test-button.component';

const action = {
  action: 'vendix.customer.create',
  map: { first_name: '{{fields.nombre}}', last_name: 'X', email: '{{fields.correo}}' },
} as WorkflowActionDef;

const preview: ActionTestResult = {
  mode: 'preview',
  executed: false,
  action: 'vendix.customer.create',
  label: 'Crear cliente',
  resolved_input: { first_name: 'Ana', last_name: 'X', email: '' },
  schema_errors: [{ key: 'email', label: 'Correo', message: 'Falta un valor (revisa los datos de prueba).' }],
  permission: { required: 'store:customers:create', granted: false },
};

describe('ActionTestButtonComponent', () => {
  let fixture: ComponentFixture<ActionTestButtonComponent>;
  const api = { testAction: jasmine.createSpy('testAction') };
  const el = () => fixture.nativeElement as HTMLElement;

  function setup(result: Observable<ActionTestResult>, def: WorkflowActionDef = action) {
    api.testAction.calls.reset();
    api.testAction.and.returnValue(result);
    TestBed.configureTestingModule({
      imports: [ActionTestButtonComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowDebugApiService, useValue: api },
      ],
    });
    fixture = TestBed.createComponent(ActionTestButtonComponent);
    fixture.componentRef.setInput('action', def);
    fixture.componentRef.setInput('definition', {
      schema: 'vendix.workflow/v1',
      key: 'k',
      name: 'n',
      fields: [{ key: 'nombre', label: 'Nombre', type: 'text' }],
      stages: [],
    });
    fixture.detectChanges();
    fixture.componentInstance.open();
    fixture.detectChanges();
  }

  it('pide un dato de prueba por campo usado y envía la acción con ellos', () => {
    setup(of(preview));
    expect(el().querySelectorAll('app-input').length).toBe(2);
    expect(el().textContent).toContain('Nombre');
    fixture.componentInstance.setSample('nombre', 'Ana');
    fixture.componentInstance.run();
    expect(api.testAction).toHaveBeenCalledWith({
      action: action as unknown as Record<string, unknown>,
      data: { nombre: 'Ana', correo: '' },
    });
  });

  it('muestra "Vista previa — no se ejecutó", la entrada, los errores y el permiso', () => {
    setup(of(preview));
    fixture.componentInstance.run();
    fixture.detectChanges();
    const box = el().querySelector('[data-testid="action-test-preview"]');
    expect(box?.textContent).toContain('Vista previa — no se ejecutó');
    expect(box?.textContent).toContain('Ana');
    expect(el().querySelector('[data-testid="action-test-errors"]')?.textContent).toContain('Correo');
    expect(el().querySelector('[data-testid="action-test-permission"]')?.textContent).toContain('No tienes el permiso requerido');
  });

  it('HTTP muestra la respuesta real', () => {
    setup(
      of({
        mode: 'http',
        executed: true,
        action: 'vendix.http.request',
        label: 'Llamada HTTP',
        result: { ok: true, status: 201, headers: {}, body: '{"id":9}', body_truncated: false, duration_ms: 42, output: {} },
      }),
      { action: 'vendix.http.request', map: { method: 'GET', url: 'https://x.test' } },
    );
    fixture.componentInstance.run();
    fixture.detectChanges();
    const box = el().querySelector('[data-testid="action-test-http"]');
    expect(box?.textContent).toContain('Estado 201');
    expect(box?.textContent).toContain('{"id":9}');
    expect(el().querySelector('[data-testid="action-test-preview"]')).toBeNull();
  });

  it('un error del servidor se muestra y no deja resultado', () => {
    setup(throwError(() => ({ status: 403, error: { error_code: 'AUTH_PERM_001', message: 'Sin permiso' } })));
    fixture.componentInstance.run();
    fixture.detectChanges();
    expect(fixture.componentInstance.result()).toBeNull();
    expect(fixture.componentInstance.failure()).not.toBe('');
  });
});
