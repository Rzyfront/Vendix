import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { WorkflowsPageComponent } from './workflows-page.component';

const row = { id: 3, key: 'compras', name: 'Compras', status: 'active', published_version: { version: 2 } };
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
      'setDefinitionEnabled',
      'createDefinition',
    ]);
    api.listDefinitions.and.returnValue(of(list([row])) as never);
    api.listInstances.and.returnValue(of(list([])) as never);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'warning']);
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

  it('un flujo publicado se ve como publicado y ofrece iniciar solicitud', async () => {
    await render();
    const c = fixture.componentInstance;
    const view = c.definitionRows()[0];
    expect(view.status_badge).toBe('active');
    const start = c.definitionActions.find((a) => a.label === 'Iniciar solicitud');
    expect((start?.show as (r: unknown) => boolean)(view)).toBeTrue();
  });

  it('las métricas piden los estados que el backend acepta (active, nunca published)', async () => {
    await render();
    const statuses = api.listDefinitions.calls.allArgs().map(([q]) => q?.status);
    expect(statuses).toContain('active');
    expect(statuses).not.toContain('published' as never);
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

  it('al destruir la pantalla cancela la petición en curso', async () => {
    let cancelled = 0;
    api.listDefinitions.and.returnValue(new Observable(() => () => cancelled++) as never);
    await render();
    const inFlight = api.listDefinitions.calls.count();
    expect(inFlight).toBeGreaterThan(0);
    expect(cancelled).toBe(0);
    fixture.destroy();
    expect(cancelled).toBe(inFlight);
  });

  it('apagar un flujo llama al interruptor, lo marca apagado y avisa', async () => {
    await render();
    const c = fixture.componentInstance;
    api.setDefinitionEnabled.and.returnValue(of({ ...row, is_enabled: false }) as never);
    c.setEnabled(c.definitionRows()[0], false);
    expect(api.setDefinitionEnabled).toHaveBeenCalledWith(3, false);
    expect(c.definitions()[0].is_enabled).toBeFalse();
    expect(c.definitionRows()[0].enabled_text).toBe('Apagado');
    expect(toast.success).toHaveBeenCalled();
  });

  it('si el servidor rechaza el interruptor, la fila vuelve a como estaba', async () => {
    await render();
    const c = fixture.componentInstance;
    api.setDefinitionEnabled.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Sin permiso' } })) as never,
    );
    c.setEnabled(c.definitionRows()[0], false);
    expect(c.definitions()[0].is_enabled).not.toBeFalse();
    expect(toast.error).toHaveBeenCalled();
  });

  it('un flujo apagado muestra la insignia "Apagado" en la lista', async () => {
    api.listDefinitions.and.returnValue(of(list([{ ...row, is_enabled: false }])) as never);
    await render();
    expect(text()).toContain('Apagado');
  });

  it('"Nuevo flujo" pide solo el nombre y abre el editor del flujo creado', async () => {
    await render();
    const c = fixture.componentInstance;
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    c.onHeaderAction('new');
    expect(c.newOpen()).toBeTrue();
    c.onNewCreated({ ...row, id: 9 } as never);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/workflows', 9, 'edit']);
  });

  it('el encabezado lleva a la galería y al tablero general', async () => {
    await render();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture.componentInstance.onHeaderAction('templates');
    fixture.componentInstance.onHeaderAction('board');
    expect(router.navigate).toHaveBeenCalledWith(['/admin/workflows/templates']);
    expect(router.navigate).toHaveBeenCalledWith(['/admin/workflows/board']);
  });
});
