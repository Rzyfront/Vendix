import { RequestContextService } from '../../../../common/context/request-context.service';
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

  it('create persiste tax_is_inclusive:false cuando se pide modo agregado', async () => {
    prisma.shipping_rates.create.mockResolvedValue({ id: 5, tax_category: incCategoryRow });
    await service.createStoreRate({ ...createDto, tax_category_id: 7, tax_is_inclusive: false });
    expect(prisma.shipping_rates.create.mock.calls[0][0].data.tax_is_inclusive).toBe(false);
  });

  it('create usa incluido por defecto cuando se omite el modo', async () => {
    prisma.shipping_rates.create.mockResolvedValue({ id: 5, tax_category: incCategoryRow });
    await service.createStoreRate({ ...createDto, tax_category_id: 7 });
    expect(prisma.shipping_rates.create.mock.calls[0][0].data.tax_is_inclusive).toBe(true);
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
        tax_category_id: 7,
        shipping_zone: { is_system: false },
      });
      prisma.shipping_rates.update.mockResolvedValue({ id: 5, tax_category: null });
    });

    it('null quita el impuesto (valida no-op y escribe null)', async () => {
      await service.updateStoreRate(5, { tax_category_id: null } as any);
      expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(null);
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({ tax_category_id: null });
    });

    it('misma categoría reenviada ⇒ no se revalida ni se escribe (no bloquea editar nombre/activo)', async () => {
      shippingTax.assertCategoryAssignable.mockRejectedValue(new Error('ya no elegible'));
      await service.updateStoreRate(5, { tax_category_id: 7, name: 'Express' } as any);
      expect(shippingTax.assertCategoryAssignable).not.toHaveBeenCalled();
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({ name: 'Express' });
    });

    it('categoría distinta ⇒ se valida y se escribe', async () => {
      await service.updateStoreRate(5, { tax_category_id: 9 } as any);
      expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(9);
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({ tax_category_id: 9 });
    });

    it('persiste tax_is_inclusive por el spread (PATCH con categoría + modo agregado)', async () => {
      await service.updateStoreRate(5, { tax_category_id: 9, tax_is_inclusive: false } as any);
      expect(shippingTax.assertCategoryAssignable).toHaveBeenCalledWith(9);
      expect(prisma.shipping_rates.update.mock.calls[0][0].data).toEqual({
        tax_is_inclusive: false,
        tax_category_id: 9,
      });
    });

    it('categoría distinta no elegible ⇒ propaga el rechazo y no escribe', async () => {
      shippingTax.assertCategoryAssignable.mockRejectedValue(new Error('412'));
      await expect(
        service.updateStoreRate(5, { tax_category_id: 9 } as any),
      ).rejects.toThrow('412');
      expect(prisma.shipping_rates.update).not.toHaveBeenCalled();
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

  describe('clonado de tarifas de sistema', () => {
    beforeEach(() => {
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 1, organization_id: 10 } as any);
    });

    afterEach(() => jest.restoreAllMocks());

    it('duplicateSystemRate copia el modo agregado (false)', async () => {
      const baseClient = prisma.withoutScope();
      baseClient.shipping_rates = {
        findFirst: jest.fn().mockResolvedValue({
          id: 90,
          shipping_method_id: 2,
          name: 'System Express',
          type: 'flat',
          base_cost: 10000,
          per_unit_cost: null,
          min_val: null,
          max_val: null,
          free_shipping_threshold: null,
          tax_is_inclusive: false,
          shipping_zone: { is_system: true },
        }),
      };
      prisma.shipping_rates.create.mockResolvedValue({ id: 50, tax_category: null });

      await service.duplicateSystemRate(90, 11);

      expect(prisma.shipping_rates.create.mock.calls[0][0].data).toMatchObject({
        shipping_zone_id: 11,
        tax_is_inclusive: false,
        source_type: 'custom',
        copied_from_system_rate_id: 90,
      });
    });

    it('duplicateSystemZone copia el modo de cada tarifa', async () => {
      const tx = {
        shipping_zones: { create: jest.fn().mockResolvedValue({ id: 20 }) },
        shipping_rates: { create: jest.fn().mockResolvedValue({ id: 51 }) },
      };
      const baseClient = prisma.withoutScope();
      baseClient.shipping_zones = {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          name: 'System Zone',
          display_name: null,
          countries: [],
          regions: [],
          cities: [],
          zip_codes: [],
          shipping_rates: [
            { id: 90, shipping_method_id: 2, name: 'A', type: 'flat', base_cost: 10000, per_unit_cost: null, min_val: null, max_val: null, free_shipping_threshold: null, tax_is_inclusive: false },
            { id: 91, shipping_method_id: 2, name: 'B', type: 'flat', base_cost: 5000, per_unit_cost: null, min_val: null, max_val: null, free_shipping_threshold: null, tax_is_inclusive: true },
          ],
        }),
      };
      baseClient.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(tx));

      await service.duplicateSystemZone(9);

      expect(tx.shipping_rates.create).toHaveBeenCalledTimes(2);
      expect(tx.shipping_rates.create.mock.calls[0][0].data.tax_is_inclusive).toBe(false);
      expect(tx.shipping_rates.create.mock.calls[1][0].data.tax_is_inclusive).toBe(true);
    });
  });
});
