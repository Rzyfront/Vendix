import {
  CUSTOM_ELEMENTS_SCHEMA,
  Signal,
  WritableSignal,
  provideZonelessChangeDetection,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, firstValueFrom, of } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components';
import type { CustomerSelectOption } from '../../../../../../shared/components';
import { CrmService } from './crm.service';
import { CrmOpenOpportunity, CrmPerson, CrmStage, CrmTask, SaveCrmTask } from './crm.interface';
import { TaskFormModalComponent } from './task-form-modal.component';

const stage = (id: number, name: string, kind: CrmStage['kind'] = 'open'): CrmStage => ({
  id,
  pipeline_id: 1,
  name,
  kind,
  probability: null,
  color: '#3b82f6',
});

const STAGES = [
  stage(10, 'Prospecto'),
  stage(11, 'Propuesta'),
  stage(12, 'Negociación'),
  stage(13, 'Ganada', 'won'),
  stage(14, 'Perdida', 'lost'),
];

const opportunity = (id: number, title: string): CrmOpenOpportunity => ({
  id,
  title,
  pipeline: { id: 1, name: 'Ventas' },
  stage: STAGES[1],
  stages: STAGES,
});

const person = (id: number, first_name: string): CrmPerson => ({ id, first_name, last_name: null });

const savedTask = (overrides: Partial<CrmTask> = {}): CrmTask => ({
  id: 99,
  title: 'Llamar',
  description: null,
  status: 'pending',
  due_at: null,
  is_overdue: false,
  completed_at: null,
  customer: person(1, 'Carla'),
  assigned_user: person(7, 'Ana'),
  created_by: person(7, 'Ana'),
  opportunity: { id: 50, title: 'Cotización X' },
  support_users: [person(5, 'Luis')],
  move_to_stage: { id: 12, name: 'Negociación', kind: 'open', color: null },
  conversation_id: null,
  created_at: '2026-11-19T10:00:00Z',
  ...overrides,
});

/** What the specs drive and read; the template is not under test here. */
interface FormInternals {
  title: WritableSignal<string>;
  customer: WritableSignal<CustomerSelectOption | null>;
  assignee: WritableSignal<number | null>;
  supporters: WritableSignal<number[]>;
  opportunityId: WritableSignal<number | null>;
  movesOpportunity: WritableSignal<boolean>;
  targetStageId: WritableSignal<number | null>;
  opportunitiesLoaded: Signal<boolean>;
  stageOptions: Signal<{ value: string | number; label: string }[]>;
  targetStageValid: Signal<boolean>;
  supportOnly: Signal<boolean>;
  canSave: Signal<boolean>;
  searchStaff(term: string): Observable<{ id: number; name: string }[]>;
  selectOpportunity(id: number | null): void;
  setMovesOpportunity(on: boolean): void;
  save(): Promise<void>;
}

describe('TaskFormModalComponent — linked opportunity and support people', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let fixture: ComponentFixture<TaskFormModalComponent>;
  let owner: boolean;
  let openByCustomer: Record<number, CrmOpenOpportunity[]>;

  const form = () => fixture.componentInstance as unknown as FormInternals;
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    // The detection answers through firstValueFrom (a microtask).
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  async function open(
    options: { task?: CrmTask | null; fixedCustomer?: CrmPerson | null } = {},
  ): Promise<void> {
    crm = jasmine.createSpyObj<CrmService>('CrmService', [
      'openOpportunities',
      'taskStaff',
      'createTask',
      'updateTask',
    ]);
    crm.taskStaff.and.returnValue(of([person(5, 'Luis'), { id: 6, first_name: null, last_name: null }]));
    crm.openOpportunities.and.callFake((customerId: number) => of(openByCustomer[customerId] ?? []));
    crm.createTask.and.callFake((body: SaveCrmTask) => of(savedTask({ title: body.title ?? '' })));
    crm.updateTask.and.callFake(() => of(savedTask()));
    await TestBed.configureTestingModule({
      imports: [TaskFormModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CrmService, useValue: crm },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => owner,
            hasPermission: () => owner,
            userId: () => 7,
            userName: () => 'Ana',
          },
        },
      ],
    })
      .overrideComponent(TaskFormModalComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(TaskFormModalComponent);
    fixture.componentRef.setInput('task', options.task ?? null);
    fixture.componentRef.setInput('fixedCustomer', options.fixedCustomer ?? null);
    fixture.componentRef.setInput('isOpen', true);
    await settle();
  }

  async function saveWith(title = 'Llamar'): Promise<void> {
    form().title.set(title);
    await form().save();
  }

  beforeEach(() => {
    owner = true;
    openByCustomer = {};
  });

  it('preselects the only open opportunity of the customer and links it on save', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({ fixedCustomer: person(1, 'Carla') });

    expect(crm.openOpportunities).toHaveBeenCalledWith(1);
    expect(form().opportunityId()).toBe(50);
    expect(text()).toContain('Ventas · etapa actual: Propuesta');

    await saveWith();
    const body = crm.createTask.calls.mostRecent().args[0];
    expect(body.opportunity_id).toBe(50);
    expect(body.customer_id).toBe(1);
    expect('move_to_stage_id' in body).toBeFalse();
  });

  it('says so when the customer has no open opportunities and links none', async () => {
    await open({ fixedCustomer: person(1, 'Carla') });

    expect(text()).toContain('Este cliente no tiene oportunidades abiertas');
    await saveWith();
    expect('opportunity_id' in crm.createTask.calls.mostRecent().args[0]).toBeFalse();
  });

  it('offers several open opportunities without preselecting any', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X'), opportunity(51, 'Renovación')];
    await open({ fixedCustomer: person(1, 'Carla') });

    expect(form().opportunitiesLoaded()).toBeTrue();
    expect(form().opportunityId()).toBeNull();
    expect(text()).not.toContain('Este cliente no tiene oportunidades abiertas');
  });

  it('clears the chosen opportunity and detects again when the customer changes', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    openByCustomer[2] = [opportunity(60, 'Otra'), opportunity(61, 'Más')];
    await open();
    form().customer.set({ id: 1, name: 'Carla' });
    await settle();
    expect(form().opportunityId()).toBe(50);
    form().setMovesOpportunity(true);
    form().targetStageId.set(12);

    form().customer.set({ id: 2, name: 'Pedro' });
    await settle();

    expect(crm.openOpportunities).toHaveBeenCalledWith(2);
    expect(form().opportunityId()).toBeNull();
    expect(form().movesOpportunity()).toBeFalse();
    expect(form().targetStageId()).toBeNull();
  });

  it('offers as target the active stages except the current and the lost ones', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({ fixedCustomer: person(1, 'Carla') });

    expect(form().stageOptions().map((option) => option.label)).toEqual([
      'Prospecto',
      'Negociación',
      'Ganada',
    ]);
  });

  it('requires the target stage when the task moves the opportunity, then sends it', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({ fixedCustomer: person(1, 'Carla') });
    form().title.set('Llamar');
    form().setMovesOpportunity(true);

    expect(form().canSave()).toBeFalse();
    await form().save();
    expect(crm.createTask).not.toHaveBeenCalled();

    form().targetStageId.set(12);
    expect(form().canSave()).toBeTrue();
    await form().save();
    const body = crm.createTask.calls.mostRecent().args[0];
    expect(body.opportunity_id).toBe(50);
    expect(body.move_to_stage_id).toBe(12);
  });

  it('sends the support people without the assignee', async () => {
    await open();
    form().supporters.set([5, 7, 6]);

    await saveWith();

    const body = crm.createTask.calls.mostRecent().args[0];
    expect(body.assigned_user_id).toBe(7);
    expect(body.support_user_ids).toEqual([5, 6]);
  });

  it('lets a seller add support people while the assignee stays out of the body', async () => {
    owner = false;
    await open();
    form().supporters.set([5]);

    await saveWith();

    const body = crm.createTask.calls.mostRecent().args[0];
    expect('assigned_user_id' in body).toBeFalse();
    expect(body.support_user_ids).toEqual([5]);
  });

  it('blocks saving with more than 10 support people', async () => {
    await open();
    form().title.set('Llamar');
    form().supporters.set([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);

    expect(form().canSave()).toBeFalse();
  });

  it('edits a saved task without resending what did not change', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({ task: savedTask() });

    expect(form().opportunityId()).toBe(50);
    expect(form().movesOpportunity()).toBeTrue();
    expect(form().targetStageId()).toBe(12);

    await saveWith('Llamar otra vez');
    const [id, body] = crm.updateTask.calls.mostRecent().args;
    expect(id).toBe(99);
    expect(body.title).toBe('Llamar otra vez');
    expect('opportunity_id' in body).toBeFalse();
    expect('move_to_stage_id' in body).toBeFalse();
    expect('support_user_ids' in body).toBeFalse();
  });

  it('clears the target stage and replaces the support people of a saved task', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({ task: savedTask() });
    form().setMovesOpportunity(false);
    form().supporters.set([6]);

    await saveWith();

    const body = crm.updateTask.calls.mostRecent().args[1];
    expect(body.move_to_stage_id).toBeNull();
    expect(body.support_user_ids).toEqual([6]);
  });

  it('keeps the target stage of a saved task whose opportunity is no longer open', async () => {
    await open({ task: savedTask() });

    await saveWith();

    expect('move_to_stage_id' in crm.updateTask.calls.mostRecent().args[1]).toBeFalse();
  });

  it('opens an old task (no support, no stage) and saves it as before', async () => {
    await open({
      task: savedTask({ opportunity: null, support_users: undefined, move_to_stage: undefined }),
    });

    expect(crm.openOpportunities).not.toHaveBeenCalled();
    await saveWith();
    const body = crm.updateTask.calls.mostRecent().args[1];
    expect(Object.keys(body).sort()).toEqual(['assigned_user_id', 'description', 'due_at', 'title']);
  });

  it('asks for the linked opportunity of a saved task too, so it shows past the first 20', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({ task: savedTask() });

    expect(crm.openOpportunities).toHaveBeenCalledWith(1, 50);
  });

  it('searches support people through the tasks API, not the POS staff lookup', async () => {
    await open();

    const found = await firstValueFrom(form().searchStaff('lu'));

    expect(crm.taskStaff).toHaveBeenCalledWith('lu');
    expect(found).toEqual([
      { id: 5, name: 'Luis' },
      { id: 6, name: 'Usuario #6' },
    ]);
  });

  it('offers the saved target marked «(actual)» when the opportunity already reached it', async () => {
    openByCustomer[1] = [{ ...opportunity(50, 'Cotización X'), stage: STAGES[2] }];
    await open({ task: savedTask() });

    expect(form().stageOptions().map((option) => option.label)).toEqual([
      'Prospecto',
      'Propuesta',
      'Negociación (actual)',
      'Ganada',
    ]);
    expect(form().targetStageId()).toBe(12);
    expect(form().canSave()).toBeTrue();
  });

  it('clears a saved target that is no longer offered and asks to choose again', async () => {
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({
      task: savedTask({ move_to_stage: { id: 99, name: 'Vieja', kind: 'open', color: null } }),
    });

    expect(form().movesOpportunity()).toBeTrue();
    expect(form().targetStageId()).toBeNull();
    expect(form().targetStageValid()).toBeFalse();
    expect(form().canSave()).toBeFalse();
    await form().save();
    expect(crm.updateTask).not.toHaveBeenCalled();

    form().targetStageId.set(12);
    expect(form().canSave()).toBeTrue();
  });

  it('shows a task where the user only helps read-only and never saves it', async () => {
    owner = false;
    openByCustomer[1] = [opportunity(50, 'Cotización X')];
    await open({
      task: savedTask({
        assigned_user: person(8, 'Beto'),
        created_by: person(9, 'Dora'),
        support_users: [person(7, 'Ana')],
      }),
    });

    expect(form().supportOnly()).toBeTrue();
    expect(text()).toContain('Eres apoyo en esta tarea');
    expect(form().canSave()).toBeFalse();
    await saveWith('Otro título');
    expect(crm.updateTask).not.toHaveBeenCalled();
  });

  it('the creator who also helps, and see-all, still edit the task', async () => {
    owner = false;
    await open({
      task: savedTask({
        opportunity: null,
        assigned_user: person(8, 'Beto'),
        created_by: person(7, 'Ana'),
        support_users: [person(7, 'Ana')],
      }),
    });
    expect(form().supportOnly()).toBeFalse();
    expect(form().canSave()).toBeTrue();

    TestBed.resetTestingModule();
    owner = true;
    await open({
      task: savedTask({
        opportunity: null,
        assigned_user: person(8, 'Beto'),
        created_by: person(9, 'Dora'),
        support_users: [person(7, 'Ana')],
      }),
    });
    expect(form().supportOnly()).toBeFalse();
  });
});
