import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { OptionsDropdownComponent, ToastService } from '../../../../../../shared/components';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { CrmService } from '../shared/crm.service';
import { CrmBoard } from '../shared/crm.interface';
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
          imports: [OpportunityFormModalComponent, OpportunityDetailModalComponent, StageTemplatesModalComponent],
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
    expect(header.querySelector('app-options-dropdown')!.textContent).toContain('Plantillas de etapas');
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

  it('opens the stage templates modal from the "templates" action', async () => {
    const dropdown = await setup(2);
    expect(dropdown.actions()).toEqual([{ label: 'Plantillas de etapas', icon: 'layers', action: 'templates' }]);
    dropdown.actionClick.emit('templates');
    expect(component().templatesOpen()).toBeTrue();
  });

  it('gives the board air under the card header', async () => {
    await setup(2);
    const row: HTMLElement = fixture.nativeElement.querySelector('[cdkDropListGroup]');
    expect(row.parentElement!.classList).toContain('pt-6');
  });
});
