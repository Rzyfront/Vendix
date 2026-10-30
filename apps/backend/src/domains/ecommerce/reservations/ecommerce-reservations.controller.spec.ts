import { EcommerceReservationsController } from './ecommerce-reservations.controller';

/**
 * QUI-966 T8 (S16): `GET /ecommerce/reservations/store/address` must never
 * return another store's address. The last fallback reads only the resolved
 * store's own `store_settings.services.local_address`.
 */
describe('EcommerceReservationsController — store/address (QUI-966 S16)', () => {
  const OTHER_TENANT_ADDRESS = {
    address_line1: 'Calle Ajena 99',
    city: 'Otra Ciudad',
  };

  function build(ownSettings: any = null) {
    const prisma = {
      addresses: { findFirst: jest.fn().mockResolvedValue(null) },
      store_settings: {
        findFirst: jest.fn().mockResolvedValue(ownSettings),
        findMany: jest.fn().mockResolvedValue([
          { id: 99, store_id: 999, settings: { services: { local_address: OTHER_TENANT_ADDRESS } } },
        ]),
      },
    };
    const availabilityService: any = { prisma };
    const controller = new (EcommerceReservationsController as any)(
      availabilityService,
      {},
      {},
    ) as EcommerceReservationsController;
    return { controller, prisma };
  }

  const req = (storeId = 7) => ({ headers: {}, store_id: storeId, organization_id: 3 });

  it('returns null (never another tenant address) when the store has no address of its own', async () => {
    const { controller, prisma } = build(null);
    const res: any = await (controller as any).getStoreAddress(req());
    expect(res).toEqual({ success: true, data: null });
    expect(prisma.store_settings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 7 } }),
    );
    expect(prisma.store_settings.findMany).not.toHaveBeenCalled();
  });

  it('reads the local_address only from the resolved store settings', async () => {
    const { controller, prisma } = build({
      id: 5,
      store_id: 7,
      settings: { services: { local_address: { address_line1: 'Cra 1 # 2-3', city: 'Bogotá' } } },
    });
    const res: any = await (controller as any).getStoreAddress(req());
    expect(prisma.store_settings.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { store_id: 7 } }),
    );
    expect(res.data).toEqual(
      expect.objectContaining({
        id: 0,
        address_line1: 'Cra 1 # 2-3',
        city: 'Bogotá',
        country_code: 'CO',
        type: 'store_physical',
        store_id: 7,
        organization_id: 3,
      }),
    );
  });

  it('keeps preferring the store primary address', async () => {
    const { controller, prisma } = build(null);
    const own = { id: 11, store_id: 7, address_line1: 'Propia' };
    prisma.addresses.findFirst.mockResolvedValueOnce(own);
    const res: any = await (controller as any).getStoreAddress(req());
    expect(res).toEqual({ success: true, data: own });
  });
});
