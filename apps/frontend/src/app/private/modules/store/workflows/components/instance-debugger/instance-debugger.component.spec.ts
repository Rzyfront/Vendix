import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { InstanceDebug } from '../../interfaces/workflow-debug.interfaces';
import { WorkflowDebugApiService } from '../../services/workflow-debug-api.service';
import { InstanceDebuggerComponent } from './instance-debugger.component';

const debug: InstanceDebug = {
  instance_id: 5,
  current_data: { monto: 30 },
  events: [
    {
      seq: 1, type: 'started', from_stage_key: null, to_stage_key: 'solicitud', actor_type: 'user', actor_id: 3,
      occurred_at: '2026-11-07T10:00:00Z', payload: {}, data_snapshot: null, changes: [],
    },
    {
      seq: 2, type: 'task_completed', from_stage_key: 'solicitud', to_stage_key: 'jefe', actor_type: 'user', actor_id: 3,
      occurred_at: '2026-11-07T10:05:00Z', payload: {}, data_snapshot: { monto: 30 },
      changes: [{ key: 'monto', before: 10, after: 30 }],
    },
  ],
};

describe('InstanceDebuggerComponent', () => {
  let fixture: ComponentFixture<InstanceDebuggerComponent>;
  const api = { instanceDebug: jasmine.createSpy('instanceDebug') };

  function setup(result: Observable<InstanceDebug> = of(debug)) {
    api.instanceDebug.and.returnValue(result);
    TestBed.configureTestingModule({
      imports: [InstanceDebuggerComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: WorkflowDebugApiService, useValue: api },
        { provide: StoreSettingsFacade, useValue: { timezone: signal('America/Bogota') } },
      ],
    });
    fixture = TestBed.createComponent(InstanceDebuggerComponent);
    fixture.componentRef.setInput('instanceId', 5);
    fixture.componentRef.setInput('stageNames', { solicitud: 'Solicitud', jefe: 'Jefe' });
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const click = (index: number) => {
    (el().querySelectorAll('[data-testid="debug-event"] button')[index] as HTMLButtonElement).click();
    fixture.detectChanges();
  };

  it('lista los eventos con etapa, actor y número de cambios', async () => {
    setup();
    await fixture.whenStable();
    fixture.detectChanges();
    const items = el().querySelectorAll('[data-testid="debug-event"]');
    expect(items.length).toBe(2);
    expect(items[1].textContent).toContain('Solicitud → Jefe');
    expect(items[1].textContent).toContain('Usuario #3');
    expect(items[1].textContent).toContain('1 cambio(s)');
  });

  it('al expandir muestra las variables con lo que cambió resaltado', async () => {
    setup();
    await fixture.whenStable();
    fixture.detectChanges();
    click(1);
    const row = el().querySelector('tr[data-changed="true"]');
    expect(row?.textContent).toContain('monto');
    expect(row?.textContent).toContain('30');
    expect(row?.textContent).toContain('10');
  });

  it('un evento antiguo dice "Sin captura de variables"', async () => {
    setup();
    await fixture.whenStable();
    fixture.detectChanges();
    click(0);
    expect(el().querySelector('[data-testid="debug-legacy"]')?.textContent).toContain('Sin captura de variables');
  });

  it('un error de carga se muestra con reintento', async () => {
    setup(throwError(() => ({ status: 404, error: { error_code: 'WORKFLOW_NOT_FOUND', message: 'No se encontró la solicitud.' } })));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('No se encontró la solicitud.');
  });
});
