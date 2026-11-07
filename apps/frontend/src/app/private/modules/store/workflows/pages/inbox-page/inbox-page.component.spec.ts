import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { InboxTaskRow } from '../../interfaces/workflow-ops.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { InboxPageComponent } from './inbox-page.component';

const task = (over: Partial<InboxTaskRow> = {}): InboxTaskRow =>
  ({
    task_id: 7,
    stage_name: 'Aprobación',
    due_at: null,
    overdue: false,
    quick_outcomes: ['approve', 'reject'],
    assignee: null,
    definition: { id: 1, name: 'Compras' },
    instance: { id: 11, reference: 'FLU-000011', title: 'Compra', row_version: 3 },
    ...over,
  }) as unknown as InboxTaskRow;

const page = (rows: InboxTaskRow[]) => ({
  data: rows,
  meta: { total: rows.length },
});

describe('InboxPageComponent', () => {
  let fixture: ComponentFixture<InboxPageComponent>;
  let api: jasmine.SpyObj<WorkflowsApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let navigate: jasmine.Spy;

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const render = async () => {
    // Not whenStable: the shared currency service keeps an HTTP request open.
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const conflict = (code: string, message: string) =>
    new HttpErrorResponse({ status: 409, error: { error_code: code, message } });

  beforeEach(() => {
    api = jasmine.createSpyObj('WorkflowsApiService', [
      'listDefinitions',
      'listInbox',
      'completeTask',
    ]);
    api.listDefinitions.and.returnValue(of({ data: [] }) as never);
    api.listInbox.and.returnValue(of(page([task()])) as never);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      imports: [InboxPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowsApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        provideRouter([]),
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate');
    fixture = TestBed.createComponent(InboxPageComponent);
  });

  it('mientras carga muestra el aviso', async () => {
    api.listInbox.and.returnValue(NEVER as never);
    await render();
    expect(text()).toContain('Cargando...');
  });

  it('sin tareas muestra el estado vacío', async () => {
    api.listInbox.and.returnValue(of(page([])) as never);
    await render();
    expect(text()).toContain('No tienes tareas pendientes');
  });

  it('un error de carga avisa y no se queda cargando', async () => {
    api.listInbox.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'x' } })) as never,
    );
    await render();
    expect(toast.error).toHaveBeenCalled();
    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(text()).not.toContain('Cargando...');
  });

  it('con tareas muestra el total y arma la fila', async () => {
    await render();
    expect(text()).toContain('Tareas (1)');
    expect(fixture.componentInstance.rows()[0]).toEqual(
      jasmine.objectContaining({
        reference: 'FLU-000011',
        definition_label: 'Compras',
        assignee_text: 'Sin responsable',
      }),
    );
  });

  it('aprobar quita la fila, avisa y envía la versión que vio con clave idempotente', async () => {
    api.completeTask.and.returnValue(of({}) as never);
    await render();
    const c = fixture.componentInstance;
    c.quick(c.tasks()[0], 'approve');
    const [taskId, body, key] = api.completeTask.calls.mostRecent().args;
    expect(taskId).toBe(7);
    expect(body).toEqual({ outcome: 'approve', expected_row_version: 3 });
    expect(key).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Tarea completada');
    expect(c.tasks()).toEqual([]);
    expect(c.totalItems()).toBe(0);
  });

  it('rechazar pide comentario antes de enviar', async () => {
    api.completeTask.and.returnValue(of({}) as never);
    await render();
    const c = fixture.componentInstance;
    c.quick(c.tasks()[0], 'reject');
    expect(c.commentOpen()).toBeTrue();
    expect(api.completeTask).not.toHaveBeenCalled();
    c.onCommentConfirmed('No aplica');
    expect(api.completeTask.calls.mostRecent().args[1]).toEqual({
      outcome: 'reject',
      comment: 'No aplica',
      expected_row_version: 3,
    });
    expect(c.commentOpen()).toBeFalse();
  });

  it('si otra persona se adelantó muestra el mensaje y recarga la lista', async () => {
    api.completeTask.and.returnValue(
      throwError(() => conflict('WORKFLOW_STALE', 'Esta solicitud cambió; recarga.')) as never,
    );
    await render();
    const c = fixture.componentInstance;
    const loadsBefore = api.listInbox.calls.count();
    c.quick(c.tasks()[0], 'approve');
    expect(toast.error).toHaveBeenCalled();
    expect(api.listInbox.calls.count()).toBeGreaterThan(loadsBefore);
    expect(c.tasks().length).toBe(1);
  });

  it('un doble clic no completa la misma tarea dos veces', async () => {
    api.completeTask.and.returnValue(NEVER as never);
    await render();
    const c = fixture.componentInstance;
    c.quick(c.tasks()[0], 'approve');
    c.quick(c.tasks()[0], 'approve');
    expect(api.completeTask).toHaveBeenCalledTimes(1);
  });

  it('abrir lleva al detalle de la solicitud', async () => {
    await render();
    const c = fixture.componentInstance;
    c.open(c.tasks()[0]);
    expect(navigate).toHaveBeenCalledWith(['/admin/workflows/instances', 11]);
  });

  it('al destruir la pantalla cancela la petición en curso', async () => {
    let cancelled = 0;
    api.listInbox.and.returnValue(new Observable(() => () => cancelled++) as never);
    await render();
    const inFlight = api.listInbox.calls.count();
    expect(inFlight).toBeGreaterThan(0);
    expect(cancelled).toBe(0);
    fixture.destroy();
    expect(cancelled).toBe(inFlight);
  });
});
