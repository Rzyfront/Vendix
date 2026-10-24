import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CustomersBulkService } from './customers-bulk.service';
import { BulkCustomerUploadDto } from './dto/bulk-customer.dto';
import { RequestContextService } from '@common/context/request-context.service';

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
    service = new CustomersBulkService({} as any, { create } as any);
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
