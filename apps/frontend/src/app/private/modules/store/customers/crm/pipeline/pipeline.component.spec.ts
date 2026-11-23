import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { CdkScrollable, ScrollDispatcher } from '@angular/cdk/scrolling';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OptionsDropdownComponent, ToastService } from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { CrmService } from '../shared/crm.service';
import { CrmBoard, CrmOpportunity } from '../shared/crm.interface';
import { TaskFormModalComponent } from '../shared/task-form-modal.component';
import { OpportunityDetailModalComponent } from './opportunity-detail-modal.component';
import { OpportunityFormModalComponent } from './opportunity-form-modal.component';
import { PipelineComponent } from './pipeline.component';
import { StageTemplatesModalComponent } from './stage-templates-modal.component';

const board = (pipelines = 2): CrmBoard => ({
  pipeline: { id: 1, name: 'Ventas', is_default: true },
  pipelines: Array.from({ length: pipelines }, (_, index) => ({
    id: index + 1,
    name: index === 0 ? 'Ventas' : `Pipeline ${index + 1}`,
    is_default: index === 0,
  })),
  stages: [],
  truncated: false,
});

describe('PipelineComponent — header filters and actions', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let fixture: ComponentFixture<PipelineComponent>;
  let owner = true;

  async function setup(pipelines = 2): Promise<OptionsDropdownComponent> {
    crm = jasmine.createSpyObj<CrmService>('CrmService', ['board']);
    crm.board.and.returnValue(of(board(pipelines)));
    await TestBed.configureTestingModule({
      imports: [PipelineComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CrmService, useValue: crm },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
        { provide: AuthFacade, useValue: { isOwner: () => owner, hasPermission: () => owner } },
      ],
    })
      .overrideComponent(PipelineComponent, {
        remove: {
          imports: [
            OpportunityFormModalComponent,
            OpportunityDetailModalComponent,
            StageTemplatesModalComponent,
            TaskFormModalComponent,
          ],
        },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(PipelineComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.debugElement.query(By.directive(OptionsDropdownComponent)).componentInstance;
  }

  const component = () => fixture.componentInstance as any;

  beforeEach(() => (owner = true));

  it('moves pipeline and owner filters into the dropdown and keeps only the view switch visible', async () => {
    const dropdown = await setup(2);
    expect(dropdown.filters().map((filter) => filter.key)).toEqual(['pipeline_id', 'owner']);
    expect(dropdown.filters()[0].options?.map((option) => option.label)).toEqual(['Ventas', 'Pipeline 2']);
    expect(dropdown.filters()[1].options?.map((option) => option.value)).toEqual(['', 'me']);
    const header: HTMLElement = fixture.nativeElement.querySelector('[slot="header"]');
    expect(header.querySelectorAll('select').length).toBe(0);
    expect(header.querySelector('[role="group"][aria-label="Vista"]')).toBeTruthy();
    // The templates action is owned by the options dropdown, not a standalone header button.
    const standaloneButtons = Array.from(header.querySelectorAll('app-button')).filter(
      (button) => !button.closest('app-options-dropdown'),
    );
    expect(standaloneButtons.length).toBe(0);
    // With a single action, the dropdown still shows the Acciones menu trigger, not a labelled button.
    expect(dropdown.singleActionAsMenu()).toBeTrue();
    expect(header.querySelector('.single-action-trigger')).toBeNull();
    expect(header.textContent).not.toContain('Plantillas de etapas');
    expect(header.querySelector('.actions-trigger')!.textContent).toContain('Acciones');
  });

  it('omits the pipeline filter with a single pipeline and the owner filter without see-all', async () => {
    owner = false;
    const dropdown = await setup(1);
    expect(dropdown.filters()).toEqual([]);
    expect(dropdown.actions()).toEqual([]);
  });

  it('reloads the board when a filter changes, and the defaults do not count as active', async () => {
    const dropdown = await setup(2);
    expect(dropdown.filterValues()).toEqual({ pipeline_id: null, owner: null });
    dropdown.filterChange.emit({ pipeline_id: '2', owner: 'me' });
    await fixture.whenStable();
    expect(crm.board).toHaveBeenCalledWith({ pipeline_id: 2, owner: 'me', q: undefined });
    fixture.detectChanges();
    expect(dropdown.filterValues()).toEqual({ pipeline_id: '2', owner: 'me' });
    dropdown.clearAllFilters.emit();
    expect(component().pipelineId()).toBeNull();
    expect(component().owner()).toBe('');
  });

  it('opens the stage templates modal from the "templates" item of the Acciones menu', async () => {
    const dropdown = await setup(2);
    expect(dropdown.actions()).toEqual([{ label: 'Plantillas de etapas', icon: 'layers', action: 'templates' }]);
    const host: HTMLElement = fixture.nativeElement;
    (host.querySelector('app-options-dropdown .actions-trigger') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const item = host.querySelector('app-options-dropdown .actions-dropdown .action-item') as HTMLButtonElement;
    expect(item.textContent).toContain('Plantillas de etapas');
    item.click();
    await fixture.whenStable();
    expect(component().templatesOpen()).toBeTrue();
  });

  it('gives the board air under the card header', async () => {
    await setup(2);
    const row: HTMLElement = fixture.nativeElement.querySelector('[cdkDropListGroup]');
    expect(row.parentElement!.classList).toContain('pt-6');
  });
});

const card = (overrides: Partial<CrmOpportunity> = {}): CrmOpportunity => ({
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
  ...overrides,
});

const boardWithCard = (): CrmBoard => ({
  ...board(1),
  stages: [
    {
      id: 10,
      pipeline_id: 1,
      name: 'Prospecto',
      kind: 'open',
      probability: 20,
      color: null,
      count: 1,
      total_amount: '1000',
      opportunities: [card()],
    },
  ],
});

describe('PipelineComponent — board cards', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let fixture: ComponentFixture<PipelineComponent>;
  let pageScroller: HTMLElement;
  let permissions: string[];

  const component = () => fixture.componentInstance as any;
  const host = () => fixture.nativeElement as HTMLElement;

  async function setup(): Promise<void> {
    crm = jasmine.createSpyObj<CrmService>('CrmService', ['board']);
    crm.board.and.returnValue(of(boardWithCard()));
    await TestBed.configureTestingModule({
      imports: [PipelineComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: CrmService, useValue: crm },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error']) },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
        {
          provide: AuthFacade,
          useValue: {
            isOwner: () => false,
            hasPermission: (permission: string) => permissions.includes(permission),
          },
        },
      ],
    })
      .overrideComponent(PipelineComponent, {
        remove: {
          imports: [
            OpportunityFormModalComponent,
            OpportunityDetailModalComponent,
            StageTemplatesModalComponent,
            TaskFormModalComponent,
          ],
        },
        add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    // The admin layout scrolls a <main>, not the window.
    pageScroller = document.createElement('main');
    pageScroller.style.cssText = 'display:block;height:200px;overflow-y:auto';
    document.body.appendChild(pageScroller);
    fixture = TestBed.createComponent(PipelineComponent);
    pageScroller.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = ['store:crm_pipeline:manage', 'store:crm_tasks:manage'];
  });

  afterEach(() => {
    fixture?.destroy();
    pageScroller?.remove();
  });

  it('drags a card only from its grip handle, a full-height strip of at least 44 px', async () => {
    await setup();
    const handles = fixture.debugElement.queryAll(By.directive(CdkDragHandle));
    expect(handles.length).toBe(1);
    const handle = handles[0].nativeElement as HTMLElement;
    expect(handle.getAttribute('aria-label')).toBe('Arrastrar Cotización X');
    expect(handle.classList).toContain('w-11');
    expect(handle.classList).toContain('self-stretch');
    expect(handle.classList).toContain('touch-none');
    // The handle belongs to the card's drag, so the rest of the card scrolls natively.
    expect(handles[0].injector.get(CdkDrag)).toBe(
      fixture.debugElement.query(By.directive(CdkDrag)).injector.get(CdkDrag),
    );
  });

  it('opens nothing when the handle is tapped without dragging', async () => {
    await setup();
    (host().querySelector('[cdkDragHandle]') as HTMLElement).click();
    expect(component().detailOpen()).toBeFalse();
  });

  it('keeps a touch on the handle from the page pull-to-refresh, but not a touch elsewhere', async () => {
    await setup();
    const reached: EventTarget[] = [];
    pageScroller.addEventListener('touchstart', (event) => reached.push(event.target!));
    const touch = (target: Element) => {
      const point = new Touch({ identifier: 1, target, clientX: 10, clientY: 10 });
      target.dispatchEvent(
        new TouchEvent('touchstart', {
          bubbles: true,
          touches: [point],
          targetTouches: [point],
          changedTouches: [point],
        }),
      );
    };
    touch(host().querySelector('[cdkDragHandle]')!);
    expect(reached.length).toBe(0);
    touch(host().querySelector('article a')!);
    expect(reached.length).toBe(1);
  });

  it('shows no handle without the pipeline manage permission', async () => {
    permissions = ['store:crm_tasks:manage'];
    await setup();
    expect(fixture.debugElement.queryAll(By.directive(CdkDragHandle)).length).toBe(0);
  });

  it('auto-scrolls the stages row, every column and the page while dragging', async () => {
    await setup();
    const row = host().querySelector('[cdkDropListGroup]') as HTMLElement;
    expect(fixture.debugElement.query(By.css('[cdkDropListGroup]')).injector.get(CdkScrollable)).toBeTruthy();
    const list = host().querySelector('[cdkDropList]') as HTMLElement;
    expect(list.classList).toContain('overflow-y-auto');
    const ancestors = TestBed.inject(ScrollDispatcher)
      .getAncestorScrollContainers(list)
      .map((scrollable) => scrollable.getElementRef().nativeElement);
    expect(ancestors).toContain(row);
    expect(ancestors).toContain(pageScroller);
  });

  it('stops registering the page scroller when the board is destroyed', async () => {
    await setup();
    const dispatcher = TestBed.inject(ScrollDispatcher);
    const isPage = () =>
      Array.from(dispatcher.scrollContainers.keys()).some(
        (scrollable) => scrollable.getElementRef().nativeElement === pageScroller,
      );
    expect(isPage()).toBeTrue();
    fixture.destroy();
    expect(isPage()).toBeFalse();
  });

  it('creates a task for the card customer and opportunity without opening the detail', async () => {
    await setup();
    const button = host().querySelector('[aria-label="Crear tarea"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    button.click();
    fixture.detectChanges();
    expect(component().detailOpen()).toBeFalse();
    expect(component().taskFormOpen()).toBeTrue();
    const modal = host().querySelector('app-crm-task-form-modal') as any;
    expect(modal.fixedCustomer).toEqual({ id: 7, first_name: 'Carla', last_name: 'Ruiz' });
    expect(modal.presetOpportunityId).toBe(50);
  });

  it('reloads the board after a task is saved', async () => {
    await setup();
    crm.board.calls.reset();
    fixture.debugElement.query(By.css('app-crm-task-form-modal')).triggerEventHandler('saved', {});
    expect(crm.board).toHaveBeenCalledTimes(1);
  });

  it('hides "Crear tarea" without the tasks permission', async () => {
    permissions = ['store:crm_pipeline:manage'];
    await setup();
    expect(host().querySelector('[aria-label="Crear tarea"]')).toBeNull();
  });
});
