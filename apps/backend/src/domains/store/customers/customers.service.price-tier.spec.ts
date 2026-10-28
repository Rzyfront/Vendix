import { CustomersService } from './customers.service';

/**
 * Tarifa preferencial del cliente: una por tienda, solo `customer_tier`.
 * Spec: odd/tasks/price-tier-adjustments-customers.md S5.
 */
describe('CustomersService price tier', () => {
  const tier = (over: Record<string, unknown> = {}) => ({
    id: 7,
    name: 'Mayorista',
    kind: 'customer_tier',
    is_active: true,
    discount_percentage: 0,
    adjustment_type: 'fixed_amount_discount',
    adjustment_value: 500,
    amount_scope: 'per_unit',
    ...over,
  });

  const createService = () => {
    const prisma = {
      users: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 10, ...data })),
      },
      price_tiers: { findFirst: jest.fn().mockResolvedValue(tier()) },
      store_users: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ price_tier: tier() }),
      },
    };
    const service = new CustomersService(prisma as never, {} as never);
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 10,
      organization_id: 3,
      document_type: null,
      document_number: null,
      first_name: 'Ana',
      last_name: 'Diaz',
      person_type: null,
    } as never);
    return { service, prisma };
  };

  it('asignar una tarifa de cliente la guarda en la membresía de la tienda', async () => {
    const { service, prisma } = createService();
    const result = await service.update(2, 10, { first_name: 'Ana', price_tier_id: 7 });

    expect(prisma.price_tiers.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7, kind: 'customer_tier' } }),
    );
    expect(prisma.store_users.update).toHaveBeenCalledWith({
      where: { store_id_user_id: { store_id: 2, user_id: 10 } },
      data: { price_tier_id: 7 },
    });
    expect(result).toEqual(expect.objectContaining({ price_tier_id: 7 }));
  });

  it('una tarifa de unidad de venta o de otra tienda se rechaza sin escribir nada', async () => {
    const { service, prisma } = createService();
    prisma.price_tiers.findFirst.mockResolvedValue(null);

    await expect(
      service.update(2, 10, { first_name: 'Ana', price_tier_id: 99 }),
    ).rejects.toMatchObject({ errorCode: 'CUST_PRICE_TIER_001' });
    expect(prisma.users.update).not.toHaveBeenCalled();
    expect(prisma.store_users.update).not.toHaveBeenCalled();
  });

  it('quitar la tarifa (null) la limpia sin buscar tarifa', async () => {
    const { service, prisma } = createService();
    await service.update(2, 10, { first_name: 'Ana', price_tier_id: null });

    expect(prisma.price_tiers.findFirst).not.toHaveBeenCalled();
    expect(prisma.store_users.update).toHaveBeenCalledWith({
      where: { store_id_user_id: { store_id: 2, user_id: 10 } },
      data: { price_tier_id: null },
    });
  });

  it('editar un cliente sin tocar la tarifa no la cambia (como antes)', async () => {
    const { service, prisma } = createService();
    await service.update(2, 10, { first_name: 'Ana' });

    expect(prisma.store_users.update).not.toHaveBeenCalled();
    expect(prisma.users.update).toHaveBeenCalled();
  });

  describe('getCustomerPriceTier', () => {
    it('devuelve la tarifa activa del cliente en la tienda', async () => {
      const { service, prisma } = createService();
      await expect(service.getCustomerPriceTier(2, 10)).resolves.toEqual({
        price_tier: tier(),
      });
      expect(prisma.store_users.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { store_id_user_id: { store_id: 2, user_id: 10 } },
        }),
      );
    });

    it('una tarifa inactiva no se ofrece', async () => {
      const { service, prisma } = createService();
      prisma.store_users.findUnique.mockResolvedValue({
        price_tier: tier({ is_active: false }),
      });
      await expect(service.getCustomerPriceTier(2, 10)).resolves.toEqual({
        price_tier: null,
      });
    });

    it('un cliente que no es de la tienda da 404', async () => {
      const { service, prisma } = createService();
      prisma.store_users.findUnique.mockResolvedValue(null);
      await expect(service.getCustomerPriceTier(2, 10)).rejects.toMatchObject({
        errorCode: 'CUST_FIND_001',
      });
    });
  });
});
