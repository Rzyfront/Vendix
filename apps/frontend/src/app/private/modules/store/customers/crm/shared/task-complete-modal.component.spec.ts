import {
  CUSTOM_ELEMENTS_SCHEMA,
  Signal,
  WritableSignal,
  provideZonelessChangeDetection,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CrmService } from './crm.service';
import { CrmOpenOpportunity, CrmPerson, CrmStage, CrmTask } from './crm.interface';
import { TaskCompleteModalComponent } from './task-complete-modal.component';

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

const opportunity = (id: number, title: string, current = STAGES[1]): CrmOpenOpportunity => ({
  id,
  title,
  pipeline: { id: 1, name: 'Ventas' },
  stage: current,
  stages: STAGES,
});

const person = (id: number, first_name: string): CrmPerson => ({ id, first_name, last_name: null });

const task = (overrides: Partial<CrmTask> = {}): CrmTask => ({
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
  opportunity: null,
  support_users: [],
  move_to_stage: null,
  conversation_id: null,
  created_at: '2026-11-19T10:00:00Z',
  ...overrides,
});

/** What the specs drive and read; the shared components are not under test. */
interface DialogInternals {
  isOpen: Signal<boolean>;
  opportunityId: Signal<number | null>;
  stageId: WritableSignal<number | null>;
  stageOptions: Signal<{ value: string | number; label: string }[]>;
  canMove: Signal<boolean>;
  selectOpportunity(id: number | null): void;
  dismiss(): void;
  submit(move: boolean): Promise<void>;
}

describe('TaskCompleteModalComponent — ask whether to move the opportunity', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let fixture: ComponentFixture<TaskCompleteModalComponent>;
  let open: CrmOpenOpportunity[];

  const dialog = () => fixture.componentInstance as unknown as DialogInternals;
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    open = [];
    crm = jasmine.createSpyObj<CrmService>('CrmService', ['openOpportunities', 'completeTask']);
    crm.openOpportunities.and.callFake(() => of(open));
    crm.completeTask.and.callFake((id: number) => of(task({ id, status: 'done' })));
    await TestBed.configureTestingModule({
      imports: [TaskCompleteModalComponent],
      providers: [provideZonelessChangeDetection(), { provide: CrmService, useValue: crm }],
    })
      .overrideComponent(TaskCompleteModalComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(TaskCompleteModalComponent);
    fixture.detectChanges();
  });

  it('a task that already moves its opportunity completes without asking', async () => {
    const done = await fixture.componentInstance.complete(
      task({
        opportunity: { id: 50, title: 'Cotización X' },
        move_to_stage: { id: 12, name: 'Negociación', kind: 'open', color: null },
      }),
    );
    expect(crm.openOpportunities).not.toHaveBeenCalled();
    expect(crm.completeTask).toHaveBeenCalledOnceWith(99);
    expect(done?.status).toBe('done');
    expect(dialog().isOpen()).toBeFalse();
  });

  it('a task without customer completes without asking', async () => {
    await fixture.componentInstance.complete(task({ customer: null }));
    expect(crm.openOpportunities).not.toHaveBeenCalled();
    expect(crm.completeTask).toHaveBeenCalledOnceWith(99);
  });

  it('without open opportunities (or without access to them) it completes without asking', async () => {
    await fixture.componentInstance.complete(task());
    expect(crm.openOpportunities).toHaveBeenCalledWith(1);
    expect(crm.completeTask).toHaveBeenCalledOnceWith(99);

    crm.openOpportunities.and.returnValue(throwError(() => new Error('403')));
    await fixture.componentInstance.complete(task());
    expect(crm.completeTask).toHaveBeenCalledTimes(2);
    expect(dialog().isOpen()).toBeFalse();
  });

  it('an opportunity with nowhere to go is not offered', async () => {
    // Only its current stage and the lost one are left.
    open = [{ ...opportunity(50, 'Cotización X'), stages: [STAGES[1], STAGES[4]] }];
    await fixture.componentInstance.complete(task());
    expect(crm.completeTask).toHaveBeenCalledOnceWith(99);
  });

  it('asks with board and current stage, offering the other active stages', async () => {
    open = [opportunity(50, 'Cotización X')];
    void fixture.componentInstance.complete(task());
    await settle();

    expect(crm.completeTask).not.toHaveBeenCalled();
    expect(dialog().isOpen()).toBeTrue();
    expect(dialog().opportunityId()).toBe(50);
    expect(text()).toContain('Ventas · etapa actual:');
    expect(text()).toContain('Propuesta');
    expect(dialog().stageOptions().map((option) => option.label)).toEqual([
      'Prospecto',
      'Negociación',
      'Ganada',
    ]);
    // «Mover y cerrar» needs a stage.
    expect(dialog().canMove()).toBeFalse();
  });

  it('«Mover y cerrar» completes and moves the chosen opportunity', async () => {
    open = [opportunity(50, 'Cotización X')];
    const result = fixture.componentInstance.complete(task());
    await settle();

    dialog().stageId.set(12);
    expect(dialog().canMove()).toBeTrue();
    await dialog().submit(true);

    expect(crm.completeTask).toHaveBeenCalledOnceWith(99, {
      opportunity_id: 50,
      move_to_stage_id: 12,
    });
    expect((await result)?.status).toBe('done');
    expect(dialog().isOpen()).toBeFalse();
  });

  it('«Mover y cerrar» does nothing without a stage', async () => {
    open = [opportunity(50, 'Cotización X')];
    void fixture.componentInstance.complete(task());
    await settle();

    await dialog().submit(true);
    expect(crm.completeTask).not.toHaveBeenCalled();
    expect(dialog().isOpen()).toBeTrue();
  });

  it('«Solo cerrar» only completes the task', async () => {
    open = [opportunity(50, 'Cotización X')];
    const result = fixture.componentInstance.complete(task());
    await settle();

    dialog().stageId.set(12);
    await dialog().submit(false);
    expect(crm.completeTask).toHaveBeenCalledOnceWith(99);
    expect((await result)?.status).toBe('done');
  });

  it('closing the dialog does nothing and answers null', async () => {
    open = [opportunity(50, 'Cotización X')];
    const result = fixture.componentInstance.complete(task());
    await settle();

    dialog().dismiss();
    expect(await result).toBeNull();
    expect(crm.completeTask).not.toHaveBeenCalled();
    expect(dialog().isOpen()).toBeFalse();
  });

  it('with several open opportunities the most recent comes chosen and another can be picked', async () => {
    open = [
      opportunity(60, 'Renovación', STAGES[0]),
      opportunity(50, 'Cotización X'),
    ];
    void fixture.componentInstance.complete(task());
    await settle();

    expect(dialog().opportunityId()).toBe(60);
    expect(dialog().stageOptions().map((option) => option.value)).toEqual([11, 12, 13]);
    dialog().stageId.set(12);

    dialog().selectOpportunity(50);
    // The stage belongs to the other board row: choose again.
    expect(dialog().stageId()).toBeNull();
    dialog().stageId.set(13);
    await dialog().submit(true);
    expect(crm.completeTask).toHaveBeenCalledOnceWith(99, {
      opportunity_id: 50,
      move_to_stage_id: 13,
    });
  });

  it('an API error is thrown to the caller and the dialog closes', async () => {
    open = [opportunity(50, 'Cotización X')];
    crm.completeTask.and.returnValue(throwError(() => new Error('CRM_TASK_002')));
    const caught = fixture.componentInstance.complete(task()).then(
      () => null,
      (error: unknown) => error,
    );
    await settle();

    dialog().stageId.set(12);
    await dialog().submit(true);
    expect(((await caught) as Error).message).toBe('CRM_TASK_002');
    expect(dialog().isOpen()).toBeFalse();
  });
});
