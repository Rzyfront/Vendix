import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ContractsService, ContractApiError } from './contracts.service';
import { CONTRACT_TRANSITIONS, isValidContractTransition } from '../interfaces/contract.interface';

describe('ContractsService — API y snapshot congelado', () => {
  let service: ContractsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ContractsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('mapea economía AIU y factura desde el snapshot congelado, nunca desde el perfil de cotización', () => {
    let result: any;
    service.getContractById(9).subscribe((value) => result = value);
    http.expectOne((request) => request.url.endsWith('/store/contracts/9')).flush({ data: {
      id: 9, store_id: 2, contract_number: 'CT-9', quotation_id: 4, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-02',
      subtotal_amount: '999', grand_total: '999', notes: 'nota legacy no contractual',
      administration_percentage: 99, contract_object: 'objeto plano no congelado',
      snapshot: {
        frozen_at: '2026-01-02T00:00:00.000Z',
        quotation: {
          id: 4, quotation_number: 'COT-4', destination: 'contract', status: 'accepted',
          subtotal_amount: '100.00', discount_amount: '0.00', tax_amount: '19.00', grand_total: '119.00',
          valid_until: null, notes: null, terms_and_conditions: 'Pago pactado', accepted_at: null,
          items: [{ product_name: 'Obra', quantity: '2', unit_price: '50.00', discount_amount: '0.00', tax_rate: '19', tax_amount_item: '19.00', total_price: '119.00', notes: null }],
        },
        profile: { profile_id: 12, version: 3, config: { admin_percent: '10.00', contingency_percent: 0, profit_percent: '8.5', notes: 'perfil cotización; no objeto' } },
        economic: {
          schema_version: 1,
          contract_object: 'Alcance formal congelado',
          direct_cost: '100.00', contract_value: '118.50', aiu_value: '18.50',
          invoice_profile: { profile_id: 44, version: 7, name: 'AIU obras v7', config: { aiu: { taxable_basis: 'utilidad', components_basis: 'contract', accounting_model: 'sumada', components: { administracion: '10.00', imprevistos: '2.00', utilidad: '6.50' } } } },
          invoice_lines: [{ description: 'Administración', bucket: 'administracion', quantity: '1', unit_price: '11.85', discount_amount: '0.00' }],
          calculation: {
            lines: [{ line_extension_amount: '11.85', tax_amount: '2.25', total_amount: '14.10', taxes: [{ tax_name: 'IVA', tax_type: 'iva', tax_rate: '19', rate_basis: 'percent', tax_amount: '2.25' }] }],
            totals: { gross_subtotal: '110.00', discount_amount: '10.00', total_before_tax: '100.00', tax_amount: '1.90', tax_iva: '1.90', tax_inc: '0.00', tax_ica: '0.00', tax_other: '0.00', total_amount: '101.90' },
            aiu: { contract_value: '118.50', aiu_value: '18.50', taxable_base: '6.50', minimum_base: '0.00' },
          },
        },
      },
    } });

    expect(result.subtotal_amount).toBe(110);
    expect(result.discount_amount).toBe(10);
    expect(result.tax_amount).toBe(1.9);
    expect(result.grand_total).toBe(101.9);
    expect(result.notes).toBeNull();
    expect(result.terms_and_conditions).toBe('Pago pactado');
    expect(result.contract_object).toBe('Alcance formal congelado');
    expect(result.administration_percentage).toBe(10);
    expect(result.profile.profile_id).toBe(44);
    expect(result.profile.version).toBe(7);
    expect(result.profile.name).toBe('AIU obras v7');
    expect(result.profile.taxable_basis).toBe('utilidad');
    expect(result.profile.components_basis).toBe('contract');
    expect(result.profile.accounting_model).toBe('sumada');
    expect(result.economic.invoice_lines[0].taxes[0].tax_amount).toBe(2.25);
    expect(result.economic.totals.total_amount).toBe(101.9);
    expect(result.quotation_profile.profile_id).toBe(12);
    expect(result.items[0].unit_price).toBe(50);
    expect(result.snapshot.quotation.grand_total).toBe('119.00');
    expect(result.snapshot.profile.config.admin_percent).toBe('10.00');
    expect(result.snapshot.economic.invoice_profile.version).toBe(7);
  });

  it('lee el formato legacy sin snapshot y representa importes ausentes/invalidos como null, preservando cero', () => {
    let result: any;
    service.getContractById(10).subscribe((value) => result = value);
    http.expectOne((request) => request.url.endsWith('/store/contracts/10')).flush({ data: {
      id: 10, store_id: 2, contract_number: 'CT-10', quotation_id: 4, status: 'draft',
      subtotal_amount: 'not-a-number', grand_total: null, discount_amount: '0',
      administration_percentage: 0, notes: 'Descripción operativa que no es el objeto contractual',
    } });
    expect(result.subtotal_amount).toBeNull();
    expect(result.grand_total).toBeNull();
    expect(result.discount_amount).toBe(0);
    expect(result.administration_percentage).toBe(0);
    expect(result.terms_and_conditions).toBeNull();
    expect(result.contract_object).toBeNull();
    expect(result.notes).toBe('Descripción operativa que no es el objeto contractual');
    expect(result.created_at).toBeNull();
    expect(result.updated_at).toBeNull();
  });

  it('no interpreta el perfil de cotización histórico como perfil fiscal cuando falta economic', () => {
    let result: any;
    service.getContractById(12).subscribe((value) => result = value);
    http.expectOne((request) => request.url.endsWith('/store/contracts/12')).flush({ data: {
      id: 12, store_id: 2, contract_number: 'CT-12', quotation_id: 8, status: 'active',
      created_at: null, updated_at: null,
      snapshot: {
        frozen_at: '2026-01-01T00:00:00.000Z',
        quotation: { id: 8, notes: 'nota histórica', subtotal_amount: '10.00', grand_total: '11.90', items: [] },
        profile: { profile_id: 3, version: 9, config: { admin_percent: '10', notes: 'No es el objeto formal' } },
        economic: null,
      },
    } });
    expect(result.economic).toBeNull();
    expect(result.profile).toBeNull();
    expect(result.quotation_profile.profile_id).toBe(3);
    expect(result.contract_object).toBeNull();
    expect(result.administration_percentage).toBeNull();
    expect(result.grand_total).toBe(11.9);
    expect(http.match((request) => request.url.includes('/profiles')).length).toBe(0);
  });

  it('no permite transición administrativa manual a facturado', () => {
    expect(CONTRACT_TRANSITIONS.active).toEqual(['cancelled']);
    expect(isValidContractTransition('active', 'cancelled')).toBeTrue();
    expect(isValidContractTransition('active', 'invoiced' as any)).toBeFalse();
  });

  it('mapea paginación anidada del endpoint a la vista', () => {
    let result: any;
    service.getContracts({ page: 2, limit: 10, search: 'CT', status: 'active' }).subscribe((value) => result = value);
    const request = http.expectOne((req) => req.urlWithParams.includes('/store/contracts?page=2&limit=10&search=CT&status=active'));
    request.flush({ data: { data: [{ id: 1, store_id: 1, contract_number: 'CT-1', quotation_id: 1, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-02' }], pagination: { total: 51, page: 2, limit: 10, totalPages: 6 } } });
    expect(result.data.length).toBe(1);
    expect(result.pagination.total).toBe(51);
    expect(result.pagination.totalPages).toBe(6);
  });

  it('POSTea createFromQuotation y normaliza su contrato', () => {
    let result: any;
    service.createFromQuotation(25).subscribe((value) => result = value);
    const request = http.expectOne((req) => req.url.endsWith('/store/contracts/from-quotation/25'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({});
    request.flush({ data: { id: 5, store_id: 1, contract_number: 'CT-5', quotation_id: 25, status: 'draft', created_at: '2026-01-01', updated_at: '2026-01-02' } });
    expect(result.contract_number).toBe('CT-5');
  });

  it('conserva código y details.contract_id al recibir 409 de conversión duplicada', () => {
    let received: unknown;
    service.createFromQuotation(25).subscribe({ error: (error) => received = error });
    http.expectOne((req) => req.url.endsWith('/store/contracts/from-quotation/25')).flush({
      error_code: 'QUOTE_CONTRACT_001', message: 'Ya existe contrato', details: { contract_id: 77 },
    }, { status: 409, statusText: 'Conflict' });
    expect(received instanceof ContractApiError).toBeTrue();
    expect((received as ContractApiError).code).toBe('QUOTE_CONTRACT_001');
    expect((received as ContractApiError).status).toBe(409);
    expect((received as ContractApiError).details['contract_id']).toBe(77);
  });
});
