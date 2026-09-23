import { StoreShippingZonesService } from './store-shipping-zones.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

const incCategoryRow = {
  id: 7,
  name: 'INC 8%',
  tax_type: 'inc',
  store_id: 1,
  organization_id: null,
  tax_rates: [{ id: 70, name: 'INC 8%', rate: 0.08 }],
};

describe('StoreShippingZonesService — impuesto de tarifa', () => {
  let prisma: any;
  let shippingTax: any;
  let service: StoreShippingZonesService;

  beforeEach(() => {
    const base = { shipping_methods: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) } };
    prisma = {
      withoutScope: () => base,
      shipping_zones: { findFirst: jest.fn().mockResolvedValue({ id: 11, is_system: false }) },
      shipping_rates: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    shippingTax = {
      assertCategoryAssignable: jest.fn().mockResolvedValue(undefined),
      getRateTaxOptions: jest.fn().mockResolvedValue({ categories: [] }),
    };
    service = new StoreShippingZonesService(prisma, shippingTax);
  });

  const createDto = {
    shipping_zone_id: 11,
    shipping_method_id: 2,
    type: 'flat',
    base_cost: 15000,
  } as any;

  it('create valida y persiste tax_category_id; la respuesta lleva la vista del contrato', async () => {
    prisma.shipping_rates.create.mockResolvedValue({ id: 5, tax_category: incCategoryRow });
    const out = await service.createStoreRate({ ...createDto, tax_category_id: 7 });
    expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(7);
    expect(prisma.shipping_rates.create.mock.calls[0][0].data.tax_category_id).toBe(7);
    expect(out.tax_category).toEqual({ id: 7, name: 'INC 8%', tax_type: 'inc', rate_percent: 8 });
  });

  it('create sin impuesto ⇒ tax_category_id null y tax_category null', async () => {
    prisma.shipping_rates.create.mockResolvedValue({ id: 5, tax_category: null });
    const out = await service.createStoreRate(createDto);
    expect(prisma.shipping_rates.create.mock.calls[0][0].data.tax_category_id).toBeNull();
    expect(out.tax_category).toBeNull();
  });

  it('create no persiste si la validación falla', async () => {
    shippingTax.assertCategoryAssignable.mockRejectedValue(
      new VendixHttpException(ErrorCodes.FISCAL_VAT_NOT_RESPONSIBLE_001),
    );
    await expect(service.createStoreRate({ ...createDto, tax_category_id: 3 })).rejects.toMatchObject({
      status: 412,
    });
    expect(prisma.shipping_rates.create).not.toHaveBeenCalled();
  });

  describe('updateStoreRate', () => {
    beforeEach(() => {
      prisma.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        shipping_zone_id: 11,
        shipping_zone: { is_system: false },
      });
      prisma.shipping_rates.update.mockResolvedValue({ id: 5, tax_category: null });
    });

    it('null quita el impuesto (valida no-op y escribe null)', async () => {
      await service.updateStoreRate(5, { tax_category_id: null } as any);
      expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(null);
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({ tax_category_id: null });
    });

    it('sin tax_category_id no toca el impuesto', async () => {
      await service.updateStoreRate(5, { base_cost: 9000 } as any);
      expect(shippingTax.assertCategoryAssignable).not.toHaveBeenCalled();
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({ base_cost: 9000 });
    });

    it('misma zona se acepta (el wizard la reenvía) y no se escribe', async () => {
      await service.updateStoreRate(5, { shipping_zone_id: 11, base_cost: 1 } as any);
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({ base_cost: 1 });
    });

    it('zona distinta ⇒ 400 en vez de descartarla en silencio', async () => {
      await expect(
        service.updateStoreRate(5, { shipping_zone_id: 12 } as any),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ error_code: 'SHIP_VALIDATE_001' }),
      });
      expect(prisma.shipping_rates.update).not.toHaveBeenCalled();
    });
  });

  it('getStoreZoneRates incluye tax_category en la forma del contrato', async () => {
    prisma.shipping_rates.findMany.mockResolvedValue([
      { id: 5, tax_category: incCategoryRow },
      { id: 6, tax_category: null },
    ]);
    const rates = await service.getStoreZoneRates(11);
    expect(prisma.shipping_rates.findMany.mock.calls[0][0].include.tax_category).toBeDefined();
    expect(rates.map((r) => r.tax_category)).toEqual([
      { id: 7, name: 'INC 8%', tax_type: 'inc', rate_percent: 8 },
      null,
    ]);
  });

  it('getRateTaxOptions delega en ShippingTaxService', async () => {
    await expect(service.getRateTaxOptions()).resolves.toEqual({ categories: [] });
  });
});
