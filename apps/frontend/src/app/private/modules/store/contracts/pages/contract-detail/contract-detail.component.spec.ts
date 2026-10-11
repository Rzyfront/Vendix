import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
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
      profile: { profile_id: 5, version: 2, config: { admin_percent: '10' } },
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

  it('muestra líneas, condiciones, perfil congelado y advierte del alcance administrativo', () => {
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Obra');
    expect(text).toContain('Pago por hitos');
    expect(text).toContain('Perfil congelado #5');
    expect(text).toContain('versión 2');
    expect(text).toContain('flujo es administrativo');
    expect(text).toContain('Estado fiscal');
    expect(text).toContain('pending');
    expect(text).toContain('No configurado');
    expect(text).toContain('19%');
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
    expect(fixture.nativeElement.textContent).toContain('Pendiente: se genera desde el contrato vigente.');
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
    expect(fixture.nativeElement.textContent).toContain('El snapshot no incluye un perfil de cotización.');
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
});
