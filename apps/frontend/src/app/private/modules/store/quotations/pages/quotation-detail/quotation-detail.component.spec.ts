import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { QuotationDetailComponent } from './quotation-detail.component';
import { QuotationsService } from '../../services/quotations.service';
import { QuotationPrintService } from '../../services/quotation-print.service';
import { ContractsService } from '../../../contracts/services/contracts.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { Quotation } from '../../interfaces/quotation.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';

describe('QuotationDetailComponent — destination gates and trace', () => {
  const quote = (overrides: Partial<Quotation> = {}): Quotation => ({
    id: 12, store_id: 1, quotation_number: 'COT-012', status: 'accepted', destination: 'contract',
    channel: 'admin', subtotal_amount: 100, discount_amount: 0, tax_amount: 0, shipping_cost: 0,
    grand_total: 100, created_at: '', updated_at: '', quotation_items: [], ...overrides,
  });
  let quotations: jasmine.SpyObj<QuotationsService>;

  function create() {
    const fixture = TestBed.createComponent(QuotationDetailComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    quotations = jasmine.createSpyObj<QuotationsService>('QuotationsService', ['getQuotationById', 'invalidateCache', 'processCompleteQuotation']);
    quotations.getQuotationById.and.returnValue(of(quote()));
    TestBed.configureTestingModule({
      imports: [QuotationDetailComponent],
      providers: [
        provideRouter([]),
        { provide: QuotationsService, useValue: quotations },
        { provide: QuotationPrintService, useValue: { printQuotation: jasmine.createSpy('printQuotation') } },
        { provide: ContractsService, useValue: { createFromQuotation: jasmine.createSpy('createFromQuotation') } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '12' } } } },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
        { provide: AuthFacade, useValue: {
          storeIndustries: () => ['construction'],
          userPermissions: () => ['store:contracts:create', 'store:quotations:update', 'store:quotations:convert'],
          userRoles: () => [],
        } },
        { provide: DialogService, useValue: { confirm: () => Promise.resolve(true) } },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
      ],
    });
  });

  it('shows contract creation but never order conversion or full-sale processing for accepted contract quotes', () => {
    const fixture = create();
    const component = fixture.componentInstance;
    const actions = component.headerActions();
    expect(actions.find((action) => action.id === 'create-contract')?.visible).toBeTrue();
    expect(actions.find((action) => action.id === 'convert')?.visible).toBeFalse();
    expect(component.canProcessAll()).toBeFalse();
    component.onHeaderAction('convert');
    expect(quotations.processCompleteQuotation).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('renders contracted status and preserves a linkable contract trace', () => {
    quotations.getQuotationById.and.returnValue(of(quote({
      status: 'contracted',
      contract: { id: 88, contract_number: 'CTR-088', status: 'draft' },
    })));
    const fixture = create();
    const component = fixture.componentInstance;
    expect(component.statusLabel()).toBe('Contratada');
    expect(component.timelineSteps().some((step) => step.key === 'contracted' && step.description === 'Contrato CTR-088')).toBeTrue();
    expect(component.headerActions().some((action) => action.id === 'convert' && action.visible)).toBeFalse();
    const contractLink = fixture.nativeElement.querySelector('a[href="/admin/orders/contracts/88"]') as HTMLAnchorElement | null;
    expect(contractLink?.textContent).toContain('CTR-088');
    fixture.destroy();
  });

  it('keeps legacy missing destinations on the sale progression', () => {
    quotations.getQuotationById.and.returnValue(of(quote({ destination: undefined })));
    const fixture = create();
    const component = fixture.componentInstance;
    expect(component.headerActions().find((action) => action.id === 'convert')?.visible).toBeTrue();
    expect(component.canProcessAll()).toBeTrue();
    fixture.destroy();
  });
});
