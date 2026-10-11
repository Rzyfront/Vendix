import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { QuotationListComponent } from './quotation-list.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { Quotation } from '../../interfaces/quotation.interface';

describe('QuotationListComponent — destination actions', () => {
  function row(overrides: Partial<Quotation> = {}): Quotation {
    return {
      id: 1, store_id: 1, quotation_number: 'COT-1', status: 'accepted', destination: 'sale',
      channel: 'admin', subtotal_amount: 100, discount_amount: 0, tax_amount: 0, shipping_cost: 0,
      grand_total: 100, created_at: '', updated_at: '', quotation_items: [], ...overrides,
    };
  }

  function create() {
    const fixture = TestBed.createComponent(QuotationListComponent);
    fixture.componentRef.setInput('quotations', []);
    fixture.componentRef.setInput('canConvertToOrder', true);
    fixture.componentRef.setInput('canCreateFromQuotation', true);
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [QuotationListComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [{ provide: CurrencyFormatService, useValue: { format: (value: number) => String(value) } }],
    });
  });

  it('offers contract creation only for accepted contract quotes and never offers order conversion', () => {
    const fixture = create();
    const actions = fixture.componentInstance.actions;
    const createContract = actions.find((action) => action.label === 'Crear contrato')!;
    const convertToOrder = actions.find((action) => action.label === 'Convertir a Orden')!;
    expect(createContract.show?.(row({ destination: 'contract' }))).toBeTrue();
    expect(createContract.show?.(row({ destination: 'contract', status: 'contracted' }))).toBeFalse();
    expect(convertToOrder.show?.(row({ destination: 'contract' }))).toBeFalse();
    expect(convertToOrder.show?.(row({ destination: 'other' }))).toBeFalse();
    fixture.destroy();
  });

  it('treats a missing legacy destination as sale and respects conversion permission', () => {
    const fixture = create();
    const convertToOrder = fixture.componentInstance.actions.find((action) => action.label === 'Convertir a Orden')!;
    expect(convertToOrder.show?.(row({ destination: undefined }))).toBeTrue();
    fixture.componentRef.setInput('canConvertToOrder', false);
    expect(convertToOrder.show?.(row({ destination: undefined }))).toBeFalse();
    fixture.destroy();
  });

  it('renders permission-filtered standard actions and emits the existing outputs from the real menu', () => {
    const fixture = create();
    fixture.componentRef.setInput('canCreateQuotation', true);
    fixture.componentRef.setInput('showContractAction', true);
    fixture.componentRef.setInput('canReadProfiles', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const createSpy = jasmine.createSpy('create');
    const contractSpy = jasmine.createSpy('createContract');
    const profilesSpy = jasmine.createSpy('manageProfiles');
    component.create.subscribe(createSpy);
    component.createContract.subscribe(contractSpy);
    component.manageProfiles.subscribe(profilesSpy);

    expect(component.dropdownActions().map((action) => action.label)).toEqual([
      'Crear cotización de venta', 'Cotizar contrato', 'Perfiles',
    ]);
    const openActions = () => {
      fixture.nativeElement.querySelector('button[aria-label="Acciones"]').click();
      fixture.detectChanges();
    };
    const clickAction = (label: string) => {
      openActions();
      const button = [...fixture.nativeElement.querySelectorAll('button.action-item')]
        .find((element: any) => element.textContent.includes(label)) as HTMLButtonElement;
      expect(button).toBeTruthy();
      button.click();
      fixture.detectChanges();
    };
    clickAction('Crear cotización de venta');
    clickAction('Cotizar contrato');
    clickAction('Perfiles');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(contractSpy).toHaveBeenCalledTimes(1);
    expect(profilesSpy).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('updates the real menu actions when permission inputs change', () => {
    const fixture = create();
    fixture.detectChanges();
    expect(fixture.componentInstance.dropdownActions()).toEqual([]);
    fixture.componentRef.setInput('canCreateQuotation', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.dropdownActions().map((action) => action.action)).toEqual(['create']);
    fixture.componentRef.setInput('canCreateQuotation', false);
    fixture.componentRef.setInput('showContractAction', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.dropdownActions().map((action) => action.action)).toEqual(['createContract']);
    fixture.destroy();
  });

  it('renders remote pagination below the responsive list and emits clear-filter from the dropdown', () => {
    const fixture = TestBed.createComponent(QuotationListComponent);
    fixture.componentRef.setInput('quotations', [row()]);
    fixture.componentRef.setInput('paginationData', { page: 1, limit: 1, total: 2, totalPages: 2 });
    fixture.componentRef.setInput('filterValues', { status: 'sent' });
    fixture.detectChanges();
    const pageChange = jasmine.createSpy('pageChange');
    const clearAllFilters = jasmine.createSpy('clearAllFilters');
    fixture.componentInstance.pageChange.subscribe(pageChange);
    fixture.componentInstance.clearAllFilters.subscribe(clearAllFilters);
    expect(fixture.nativeElement.querySelector('app-responsive-data-view')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-pagination')).toBeTruthy();
    (fixture.nativeElement.querySelector('button.pagination-arrow[aria-label="Next page"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(pageChange).toHaveBeenCalledOnceWith(2);

    fixture.nativeElement.querySelector('button[aria-label^="Filtros"]').click();
    fixture.detectChanges();
    const clearButton = fixture.nativeElement.querySelector('button.clear-all-btn') as HTMLButtonElement;
    expect(clearButton).toBeTruthy();
    clearButton.click();
    fixture.detectChanges();
    expect(clearAllFilters).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('keeps read-only detail actions available in desktop and mobile for accepted and contracted quotes', async () => {
    const accepted = row({ id: 3, quotation_number: 'COT-3', status: 'accepted' });
    const contracted = row({ id: 4, quotation_number: 'COT-4', status: 'contracted', destination: 'contract' });
    const fixture = TestBed.createComponent(QuotationListComponent);
    fixture.componentRef.setInput('quotations', [accepted, contracted]);
    fixture.componentRef.setInput('canMutateQuotation', false);
    fixture.componentRef.setInput('canConvertToOrder', false);
    fixture.componentRef.setInput('canCreateFromQuotation', false);
    fixture.componentRef.setInput('canUpdateContractQuotation', false);
    fixture.componentRef.setInput('canDeleteQuotation', false);
    fixture.detectChanges();
    for (const block of await fixture.getDeferBlocks()) {
      await block.render(DeferBlockState.Complete);
    }
    fixture.detectChanges();

    const component = fixture.componentInstance;
    const toolbar = fixture.nativeElement.querySelector('div.flex.flex-wrap.items-center.gap-2') as HTMLDivElement;
    const searchControl = fixture.nativeElement.querySelector('app-inputsearch') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(searchControl.classList.contains('min-w-0')).toBeTrue();
    const details: Quotation[] = [];
    const accept = jasmine.createSpy('accept');
    const convert = jasmine.createSpy('convert');
    component.viewDetail.subscribe((item) => details.push(item));
    component.accept.subscribe(accept);
    component.convert.subscribe(convert);

    const desktopButtons = fixture.nativeElement.querySelectorAll(
      'app-table button[aria-label^="Ver detalle"]',
    ) as NodeListOf<HTMLButtonElement>;
    const mobileButtons = fixture.nativeElement.querySelectorAll(
      'app-item-list button[aria-label^="Ver detalle"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(desktopButtons.length).toBe(2);
    expect(mobileButtons.length).toBe(2);
    [...desktopButtons, ...mobileButtons].forEach((button) => button.click());
    fixture.detectChanges();

    expect(details.map((item) => item.id)).toEqual([3, 4, 3, 4]);
    expect(accept).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
    expect(component.actions[0].label).toBe('Ver detalle');
    expect(component.actions[0].icon).toBe('eye');
    expect(component.actions[0].variant).toBe('info');
    expect(component.columns.map((column) => column.priority)).toEqual([0, 1, 1, 1, 2, 3]);
    expect(component.columns[1].defaultValue).toBe('Sin cliente');
    expect(component.filterOptions[0].options?.[0]).toEqual({ label: 'Todos', value: '' });
    fixture.destroy();
  });

  it('shows a list error retry banner whose native button only emits a reload request', () => {
    const fixture = TestBed.createComponent(QuotationListComponent);
    fixture.componentRef.setInput('quotations', []);
    fixture.componentRef.setInput('loadError', 'No fue posible cargar cotizaciones.');
    fixture.detectChanges();
    const refresh = jasmine.createSpy('refresh');
    const accept = jasmine.createSpy('accept');
    const convert = jasmine.createSpy('convert');
    fixture.componentInstance.refresh.subscribe(refresh);
    fixture.componentInstance.accept.subscribe(accept);
    fixture.componentInstance.convert.subscribe(convert);

    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      'No fue posible cargar cotizaciones.',
    );
    expect(fixture.nativeElement.querySelector('app-empty-state')).toBeNull();
    const retryButton = [...fixture.nativeElement.querySelectorAll('button')]
      .find((button: any) => button.textContent.includes('Reintentar')) as HTMLButtonElement;
    expect(retryButton).toBeTruthy();
    expect(retryButton.textContent).toContain('Reintentar');
    retryButton.click();
    fixture.detectChanges();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(accept).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
