import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterLink, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { CustomersService } from '../../services/customers.service';
import { CrmService } from '../shared/crm.service';
import { CrmOpportunity, CrmTask } from '../shared/crm.interface';
import { OpportunityDetailModalComponent } from './opportunity-detail-modal.component';

const opportunity = (): CrmOpportunity => ({
  id: 50,
  title: 'Cotización X',
  amount: '1000',
  currency: 'COP',
  status: 'open',
  probability: 20,
  pipeline_id: 1,
  stage_id: 10,
  stage: null,
  customer: { id: 7, first_name: 'Carla', last_name: 'Ruiz' },
  owner: null,
  quotation: null,
  order_id: null,
  expected_close_date: null,
  won_at: null,
  lost_at: null,
  lost_reason: null,
  sort_order: 0,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
});

const task = (id: number, title: string, overrides: Partial<CrmTask> = {}): CrmTask => ({
  id,
  title,
  description: null,
  status: 'pending',
  due_at: '2026-11-25T15:00:00Z',
  is_overdue: false,
  completed_at: null,
  customer: { id: 7, first_name: 'Carla', last_name: 'Ruiz' },
  assigned_user: null,
  created_by: null,
  opportunity: null,
  conversation_id: null,
  created_at: '2026-11-01T00:00:00Z',
  ...overrides,
});

describe('OpportunityDetailModalComponent — pending tasks of the customer', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let toast: jasmine.SpyObj<ToastService>;
  let fixture: ComponentFixture<OpportunityDetailModalComponent>;
  let permissions: string[];
  let seeAll: boolean;

  const component = () => fixture.componentInstance as any;
  const host = () => fixture.nativeElement as HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  async function setup(open = true): Promise<void> {
    crm = jasmine.createSpyObj<CrmService>('CrmService', ['tasks', 'notes', 'completeTask']);
    crm.notes.and.returnValue(of([]));
    crm.tasks.and.returnValue(
      of({
        data: [task(1, 'Llamar', { is_overdue: true }), task(2, 'Enviar propuesta')],
        total: 2,
        page: 1,
        totalPages: 1,
      }),
    );
    crm.completeTask.and.callFake((id: number) => of(task(id, 'Llamar', { status: 'done' })));
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    await TestBed.configureTestingModule({
      imports: [OpportunityDetailModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CrmService, useValue: crm },
        { provide: ToastService, useValue: toast },
        { provide: CustomersService, useValue: { getCustomer: () => of({ id: 7, first_name: 'Carla' }) } },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => false,
            hasPermission: (permission: string) =>
              permissions.includes(permission) || (seeAll && permission === 'store:crm_inbox:assign'),
          },
        },
      ],
    })
      .overrideComponent(OpportunityDetailModalComponent, {
        set: { imports: [CurrencyPipe, RouterLink], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(OpportunityDetailModalComponent);
    fixture.componentRef.setInput('opportunity', opportunity());
    fixture.componentRef.setInput('isOpen', open);
    await settle();
  }

  beforeEach(() => {
    permissions = ['store:crm_tasks:manage'];
    seeAll = false;
  });

  it('asks for the pending tasks of the customer only when the detail opens', async () => {
    await setup(false);
    expect(crm.tasks).not.toHaveBeenCalled();

    fixture.componentRef.setInput('isOpen', true);
    await settle();
    expect(crm.tasks).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ customer_id: 7, status: 'pending', assigned: 'me' }),
    );
  });

  it('shows the whole team\'s tasks of the customer to see-all users', async () => {
    seeAll = true;
    await setup();
    expect(crm.tasks).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({ customer_id: 7, status: 'pending', assigned: 'all' }),
    );
  });

  it('lists each task with its due date and status, the overdue one highlighted', async () => {
    await setup();
    const rows = Array.from(host().querySelectorAll('[data-testid="opp-task"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Llamar');
    expect(rows[0].textContent).toContain('Vencida');
    expect(rows[0].classList).toContain('border-[var(--color-error)]');
    expect(rows[1].textContent).toContain('Enviar propuesta');
    expect(rows[1].textContent).toContain('Pendiente');
    expect(rows[1].textContent).not.toContain('Vencida');
    expect(rows[1].classList).not.toContain('border-[var(--color-error)]');
    expect(rows[1].textContent).toContain('25 de nov');
  });

  it('completes a task, refreshes the list and tells the board', async () => {
    await setup();
    const changed = jasmine.createSpy('tasksChanged');
    fixture.componentInstance.tasksChanged.subscribe(changed);
    crm.tasks.calls.reset();

    (host().querySelector('[aria-label="Completar Llamar"]') as HTMLButtonElement).click();
    await settle();

    expect(crm.completeTask).toHaveBeenCalledWith(1);
    expect(toast.success).toHaveBeenCalledWith('Tarea completada');
    expect(crm.tasks).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('creates a task for the customer and this opportunity, then refreshes and tells the board', async () => {
    await setup();
    const changed = jasmine.createSpy('tasksChanged');
    fixture.componentInstance.tasksChanged.subscribe(changed);

    component().openTaskForm();
    fixture.detectChanges();
    const form = host().querySelector('app-crm-task-form-modal') as any;
    expect(form.isOpen).toBeTrue();
    expect(form.fixedCustomer).toEqual({ id: 7, first_name: 'Carla', last_name: 'Ruiz' });
    expect(form.presetOpportunityId).toBe(50);

    crm.tasks.calls.reset();
    component().onTaskSaved();
    await settle();
    expect(crm.tasks).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('hides the tasks block without the tasks permission and asks nothing', async () => {
    permissions = [];
    await setup();
    expect(crm.tasks).not.toHaveBeenCalled();
    expect(host().querySelector('#opp-tasks')).toBeNull();
  });

  it('says so when the customer has no pending tasks', async () => {
    await setup(false);
    crm.tasks.and.returnValue(of({ data: [], total: 0, page: 1, totalPages: 1 }));
    fixture.componentRef.setInput('isOpen', true);
    await settle();
    expect(host().textContent).toContain('Sin tareas pendientes');
  });
});
