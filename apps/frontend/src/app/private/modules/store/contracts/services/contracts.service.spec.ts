import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { ContractsService, ContractApiError } from './contracts.service';

describe('ContractsService — API y snapshot congelado', () => {
  let service: ContractsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ContractsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('normaliza el DTO desde snapshot, preserva el JSON decimal y no completa campos con datos vivos', () => {
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
          contract_object: 'Alcance del snapshot',
          items: [{ product_name: 'Obra', quantity: '2', unit_price: '50.00', discount_amount: '0.00', tax_rate: '19', tax_amount_item: '19.00', total_price: '119.00', notes: null }],
        },
        profile: { profile_id: 12, version: 3, config: { admin_percent: '10.00', contingency_percent: 0, profit_percent: '8.5', validity_days: 30, payment_terms: 'Contra entrega' } },
      },
    } });

    expect(result.grand_total).toBe(119);
    expect(result.notes).toBeNull();
    expect(result.terms_and_conditions).toBe('Pago pactado');
    expect(result.contract_object).toBe('Alcance del snapshot');
    expect(result.administration_percentage).toBe(10);
    expect(result.profile.profile_id).toBe(12);
    expect(result.profile.version).toBe(3);
    expect(result.items[0].unit_price).toBe(50);
    expect(result.snapshot.quotation.grand_total).toBe('119.00');
    expect(result.snapshot.profile.config.admin_percent).toBe('10.00');
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
