import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CustomersBulkService } from './customers-bulk.service';
import { BulkCustomerUploadDto } from './dto/bulk-customer.dto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';

describe('CustomersBulkService — tope de carga masiva', () => {
  const create = jest.fn();
  let service: CustomersBulkService;

  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      email: `c${i}@mail.com`,
      first_name: `C${i}`,
      row_number: i + 2,
    }));

  beforeEach(() => {
    create.mockReset();
    create.mockImplementation(async (_s, d) => ({ id: 1, ...d }));
    service = new CustomersBulkService({} as any, { create } as any, {} as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('acepta 10.000 filas', async () => {
    const result = await service.uploadCustomers({
      customers: rows(10000),
    } as any);
    expect(result.total_processed).toBe(10000);
    expect(result.successful).toBe(10000);
    expect(create).toHaveBeenCalledTimes(10000);
  }, 60000);

  it('rechaza 10.001 filas sin tocar la BD', async () => {
    await expect(
      service.uploadCustomers({ customers: rows(10001) } as any),
    ).rejects.toMatchObject({ errorCode: 'CUST_BULK_001' });
    expect(create).not.toHaveBeenCalled();
  });

  describe('DTO del POST JSON (tope por request)', () => {
    const check = (n: number) =>
      validate(plainToInstance(BulkCustomerUploadDto, { customers: rows(n) }));

    it('acepta 100 ítems', async () => {
      expect(await check(100)).toHaveLength(0);
    });

    it('rechaza 101 ítems con mensaje en español', async () => {
      const errors = await check(101);
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0].constraints ?? {})[0]).toContain(
        'máximo 100 clientes',
      );
    });
  });
});

describe('CustomersBulkService — ubicaciones por cliente', () => {
  const create = jest.fn();
  const findByDocumentInOrganization = jest.fn();
  const addCustomerLocation = jest.fn();
  let service: CustomersBulkService;
  let nextId: number;

  const addr = (over: Record<string, unknown> = {}) => ({
    address_line_1: 'Calle 10 # 20-30',
    city: 'Medellín',
    ...over,
  });

  beforeEach(() => {
    nextId = 100;
    create.mockReset();
    findByDocumentInOrganization.mockReset();
    addCustomerLocation.mockReset();
    create.mockImplementation(async (_s, d) => ({ id: nextId++, ...d }));
    findByDocumentInOrganization.mockResolvedValue(null);
    addCustomerLocation.mockResolvedValue({ address: { id: 1 }, created: true });
    service = new CustomersBulkService(
      {} as any,
      { create, findByDocumentInOrganization } as any,
      { addCustomerLocation } as any,
    );
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 7 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  const upload = (customers: any[]) =>
    service.uploadCustomers({ customers } as any);

  it('groups rows with the same document into one customer with one location per row', async () => {
    const result = await upload([
      { first_name: 'Ana', document_number: '900123456', document_type: 'NIT', row_number: 2, location_name: 'Sede A', ...addr() },
      { first_name: 'Ana', document_number: '900123456', document_type: 'NIT', row_number: 3, location_name: 'Sede B', ...addr({ address_line_1: 'Carrera 5' }) },
      { first_name: 'Ana', document_number: '900123456-7', document_type: 'NIT', row_number: 4, location_name: 'Sede C', ...addr({ address_line_1: 'Av 80' }) },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(addCustomerLocation).toHaveBeenCalledTimes(3);
    expect(addCustomerLocation).toHaveBeenNthCalledWith(1, 100, expect.objectContaining({ label: 'Sede A', country: 'CO' }));
    expect(result.failed).toBe(0);
    expect(result.locations_added).toBe(3);
    expect(result.results.map((r) => r.row_number)).toEqual([2, 3, 4]);
    expect(result.results[1].status).toBe('location_added');
  });

  it('adds the address as a location of a customer that already exists in the organization', async () => {
    findByDocumentInOrganization.mockResolvedValue({ id: 55 });
    const result = await upload([
      { first_name: 'Ana', document_number: '1023456789', document_type: 'CC', row_number: 2, ...addr() },
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(addCustomerLocation).toHaveBeenCalledWith(55, expect.objectContaining({ address_line_1: 'Calle 10 # 20-30' }));
    expect(result.results[0]).toMatchObject({ status: 'location_added', row_number: 2 });
    expect(result.failed).toBe(0);
  });

  it('adds the location when create reports a document conflict (other page / race)', async () => {
    create.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.SYS_CONFLICT_001, 'dup', {
        kind: 'document',
        value: '1',
        type: 'CC',
        existing_customer_id: 77,
      }),
    );
    const result = await upload([
      { first_name: 'Ana', document_number: '1', document_type: 'CC', row_number: 2, ...addr() },
    ]);
    expect(addCustomerLocation).toHaveBeenCalledWith(77, expect.anything());
    expect(result.results[0].status).toBe('location_added');
    expect(result.failed).toBe(0);
  });

  it('reports an identical address as a warning, not an error', async () => {
    findByDocumentInOrganization.mockResolvedValue({ id: 55 });
    addCustomerLocation.mockResolvedValue({ address: { id: 1 }, created: false });
    const result = await upload([
      { first_name: 'Ana', document_number: '1023456789', document_type: 'CC', row_number: 2, ...addr() },
    ]);
    expect(result.results[0]).toMatchObject({ status: 'warning', message: 'Ubicación ya registrada' });
    expect(result.failed).toBe(0);
    expect(result.warnings).toBe(1);
    expect(result.locations_added).toBe(0);
  });

  it('keeps duplicate_document for an existing document without address', async () => {
    create.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.SYS_CONFLICT_001, 'dup', {
        kind: 'document',
        value: '1023456789',
        type: 'CC',
        existing_customer_id: 55,
      }),
    );
    const result = await upload([
      { first_name: 'Ana', document_number: '1023456789', document_type: 'CC', row_number: 2 },
    ]);
    expect(addCustomerLocation).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.results[0].row_error?.code).toBe('duplicate_document');
  });

  it('maps JURIDICA rows to person_type, legal_name and verification_digit', async () => {
    await upload([
      { person_type: 'JURIDICA', legal_name: ' Acme S.A.S ', verification_digit: '7', document_number: '900123456', row_number: 2 },
    ]);
    expect(create).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        person_type: 'JURIDICA',
        legal_name: 'Acme S.A.S',
        verification_digit: '7',
        document_type: 'NIT',
        first_name: '',
      }),
    );
  });

  it('rejects a JURIDICA row without legal_name', async () => {
    const result = await upload([
      { person_type: 'JURIDICA', document_number: '900123456', row_number: 2 },
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(result.results[0].row_error?.code).toBe('missing_legal_name');
  });

  it('behaves exactly as before for old-template rows (no new columns)', async () => {
    const result = await upload([
      { email: 'a@mail.com', first_name: 'Ana', last_name: 'G', document_number: '1', document_type: 'CC', phone: '300', row_number: 2 },
    ]);
    expect(create).toHaveBeenCalledWith(1, {
      email: 'a@mail.com',
      first_name: 'Ana',
      last_name: 'G',
      document_number: '1',
      document_type: 'CC',
      phone: '300',
    });
    expect(addCustomerLocation).not.toHaveBeenCalled();
    expect(findByDocumentInOrganization).not.toHaveBeenCalled();
    expect(result).toMatchObject({ successful: 1, failed: 0 });
    expect(result.results[0].status).toBe('success');
  });
});
