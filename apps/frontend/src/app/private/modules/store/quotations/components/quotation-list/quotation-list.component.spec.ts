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
});
