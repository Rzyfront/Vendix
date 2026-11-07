import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { NEVER, of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { WorkflowsPageComponent } from './workflows-page.component';

const row = { id: 3, key: 'compras', name: 'Compras', status: 'draft' };
const list = (rows: unknown[]) => ({ data: rows, meta: { total: rows.length } });

describe('WorkflowsPageComponent', () => {
  let fixture: ComponentFixture<WorkflowsPageComponent>;
  let api: jasmine.SpyObj<WorkflowsApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const render = async () => {
    // Not whenStable: the shared currency service keeps an HTTP request open.
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowsApiService', [
      'listDefinitions',
      'listInstances',
      'publishDefinition',
    ]);
    api.listDefinitions.and.returnValue(of(list([row])) as never);
    api.listInstances.and.returnValue(of(list([])) as never);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      imports: [WorkflowsPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowsApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        provideRouter([]),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
      ],
    });
    fixture = TestBed.createComponent(WorkflowsPageComponent);
  });

  it('mientras carga la lista no muestra el estado vacío', async () => {
    api.listDefinitions.and.returnValue(NEVER as never);
    await render();
    expect(fixture.componentInstance.loading()).toBeTrue();
    expect(text()).toContain('Cargando');
  });

  it('sin flujos invita a crear el primero', async () => {
    api.listDefinitions.and.returnValue(of(list([])) as never);
    await render();
    expect(fixture.componentInstance.totalItems()).toBe(0);
    expect(fixture.nativeElement.querySelector('app-empty-state')).not.toBeNull();
  });

  it('con flujos llena la lista', async () => {
    await render();
    expect(fixture.componentInstance.definitions().map((d) => d.id)).toEqual([3]);
    expect(fixture.componentInstance.totalItems()).toBe(1);
  });

  it('un error de carga avisa y no se queda cargando', async () => {
    api.listDefinitions.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'x' } })) as never,
    );
    await render();
    expect(toast.error).toHaveBeenCalled();
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it('publicar dice la versión; republicar sin cambios lo dice también', async () => {
    await render();
    const c = fixture.componentInstance;
    api.publishDefinition.and.returnValue(of({ version: 2, unchanged: false }) as never);
    c.publish(row as never);
    expect(toast.success).toHaveBeenCalledWith('Versión 2 publicada');
    api.publishDefinition.and.returnValue(of({ version: 2, unchanged: true }) as never);
    c.publish(row as never);
    expect(toast.success).toHaveBeenCalledWith('Sin cambios: la versión 2 sigue vigente');
  });

  it('si el validador rechaza la publicación abre la lista de errores por etapa', async () => {
    await render();
    const c = fixture.componentInstance;
    api.publishDefinition.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              error_code: 'WORKFLOW_INVALID',
              message: 'Definición inválida',
              details: {
                errors: [{ message: 'La etapa "Aprobación jefe" no tiene responsable.' }],
              },
            },
          }),
      ) as never,
    );
    c.publish(row as never);
    expect(c.issuesOpen()).toBeTrue();
    expect(c.issues().join(' ')).toContain('no tiene responsable');
  });
});
