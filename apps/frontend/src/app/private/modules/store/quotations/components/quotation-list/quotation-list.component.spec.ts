import { TestBed } from '@angular/core/testing';
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
});
