import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { WorkflowDefinitionV1 } from '../../../../../../shared/workflows/contract/workflow-contract';
import { SimulationWithSteps } from '../../interfaces/workflow-debug.interfaces';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { WorkflowEditorStore } from '../workflow-editor.store';
import { SimulatorPanelComponent } from './simulator-panel.component';

const draft = {
  schema: 'vendix.workflow/v1',
  key: 'k',
  name: 'Compras',
  fields: [],
  stages: [
    { key: 'revision', name: 'Revisión', type: 'parallel' },
    { key: 'fin', name: 'Fin', type: 'end', outcome: 'completed' },
  ],
} as unknown as WorkflowDefinitionV1;

const result: SimulationWithSteps = {
  valid: true,
  issues: [],
  form_errors: [],
  comment_required: false,
  pending_requirements: [],
  no_transition: false,
  from_stage: { key: 'solicitud', name: 'Solicitud' },
  to_stage: { key: 'fin', name: 'Fin', type: 'end' },
  transition: { on: 'joined' },
  path: ['solicitud', 'revision', 'fin'],
  data: { monto: 3000000, revisado: 'completo' },
  tasks: [{ stage_key: 'revision', kind: 'form', assignee: { kind: 'role', label: 'Rol: manager' } }],
  notifications: [],
  ended: { outcome: 'completed' },
  loop_guard: false,
  watermark: 'SIMULACIÓN',
  notes: ['El simulador no llama a la IA: usa los datos de prueba'],
  steps: [
    { stage_key: 'solicitud', stage_name: 'Solicitud', type: 'form', data: { monto: 3000000 }, changed: ['monto'] },
    {
      stage_key: 'revision',
      stage_name: 'Revisión',
      type: 'parallel',
      data: { monto: 3000000, revisado: 'completo' },
      changed: ['revisado'],
      parallel: {
        join: 'n_of_m',
        needed: 2,
        total: 3,
        outcome: 'joined',
        branches: [
          { key: 'a', name: 'Jefe', assignee: { kind: 'role', label: 'Rol: manager' } },
          { key: 'b', name: 'Contador', assignee: { kind: 'group', label: 'Grupo: conta' } },
          { key: 'c', name: 'Legal', assignee: null },
        ],
      },
    },
  ],
};

describe('SimulatorPanelComponent', () => {
  let fixture: ComponentFixture<SimulatorPanelComponent>;
  const api = { simulate: jasmine.createSpy('simulate') };
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    api.simulate.and.returnValue(of(result));
    TestBed.configureTestingModule({
      imports: [SimulatorPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideMockStore({ initialState: { tenant: { domainConfig: null } } }),
        { provide: WorkflowsApiService, useValue: api },
        { provide: WorkflowEditorStore, useValue: { draft: signal(draft) } },
      ],
    });
    fixture = TestBed.createComponent(SimulatorPanelComponent);
    fixture.componentRef.setInput('definitionId', 1);
    fixture.componentInstance.isOpen.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('muestra las ramas del paso paralelo, su responsable y la regla de unión', () => {
    const par = el().querySelector('[data-testid="sim-parallel"]');
    expect(par?.textContent).toContain('Jefe → Rol: manager');
    expect(par?.textContent).toContain('Legal → Sin responsable');
    expect(par?.textContent).toContain('se necesitan 2 de 3 ramas');
    expect(par?.textContent).toContain('joined');
  });

  it('muestra las variables por paso y resalta lo que cambió', () => {
    const step = el().querySelector('[data-testid="sim-step-revision"]');
    const changed = step?.querySelectorAll('tr[data-changed="true"]');
    expect(changed?.length).toBe(1);
    expect(changed?.[0].textContent).toContain('revisado');
    expect(changed?.[0].textContent).toContain('cambió');
    expect(step?.querySelectorAll('tr[data-changed="false"]').length).toBe(1);
  });

  it('muestra las notas de la simulación, como que no llama a la IA', () => {
    expect(el().querySelector('[data-testid="sim-notes"]')?.textContent).toContain(
      'El simulador no llama a la IA',
    );
  });

  it('variableRows incluye una variable quitada por el paso', () => {
    const rows = fixture.componentInstance.variableRows({
      stage_key: 's',
      stage_name: 'S',
      type: 'automatic',
      data: { a: 1 },
      changed: ['a', 'b'],
    });
    expect(rows).toEqual([
      { key: 'a', value: '1', changed: true },
      { key: 'b', value: '—', changed: true },
    ]);
  });
});
