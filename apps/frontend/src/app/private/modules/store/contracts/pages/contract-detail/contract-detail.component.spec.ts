import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ContractDetailComponent } from './contract-detail.component';
import { ContractsService } from '../../services/contracts.service';

describe('ContractDetailComponent — lectura del snapshot administrativo', () => {
  let service: jasmine.SpyObj<ContractsService>;
  let fixture: any;

  beforeEach(async () => {
    service = jasmine.createSpyObj<ContractsService>('ContractsService', [
      'getContractById', 'getContractInvoice', 'transitionContractStatus', 'generateContractInvoice',
    ]);
    service.getContractById.and.returnValue(of({
      id: 8, store_id: 2, contract_number: 'CT-8', quotation_id: 4, status: 'active',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      contract_object: null, subtotal_amount: 100, discount_amount: 0, tax_amount: 19, grand_total: 119,
      administration_percentage: 10, contingency_percentage: 0, profit_percentage: 8,
      notes: 'Nota de cotización', terms_and_conditions: 'Pago por hitos', valid_until: null,
      profile: { profile_id: 55, version: 6, name: 'AIU obras', config: { aiu: {} }, taxable_basis: 'aiu', components_basis: 'contract', accounting_model: 'sumada', components: { administracion: 10, imprevistos: 2, utilidad: 6 } },
      economic: {
        schema_version: 1, contract_object: 'Alcance formal', direct_cost: 100, contract_value: 118, aiu_value: 18,
        invoice_profile: { profile_id: 55, version: 6, name: 'AIU obras', config: { aiu: {} }, taxable_basis: 'aiu', components_basis: 'contract', accounting_model: 'sumada', components: { administracion: 10, imprevistos: 2, utilidad: 6 } },
        quotation_profile: { profile_id: 5, version: 2, config: {} },
        invoice_lines: [{ description: 'Administración', bucket: 'administracion', quantity: 1, unit_price: 10, discount_amount: 0, base_amount: 10, tax_amount: 1.9, total_amount: 11.9, taxes: [{ tax_name: 'IVA', tax_type: 'iva', tax_rate: 19, rate_basis: 'percent', tax_amount: 1.9 }] }],
        totals: { gross_subtotal: 118, discount_amount: 0, total_before_tax: 118, tax_amount: 1.9, tax_iva: 1.9, tax_inc: 0, tax_ica: 0, tax_other: 0, total_amount: 119.9 },
        aiu: { contract_value: 118, aiu_value: 18, taxable_base: 10, minimum_base: 0, components: [{ component: 'administracion', amount: 10 }] },
      },
      snapshot: { frozen_at: '2026-01-01T00:00:00.000Z', quotation: { items: [] }, profile: { profile_id: 5, version: 2, config: {} } },
      items: [{ product_name: 'Obra', quantity: 1, unit_price: 100, discount_amount: 0, tax_rate: 0.19, tax_amount_item: 19, total_price: 119, notes: null }],
      invoice: { id: 44, invoice_number: 'FV-44', status: 'draft', dian_status: 'pending' },
    } as any));
    await TestBed.configureTestingModule({
      imports: [ContractDetailComponent],
      providers: [
        provideZonelessChangeDetection(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '8' } } } },
        { provide: ContractsService, useValue: service },
        { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy() } },
        { provide: CurrencyFormatService, useValue: { loadCurrency: () => undefined, format: (value: number) => String(value) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ContractDetailComponent);
    fixture.detectChanges();
  });

  it('muestra perfil de facturación, economía congelada y separa condición administrativa de estado fiscal', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Obra');
    expect(text).toContain('Pago por hitos');
    expect(text).toContain('AIU obras');
    expect(text).toContain('versión 6');
    expect(text).toContain('Economía AIU congelada');
    expect(text).toContain('estado administrativo');
    expect(text).toContain('Estado fiscal');
    expect(text).toContain('pending');
    expect(text).toContain('No configurado');
    expect(text).toContain('19%');
    expect(fixture.nativeElement.querySelector('app-responsive-data-view')).toBeTruthy();
    expect(text).toContain('Precio unitario');
    expect(text).not.toContain('Estado y transiciones');
    expect(fixture.componentInstance.formatTaxRate(0.19)).toBe('19%');
    expect(fixture.componentInstance.formatTaxRate(0.07)).toBe('7%');
    expect(fixture.componentInstance.formatTaxRate(0.18625)).toBe('18.625%');
  });

  it('trata invoice:null del backend como authoritative y no busca facturas indiscriminadamente', () => {
    service.getContractById.and.returnValue(of({
      id: 8, store_id: 2, contract_number: 'CT-8', quotation_id: 4, status: 'active',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      invoice: null,
    } as any));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(service.getContractInvoice).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No se puede facturar: falta el perfil y el snapshot económico congelado.');
  });

  it('representa campos faltantes del snapshot como no configurados y no inventa objeto contractual', () => {
    service.getContractById.and.returnValue(of({
      id: 9, store_id: 2, contract_number: 'CT-9', quotation_id: 5, status: 'draft',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      contract_object: null, subtotal_amount: null, discount_amount: null, tax_amount: null, grand_total: null,
      administration_percentage: null, contingency_percentage: null, profit_percentage: null,
      notes: null, terms_and_conditions: null, valid_until: null, profile: null, items: [], invoice: null,
    } as any));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No configurado en los datos contractuales disponibles.');
    expect(fixture.nativeElement.textContent).toContain('Snapshot económico no disponible');
    expect(fixture.nativeElement.textContent).not.toContain('Sin objeto registrado.');
  });

  it('explicita una tarifa histórica fuera de escala fraccional sin interpretarla como porcentaje', () => {
    service.getContractById.and.returnValue(of({
      id: 10, store_id: 2, contract_number: 'CT-10', quotation_id: 6, status: 'draft',
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      items: [{ product_name: 'Línea antigua', quantity: 1, unit_price: 100, discount_amount: 0, tax_rate: 19, tax_amount_item: 19, total_price: 119, notes: null }],
    } as any));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.componentInstance.formatTaxRate(19)).toBe('Tarifa no normalizada');
    expect(fixture.nativeElement.textContent).toContain('Tarifa no normalizada');
  });

  it('bloquea generar y cancelar mientras existe una factura activa, y no expone transición manual facturado', () => {
    const component = fixture.componentInstance;
    expect(component.canGenerateInvoice()).toBeFalse();
    expect(component.validTransitions()).not.toContain('cancelled');
    expect(component.validTransitions()).not.toContain('invoiced');
    expect(fixture.nativeElement.textContent.match(/Factura activa: resuélvela antes de cancelar el contrato\./g)?.length).toBe(1);
  });

  it('conserva las acciones administrativas una sola vez en StickyHeader', () => {
    service.getContractById.and.returnValue(of({
      id: 12, store_id: 2, contract_number: 'CT-12', quotation_id: 8, status: 'draft',
      created_at: null, updated_at: null, invoice: null,
    } as any));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-sticky-header')).toBeTruthy();
    expect(fixture.nativeElement.textContent.match(/Activar contrato/g)?.length).toBe(1);
    expect(fixture.nativeElement.textContent).not.toContain('Estado y transiciones');
  });

  it('mantiene las líneas congeladas legibles en el data view compartido y no pagina filas hijas', () => {
    const lineView = fixture.nativeElement.querySelector('app-responsive-data-view');
    expect(lineView).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Obra');
    expect(fixture.nativeElement.textContent).toContain('Total congelado');
    expect(fixture.componentInstance.formatFrozenMoney(null)).toBe('No configurado');
  });

  it('bloquea facturación de históricos sin snapshot económico explícito', () => {
    service.getContractById.and.returnValue(of({
      id: 11, store_id: 2, contract_number: 'CT-11', quotation_id: 7, status: 'active',
      created_at: null, updated_at: null, invoice: null, economic: null,
    } as any));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    expect(fixture.componentInstance.canGenerateInvoice()).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Snapshot económico no disponible');
    expect(fixture.nativeElement.textContent).toContain('No se puede facturar');
  });

  it('adjunta el id exacto del borrador y nunca cambia el estado administrativo a facturado', () => {
    const contractWithoutInvoice = {
      id: 8, store_id: 2, contract_number: 'CT-8', quotation_id: 4, status: 'active', created_at: null, updated_at: null,
      invoice: null,
      economic: {
        schema_version: 1, contract_object: null, direct_cost: null, contract_value: null, aiu_value: null,
        invoice_profile: { profile_id: 45, version: 2, name: 'AIU', config: {} }, quotation_profile: null,
        invoice_lines: [], totals: null, aiu: null,
      },
    } as any;
    const refreshedContract = { ...contractWithoutInvoice, invoice: { id: 99, invoice_number: 'FV-99', status: 'draft', total_amount: 123.45 } };
    service.getContractById.and.returnValues(of(contractWithoutInvoice), of(refreshedContract));
    service.generateContractInvoice.and.returnValue(of({ id: 99, invoice_number: 'FV-99', status: 'draft', total_amount: '123.45' }));
    fixture.componentInstance.reload();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigate = spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

    fixture.componentInstance.generateInvoice();

    expect(fixture.componentInstance.contract().status).toBe('active');
    expect(fixture.componentInstance.contract().invoice.id).toBe(99);
    expect(fixture.componentInstance.contract().invoice.status).toBe('draft');
    expect(fixture.componentInstance.contract().invoice.total_amount).toBe(123.45);
    expect(navigate).toHaveBeenCalledWith(['/admin/invoicing/invoices'], { queryParams: { invoiceId: 99 } });
  });
});
