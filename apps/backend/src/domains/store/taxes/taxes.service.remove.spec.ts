import { RequestContextService } from '@common/context/request-context.service';
import { TaxesService } from './taxes.service';

describe('TaxesService.remove — categoría usada por tarifas de envío', () => {
  let base: any;
  let prisma: any;
  let service: TaxesService;

  beforeEach(() => {
    base = { shipping_rates: { count: jest.fn() } };
    prisma = {
      withoutScope: () => base,
      tax_categories: {
        findFirst: jest.fn().mockResolvedValue({ id: 7 }),
        delete: jest.fn().mockResolvedValue({ id: 7 }),
      },
    };
    const fiscalScope: any = { requireFiscalScope: jest.fn().mockResolvedValue('STORE') };
    service = new TaxesService(prisma, fiscalScope);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 10 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('rechaza con 409 y mensaje claro si alguna tarifa la usa', async () => {
    base.shipping_rates.count.mockResolvedValue(2);
    await expect(service.remove(7, {})).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        error_code: 'SYS_CONFLICT_001',
        message: expect.stringContaining('2 tarifa(s) de envío'),
      }),
    });
    expect(base.shipping_rates.count).toHaveBeenCalledWith({ where: { tax_category_id: 7 } });
    expect(prisma.tax_categories.delete).not.toHaveBeenCalled();
  });

  it('borra si ninguna tarifa la usa', async () => {
    base.shipping_rates.count.mockResolvedValue(0);
    await expect(service.remove(7, {})).resolves.toEqual({ id: 7 });
    expect(prisma.tax_categories.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
