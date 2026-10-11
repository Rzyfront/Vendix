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

  it('renders frozen AIU profile, formal object, agreed due date, economic lines and server totals', () => {
    quotations.getQuotationById.and.returnValue(of(quote({
      status: 'accepted',
      subtotal_amount: 999,
      discount_amount: 0,
      tax_amount: 0,
      grand_total: 999,
      notes: 'Nota operativa; no es objeto contractual',
      quotation_items: [{ id: 1, quotation_id: 12, product_name: 'Costo base', quantity: 1, unit_price: 100, discount_amount: 0, total_price: 100 }],
      contract_economic_snapshot: {
        schema_version: 1,
        frozen_at: '2026-06-01T00:00:00.000Z',
        invoice_profile: {
          profile_id: 44,
          version: 7,
          name: 'Perfil AIU congelado',
          config: { aiu: {
            regime: 'et_462_1', taxable_basis: 'utilidad', contract_object: 'Objeto desde perfil NO mostrado',
            components_basis: 'contract', accounting_model: 'sumada', components: { administracion: '10.00', imprevistos: '2.00', utilidad: '6.50' },
            enforce_minimum_base: true, minimum_base_percent: '10.00',
          } },
        },
        contract_object: 'Objeto contractual explícito congelado',
        due_date: '2026-06-15',
        aiu_value: '18.50', direct_cost: '100.00', contract_value: '118.50',
        invoice_lines: [{ bucket: 'administracion', description: 'Administración', quantity: '1', unit_price: '10.00', discount_amount: '0.00' }],
        calculation: {
          lines: [{ line_extension_amount: '10.00', tax_amount: '1.90', total_amount: '11.90', taxes: [{ tax_name: 'IVA', tax_type: 'iva', tax_rate: '19', rate_basis: 'percent', tax_amount: '1.90' }] }],
          totals: { gross_subtotal: '110.00', discount_amount: '10.00', tax_amount: '1.90', total_amount: '101.90' },
          aiu: { contract_value: '118.50', aiu_value: '18.50', taxable_base: '6.50' },
        },
      } as any,
    })));

    const fixture = create();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Perfil AIU congelado');
    expect(text).toContain('versión 7');
    expect(text).toContain('Objeto contractual explícito congelado');
    expect(text).not.toContain('Objeto desde perfil NO mostrado');
    expect(text).toContain('Notas');
    expect(text).toContain('Nota operativa; no es objeto contractual');
    expect(text).toContain('Fecha de pago acordada:');
    expect(text).toContain('15/6/2026');
    expect(text).toContain('Costo directo cotizado');
    expect(text).toContain('Desglose económico fiscal congelado');
    expect(text).toContain('Administración');
    expect(text).toContain('101.9');
    expect(fixture.componentInstance.summaryAmount('gross_subtotal', 999)).toBe(110);
    expect(fixture.componentInstance.summaryAmount('total_amount', 999)).toBe(101.9);
    fixture.destroy();
  });

  it('warns on legacy contract quote without economic snapshot and keeps sale details unchanged', () => {
    quotations.getQuotationById.and.returnValue(of(quote({
      destination: 'contract',
      contract_economic_snapshot: null,
      notes: 'Notas históricas, no objeto formal',
    })));
    const contractFixture = create();
    expect(contractFixture.nativeElement.textContent).toContain('no conserva un snapshot económico');
    expect(contractFixture.nativeElement.textContent).toContain('Notas');
    expect(contractFixture.nativeElement.textContent).toContain('Notas históricas, no objeto formal');
    expect(contractFixture.nativeElement.textContent).not.toContain('Objeto contractual');
    expect(contractFixture.nativeElement.textContent).toContain('No configurado · revisar');
    contractFixture.destroy();

    quotations.getQuotationById.and.returnValue(of(quote({
      destination: 'sale',
      contract_economic_snapshot: null,
      grand_total: 119,
      quotation_items: [{ id: 2, quotation_id: 12, product_name: 'Producto venta', quantity: 1, unit_price: 100, discount_amount: 0, total_price: 119 }],
    })));
    const saleFixture = create();
    expect(saleFixture.nativeElement.textContent).toContain('Items');
    expect(saleFixture.nativeElement.textContent).toContain('Producto venta');
    expect(saleFixture.nativeElement.textContent).not.toContain('Economía contractual congelada');
    expect(saleFixture.nativeElement.textContent).not.toContain('Costo directo cotizado');
    expect(saleFixture.componentInstance.summaryAmount('total_amount', 119)).toBe(119);
    saleFixture.destroy();
  });
});
