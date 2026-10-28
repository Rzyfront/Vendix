import { PriceTiersService } from './price-tiers.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Regla de la tarifa (odd/tasks/price-tier-adjustments-customers.md S1, S2):
 * el servicio persiste tipo, valor y alcance, y rechaza una regla sin valor.
 */
describe('PriceTiersService — regla de ajuste', () => {
  function makeService(existing: Record<string, unknown> = {}) {
    const prisma = {
      price_tiers: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          where?.id
            ? Promise.resolve({
                id: where.id,
                name: 'Mayorista',
                kind: 'customer_tier',
                adjustment_type: 'percent_discount',
                adjustment_value: null,
                amount_scope: 'per_unit',
                discount_percentage: 10,
                ...existing,
              })
            : Promise.resolve(null),
        ),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 1, ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 1, ...data }),
        ),
        updateMany: jest.fn(),
      },
      order_items: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    return { service: new PriceTiersService(prisma as any), prisma };
  }

  beforeEach(() => {
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('crea una tarifa de precio fijo por paquete', async () => {
    const { service, prisma } = makeService();

    await service.create({
      name: 'Fijo',
      adjustment_type: 'fixed_price',
      adjustment_value: 10000,
      amount_scope: 'per_package',
    } as any);

    expect(prisma.price_tiers.create.mock.calls[0][0].data).toMatchObject({
      adjustment_type: 'fixed_price',
      adjustment_value: 10000,
      amount_scope: 'per_package',
    });
  });

  it('sin tipo crea la regla histórica sin adjustment_value', async () => {
    const { service, prisma } = makeService();

    await service.create({ name: 'Mayorista', discount_percentage: 15 } as any);

    expect(prisma.price_tiers.create.mock.calls[0][0].data).toMatchObject({
      discount_percentage: 15,
      adjustment_type: 'percent_discount',
      adjustment_value: null,
      amount_scope: 'per_unit',
    });
  });

  it('rechaza un monto fijo sin valor con PRICE_TIER_ADJUSTMENT_001', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.create({
        name: 'Recargo',
        adjustment_type: 'fixed_amount_surcharge',
      } as any),
    ).rejects.toMatchObject({ errorCode: 'PRICE_TIER_ADJUSTMENT_001' });
    expect(prisma.price_tiers.create).not.toHaveBeenCalled();
  });

  it('al editar valida la regla combinada con lo guardado', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.update(1, { adjustment_type: 'percent_surcharge' } as any),
    ).rejects.toMatchObject({ errorCode: 'PRICE_TIER_ADJUSTMENT_001' });
    expect(prisma.price_tiers.update).not.toHaveBeenCalled();
  });

  it('volver al descuento porcentual limpia adjustment_value', async () => {
    const { service, prisma } = makeService({
      adjustment_type: 'fixed_price',
      adjustment_value: 9000,
    });

    await service.update(1, { adjustment_type: 'percent_discount' } as any);

    expect(prisma.price_tiers.update.mock.calls[0][0].data).toMatchObject({
      adjustment_type: 'percent_discount',
      adjustment_value: null,
    });
  });

  it('editar solo el nombre no toca la regla', async () => {
    const { service, prisma } = makeService();

    await service.update(1, { name: 'Mayorista 2' } as any);

    const data = prisma.price_tiers.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('adjustment_type');
    expect(data).not.toHaveProperty('adjustment_value');
  });
});
