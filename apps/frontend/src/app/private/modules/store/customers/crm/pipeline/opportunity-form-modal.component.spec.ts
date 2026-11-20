import {
  NO_ERRORS_SCHEMA,
  Signal,
  WritableSignal,
  provideZonelessChangeDetection,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components';
import type { CustomerSelectOption } from '../../../../../../shared/components';
import { CrmService } from '../shared/crm.service';
import {
  CrmOpportunity,
  CrmPerson,
  CrmPipeline,
  CrmStage,
  SaveCrmOpportunity,
} from '../shared/crm.interface';
import { OpportunityFormModalComponent } from './opportunity-form-modal.component';

const stage = (
  id: number,
  pipeline_id: number,
  name: string,
  kind: CrmStage['kind'] = 'open',
): CrmStage => ({ id, pipeline_id, name, kind, probability: null, color: '#3b82f6' });

const SALES: CrmPipeline = {
  id: 1,
  name: 'Ventas',
  is_default: true,
  stages: [stage(10, 1, 'Prospecto'), stage(11, 1, 'Propuesta'), stage(14, 1, 'Perdida', 'lost')],
};
const WHOLESALE: CrmPipeline = {
  id: 2,
  name: 'Mayoristas',
  is_default: false,
  stages: [stage(20, 2, 'Contacto'), stage(21, 2, 'Negociación'), stage(24, 2, 'Perdida', 'lost')],
};

const CARLA: CrmPerson = { id: 5, first_name: 'Carla', last_name: 'Ruiz' };

/** What the specs drive and read; the template is only checked by its text. */
interface FormInternals {
  title: WritableSignal<string>;
  customer: WritableSignal<CustomerSelectOption | null>;
  pipelineId: Signal<number | null>;
  stageId: WritableSignal<number | null>;
  stageOptions: Signal<{ value: string | number; label: string }[]>;
  canSave: Signal<boolean>;
  onPipeline(value: string | number | null): void;
  save(): Promise<void>;
}

interface OpenOptions {
  stages?: CrmStage[];
  pipelines?: CrmPipeline[];
  presetCustomer?: CrmPerson | null;
  lockCustomer?: boolean;
  presetPipelineId?: number | null;
  presetStageId?: number | null;
}

describe('OpportunityFormModalComponent — presets from the customer profile', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let fixture: ComponentFixture<OpportunityFormModalComponent>;

  const form = () => fixture.componentInstance as unknown as FormInternals;
  const host = () => fixture.nativeElement as HTMLElement;
  const text = () => host().textContent ?? '';

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }

  async function open(options: OpenOptions = {}): Promise<void> {
    crm = jasmine.createSpyObj<CrmService>('CrmService', [
      'createOpportunity',
      'updateOpportunity',
      'customerQuotations',
    ]);
    crm.customerQuotations.and.returnValue(of([]));
    crm.createOpportunity.and.callFake((body: SaveCrmOpportunity) =>
      of({ id: 77, title: body.title } as CrmOpportunity),
    );
    await TestBed.configureTestingModule({
      imports: [OpportunityFormModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CrmService, useValue: crm },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => true,
            hasPermission: () => true,
            userId: () => 7,
            userName: () => 'Ana',
          },
        },
      ],
    })
      .overrideComponent(OpportunityFormModalComponent, {
        set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(OpportunityFormModalComponent);
    const ref = fixture.componentRef;
    ref.setInput('stages', options.stages ?? []);
    if (options.pipelines) ref.setInput('pipelines', options.pipelines);
    if (options.presetCustomer !== undefined) ref.setInput('presetCustomer', options.presetCustomer);
    if (options.lockCustomer !== undefined) ref.setInput('lockCustomer', options.lockCustomer);
    if (options.presetPipelineId !== undefined) ref.setInput('presetPipelineId', options.presetPipelineId);
    if (options.presetStageId !== undefined) ref.setInput('presetStageId', options.presetStageId);
    ref.setInput('isOpen', true);
    await settle();
  }

  it('opens with the customer fixed, the chosen pipeline and stage, and an empty title', async () => {
    await open({
      pipelines: [SALES, WHOLESALE],
      presetCustomer: CARLA,
      lockCustomer: true,
      presetPipelineId: 2,
      presetStageId: 21,
    });

    expect(host().querySelector('[data-testid="locked-customer"]')?.textContent).toContain('Carla Ruiz');
    expect(host().querySelector('app-customer-select')).toBeNull();
    expect(host().querySelector('app-selector[label="Pipeline"]')).not.toBeNull();
    expect(form().pipelineId()).toBe(2);
    expect(form().stageId()).toBe(21);
    expect(form().stageOptions().map((option) => option.label)).toEqual(['Contacto', 'Negociación']);
    expect(form().title()).toBe('');
    expect(form().canSave()).toBeFalse();
    expect(crm.createOpportunity).not.toHaveBeenCalled();
  });

  it('creates only on save, with what the user typed and the fixed customer', async () => {
    await open({ pipelines: [SALES, WHOLESALE], presetCustomer: CARLA, lockCustomer: true });

    form().title.set('  Dotación de uniformes 2027  ');
    expect(form().canSave()).toBeTrue();
    await form().save();

    expect(crm.createOpportunity).toHaveBeenCalledTimes(1);
    const body = crm.createOpportunity.calls.mostRecent().args[0];
    expect(body.title).toBe('Dotación de uniformes 2027');
    expect(body.title).not.toContain('Carla');
    expect(body.customer_id).toBe(5);
    expect(body.stage_id).toBe(10);
  });

  it('does not save without a title even with the customer fixed', async () => {
    await open({ pipelines: [SALES], presetCustomer: CARLA, lockCustomer: true });

    await form().save();
    expect(crm.createOpportunity).not.toHaveBeenCalled();
  });

  it('starts on the default pipeline and its first open stage when nothing is preset', async () => {
    await open({ pipelines: [WHOLESALE, SALES], presetCustomer: CARLA, lockCustomer: true });

    expect(form().pipelineId()).toBe(1);
    expect(form().stageId()).toBe(10);
    expect(text()).toContain('Cliente: Carla Ruiz');
  });

  it('ignores a preset stage that cannot be chosen (lost or of another pipeline)', async () => {
    await open({ pipelines: [SALES, WHOLESALE], presetCustomer: CARLA, lockCustomer: true, presetStageId: 14 });
    expect(form().stageId()).toBe(10);
  });

  it('changing the pipeline lists its stages and picks its first open one', async () => {
    await open({ pipelines: [SALES, WHOLESALE], presetCustomer: CARLA, lockCustomer: true });

    form().onPipeline('2');
    expect(form().pipelineId()).toBe(2);
    expect(form().stageId()).toBe(20);

    form().stageId.set(21);
    form().title.set('Pedido mayorista');
    await form().save();
    expect(crm.createOpportunity.calls.mostRecent().args[0].stage_id).toBe(21);
  });

  it('a preset customer that is not locked comes preselected in the picker', async () => {
    await open({ pipelines: [SALES], presetCustomer: CARLA });

    expect(host().querySelector('[data-testid="locked-customer"]')).toBeNull();
    expect(form().customer()?.id).toBe(5);
  });

  it('keeps the pipeline screen behavior: stages by input, no customer, no pipeline choice', async () => {
    await open({ stages: SALES.stages });

    expect(form().customer()).toBeNull();
    expect(form().pipelineId()).toBeNull();
    expect(form().stageId()).toBe(10);
    expect(host().querySelector('[data-testid="locked-customer"]')).toBeNull();
    expect(host().querySelector('app-customer-select')).not.toBeNull();
    expect(host().querySelector('app-selector[label="Pipeline"]')).toBeNull();

    form().title.set('Sin cliente');
    expect(form().canSave()).toBeFalse();
  });
});
