import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { NEVER, Observable, Subject, of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { InboxTaskRow } from '../../interfaces/workflow-ops.interfaces';
import { WorkflowLiveEvent } from '../../interfaces/workflow-board.interfaces';
import { WorkflowLiveService } from '../../services/workflow-live.service';
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
  let liveChanges: Subject<WorkflowLiveEvent>;

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
    liveChanges = new Subject<WorkflowLiveEvent>();
    TestBed.configureTestingModule({
      imports: [InboxPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowsApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: WorkflowLiveService, useValue: { changes: () => liveChanges.asObservable() } },
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

  it('una tarea de rama muestra el nombre de la rama junto a la etapa', async () => {
    api.listInbox.and.returnValue(
      of(page([task({ stage_name: 'Alistamiento', branch_key: 'ti', branch_name: 'TI' })])) as never,
    );
    await render();
    expect(fixture.componentInstance.rows()[0].stage_label).toBe('Alistamiento · Rama: TI');
    expect(text()).toContain('Rama: TI');
  });

  it('una tarea sin rama muestra solo la etapa', async () => {
    await render();
    expect(fixture.componentInstance.rows()[0].stage_label).toBe('Aprobación');
  });
  describe('Mis tareas en el celular (P5.5)', () => {
    const button = (label: string, scope = 'mobile-tasks') =>
      Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="${scope}"] button`),
      ).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

    it('una aprobación sin formulario muestra Aprobar y Rechazar grandes', async () => {
      api.listInbox.and.returnValue(
        of(page([task({ quick_outcomes: ['approve'], comment_outcomes: ['reject'], has_form: false } as never)])) as never,
      );
      await render();
      expect(button('Aprobar')).toBeTruthy();
      expect(button('Rechazar')).toBeTruthy();
      expect(button('Abrir')).toBeTruthy();
    });

    it('Aprobar completa la tarea, avisa y la fila desaparece', async () => {
      api.listInbox.and.returnValue(
        of(page([task({ quick_outcomes: ['approve'], has_form: false } as never)])) as never,
      );
      api.completeTask.and.returnValue(of({}) as never);
      await render();
      button('Aprobar')!.click();
      fixture.detectChanges();
      expect(api.completeTask.calls.mostRecent().args[1]).toEqual({ outcome: 'approve', expected_row_version: 3 });
      expect(toast.success).toHaveBeenCalledWith('Tarea completada');
      expect(button('Abrir')).toBeUndefined();
    });

    it('Rechazar pide el motivo antes de enviar', async () => {
      api.listInbox.and.returnValue(
        of(page([task({ quick_outcomes: [], comment_outcomes: ['approve', 'reject'], has_form: false } as never)])) as never,
      );
      api.completeTask.and.returnValue(of({}) as never);
      await render();
      button('Rechazar')!.click();
      expect(fixture.componentInstance.commentOpen()).toBeTrue();
      expect(api.completeTask).not.toHaveBeenCalled();
      button('Aprobar')!.click();
      expect(fixture.componentInstance.commentOutcome()).toBe('approve');
      expect(api.completeTask).not.toHaveBeenCalled();
    });

    it('una tarea con formulario solo ofrece Abrir', async () => {
      api.listInbox.and.returnValue(
        of(page([task({ quick_outcomes: ['approve'], has_form: true } as never)])) as never,
      );
      await render();
      expect(button('Aprobar')).toBeUndefined();
      expect(button('Rechazar')).toBeUndefined();
      button('Abrir')!.click();
      expect(navigate).toHaveBeenCalledWith(['/admin/workflows/instances', 11]);
    });
  });

  describe('actualización en vivo (P5.6)', () => {
    it('un evento recarga la lista sin pasar por el aviso de carga', async () => {
      await render();
      const before = api.listInbox.calls.count();
      api.listInbox.and.returnValue(
        of(page([task(), task({ task_id: 8, instance: { id: 12, reference: 'FLU-000012', title: 'Otra', row_version: 0 } })])) as never,
      );
      liveChanges.next({ kind: 'task', instance_id: 12, task_id: 8 });
      fixture.detectChanges();
      expect(api.listInbox.calls.count()).toBeGreaterThan(before);
      expect(fixture.componentInstance.tasks().length).toBe(2);
      expect(fixture.componentInstance.loading()).toBeFalse();
    });
  });
});
