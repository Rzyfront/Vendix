import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { StoreUserSelectComponent, ToastService } from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { VendixAccountBlockComponent } from '../../../platform-crm/vendix-account-block.component';
import { OpportunityFormModalComponent } from '../pipeline/opportunity-form-modal.component';
import { CrmSegmentsService } from '../shared/crm-segments.service';
import { CrmService } from '../shared/crm.service';
import {
  CrmBoard,
  CrmPerson,
  CrmPipeline,
  CrmStage,
  CrmTasksPage,
  CustomerCrmProfile,
} from '../shared/crm.interface';
import { CrmTagsManagerModalComponent } from '../shared/crm-tags-manager-modal.component';
import { TaskCompleteModalComponent } from '../shared/task-complete-modal.component';
import { TaskFormModalComponent } from '../shared/task-form-modal.component';
import { CustomerCrmPanelComponent } from './customer-crm-panel.component';

const stage = (id: number, pipeline_id: number, name: string): CrmStage => ({
  id,
  pipeline_id,
  name,
  kind: 'open',
  probability: null,
  color: '#3b82f6',
});

const PIPELINES: CrmPipeline[] = [
  { id: 1, name: 'Mayoristas', is_default: false, stages: [stage(10, 1, 'Contacto')] },
  { id: 2, name: 'Ventas', is_default: true, stages: [stage(20, 2, 'Prospecto')] },
];

const CARLA: CrmPerson = { id: 5, first_name: 'Carla', last_name: 'Ruiz' };

const profile = (customer: CrmPerson | null = CARLA): CustomerCrmProfile => ({
  customer,
  owner: null,
  source: null,
  stage: null,
  last_contact_at: null,
  consents: { whatsapp: 'unknown', sms: 'unknown', email: 'unknown', updated_at: null },
  tags: [],
  open_tasks: 0,
  overdue_tasks: 0,
  open_opportunities: { count: 0, amount: '0' },
  rfm: {
    period_days: 365,
    recency_days: null,
    frequency: 0,
    monetary: '0',
    last_purchase_at: null,
    scores: null,
    segment: null,
    description: null,
  },
});

const emptyBoard = (pipelineId: number): CrmBoard => ({
  pipeline: { id: pipelineId, name: 'x', is_default: false },
  pipelines: [],
  stages: [],
  truncated: false,
});

/** The stubbed `<app-crm-opportunity-form-modal>` receives its bindings as DOM properties. */
interface FormModalElement extends HTMLElement {
  isOpen: boolean;
  presetCustomer: CrmPerson | null;
  lockCustomer: boolean;
  pipelines: CrmPipeline[];
  presetPipelineId: number | null;
}

describe('CustomerCrmPanelComponent — Tablero: nueva oportunidad', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let fixture: ComponentFixture<CustomerCrmPanelComponent>;
  let canManage: boolean;

  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';
  const formModal = () =>
    host().querySelector('app-crm-opportunity-form-modal') as FormModalElement | null;
  const newOpportunityButton = () =>
    Array.from(host().querySelectorAll('app-button')).find((button) =>
      button.textContent?.includes('Nueva oportunidad'),
    );

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(customer: CrmPerson | null = CARLA): Promise<void> {
    crm = jasmine.createSpyObj<CrmService>('CrmService', [
      'profile',
      'notes',
      'tags',
      'customerSegments',
      'tasks',
      'pipelines',
      'board',
      'timeline',
      'createOpportunity',
    ]);
    crm.profile.and.returnValue(of(profile(customer)));
    crm.notes.and.returnValue(of([]));
    crm.tags.and.returnValue(of([]));
    crm.customerSegments.and.returnValue(of({ customer_id: 5, tags: [], segments: [] }));
    crm.tasks.and.returnValue(of({ data: [], total: 0, page: 1, totalPages: 0 } as unknown as CrmTasksPage));
    crm.pipelines.and.returnValue(of(PIPELINES));
    crm.board.and.callFake((query) => of(emptyBoard(query.pipeline_id ?? 0)));
    crm.timeline.and.returnValue(of({ data: [], meta: { has_more: false, next_before: null } }));

    await TestBed.configureTestingModule({
      imports: [CustomerCrmPanelComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CrmService, useValue: crm },
        { provide: CrmSegmentsService, useValue: { segments: () => of([]) } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        {
          provide: CurrencyFormatService,
          useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) },
        },
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => canManage,
            hasPermission: (name: string) => canManage || name === 'store:crm_pipeline:read',
            userId: () => 7,
            userName: () => 'Ana',
            userStore: () => null,
          },
        },
      ],
    })
      .overrideComponent(CustomerCrmPanelComponent, {
        remove: {
          imports: [
            OpportunityFormModalComponent,
            TaskFormModalComponent,
            TaskCompleteModalComponent,
            CrmTagsManagerModalComponent,
            VendixAccountBlockComponent,
            StoreUserSelectComponent,
          ],
        },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(CustomerCrmPanelComponent);
    fixture.componentRef.setInput('customerId', 5);
    await settle();
  }

  beforeEach(() => {
    canManage = true;
  });

  it('shows one "Nueva oportunidad" button and no stage picker that creates on the spot', async () => {
    await render();

    expect(newOpportunityButton()).toBeDefined();
    expect(text()).not.toContain('Ubicar en la etapa');
    expect(text()).not.toContain('Agregar al tablero');
    expect(formModal()?.isOpen).toBeFalse();
  });

  it('opens the pipeline form with the customer fixed and the default pipeline, without creating anything', async () => {
    await render();

    newOpportunityButton()!.querySelector('button')!.click();
    await settle();

    const modal = formModal()!;
    expect(modal.isOpen).toBeTrue();
    expect(modal.presetCustomer).toEqual(CARLA);
    expect(modal.lockCustomer).toBeTrue();
    expect(modal.pipelines).toEqual(PIPELINES);
    expect(modal.presetPipelineId).toBe(2);
    expect(crm.createOpportunity).not.toHaveBeenCalled();
  });

  it('fixes the customer by id when the profile has no name for it', async () => {
    await render(null);

    expect(formModal()!.presetCustomer).toEqual({ id: 5, first_name: null, last_name: null });
  });

  it('refreshes the board, profile and timeline after the form saves', async () => {
    await render();
    const boards = crm.board.calls.count();
    const profiles = crm.profile.calls.count();
    const timelines = crm.timeline.calls.count();

    formModal()!.dispatchEvent(new CustomEvent('saved'));
    await settle();

    expect(crm.board.calls.count()).toBeGreaterThan(boards);
    expect(crm.profile.calls.count()).toBeGreaterThan(profiles);
    expect(crm.timeline.calls.count()).toBeGreaterThan(timelines);
    expect(crm.createOpportunity).not.toHaveBeenCalled();
  });

  it('without permission to manage the pipeline there is no button nor form', async () => {
    canManage = false;
    await render();

    expect(newOpportunityButton()).toBeUndefined();
    expect(formModal()).toBeNull();
  });
});
