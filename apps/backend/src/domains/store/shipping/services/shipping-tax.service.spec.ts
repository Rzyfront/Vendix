import { RequestContextService } from '../../../../common/context/request-context.service';
import { ShippingTaxService } from './shipping-tax.service';
import { EMPTY_SHIPPING_TAX } from '../utils/shipping-tax.util';

const inc8 = {
  id: 7,
  name: 'INC 8%',
  tax_type: 'inc',
  is_inclusive: null,
  store_id: 1,
  organization_id: null,
  tax_rates: [{ id: 70, name: 'INC 8%', rate: 0.08 }],
};
const iva19 = {
  id: 3,
  name: 'IVA 19%',
  tax_type: 'iva',
  is_inclusive: null,
  store_id: 1,
  organization_id: null,
  tax_rates: [{ id: 30, name: 'IVA 19%', rate: 0.19 }],
};

function storeRow(opts: {
  responsibilities?: string[];
  fiscal_scope?: 'STORE' | 'ORGANIZATION';
  industries?: string[];
}) {
  const fiscal_data = { tax_responsibilities: opts.responsibilities ?? [] };
  return {
    organization_id: 10,
    industries: opts.industries ?? ['retail'],
    store_settings: { settings: { fiscal_data } },
    organizations: {
      fiscal_scope: opts.fiscal_scope ?? 'STORE',
      organization_settings: { settings: { fiscal_data } },
    },
  };
}

describe('ShippingTaxService', () => {
  let base: any;
  let service: ShippingTaxService;

  beforeEach(() => {
    base = {
      shipping_rates: { findFirst: jest.fn(), findMany: jest.fn() },
      stores: { findFirst: jest.fn() },
      tax_categories: { findFirst: jest.fn(), findMany: jest.fn() },
    };
    const prisma: any = { withoutScope: () => base };
    service = new ShippingTaxService(prisma);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1, organization_id: 10 } as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('snapshotForRate', () => {
    it('INC 8 % en $15.000 ⇒ bloque data listo para orders', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({ id: 5, tax_category: inc8 });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-33'] }));

      const data = await service.snapshotForRate(null, 5, 15000, { store_id: 1 });

      expect(data).toEqual({
        shipping_tax_rate_id: 70,
        shipping_tax_name: 'INC 8%',
        shipping_tax_type: 'inc',
        shipping_tax_rate: 0.08,
        shipping_tax_amount: 1111.11,
      });
      // Filtro de tenant explícito (el tx no lleva scoping).
      expect(base.shipping_rates.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        shipping_zone: { OR: [{ store_id: 1 }, { is_system: true, store_id: null }] },
      });
    });

    it('usa el client recibido (tx) en vez del baseClient', async () => {
      const tx: any = {
        shipping_rates: { findFirst: jest.fn().mockResolvedValue({ id: 5, tax_category: inc8 }) },
        stores: { findFirst: jest.fn().mockResolvedValue(storeRow({})) },
      };
      await service.snapshotForRate(tx, 5, 15000, { store_id: 1 });
      expect(tx.shipping_rates.findFirst).toHaveBeenCalled();
      expect(base.shipping_rates.findFirst).not.toHaveBeenCalled();
    });

    it('IVA con emisor sin O-48 ⇒ vacía + warn', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({ id: 5, tax_category: iva19 });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-49'] }));
      const data = await service.snapshotForRate(null, 5, 15000, { store_id: 1 });
      expect(data).toEqual(EMPTY_SHIPPING_TAX);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('vat_not_responsible'),
      );
    });

    it('IVA con O-48 ⇒ copia IVA', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({ id: 5, tax_category: iva19 });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48'] }));
      const data = await service.snapshotForRate(null, 5, 15000, { store_id: 1 });
      expect(data).toMatchObject({ shipping_tax_type: 'iva', shipping_tax_amount: 2394.95 });
    });

    it('INC con emisor sin O-33 ⇒ vacía + warn', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({ id: 5, tax_category: inc8 });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-49'] }));
      const data = await service.snapshotForRate(null, 5, 15000, { store_id: 1 });
      expect(data).toEqual(EMPTY_SHIPPING_TAX);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('inc_not_responsible'),
      );
    });

    it('sin tarifa, sin categoría o costo 0 ⇒ vacía sin leer al emisor', async () => {
      expect(await service.snapshotForRate(null, null, 15000, { store_id: 1 })).toEqual(EMPTY_SHIPPING_TAX);
      expect(await service.snapshotForRate(null, 5, 0, { store_id: 1 })).toEqual(EMPTY_SHIPPING_TAX);
      base.shipping_rates.findFirst.mockResolvedValue({ id: 5, tax_category: null });
      expect(await service.snapshotForRate(null, 5, 15000, { store_id: 1 })).toEqual(EMPTY_SHIPPING_TAX);
      base.shipping_rates.findFirst.mockResolvedValue(null);
      expect(await service.snapshotForRate(null, 5, 15000, { store_id: 1 })).toEqual(EMPTY_SHIPPING_TAX);
      expect(base.stores.findFirst).not.toHaveBeenCalled();
    });

    it('categoría de otra tienda ⇒ vacía + warn', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_category: { ...inc8, store_id: 99 },
      });
      base.stores.findFirst.mockResolvedValue(storeRow({}));
      expect(await service.snapshotForRate(null, 5, 15000, { store_id: 1 })).toEqual(EMPTY_SHIPPING_TAX);
    });

    it('fiscal_scope=ORGANIZATION acepta la categoría de la org (store_id null)', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_category: { ...inc8, store_id: null, organization_id: 10 },
      });
      base.stores.findFirst.mockResolvedValue(
        storeRow({ fiscal_scope: 'ORGANIZATION', responsibilities: ['O-33'] }),
      );
      const data = await service.snapshotForRate(null, 5, 15000, { store_id: 1 });
      expect(data.shipping_tax_amount).toBe(1111.11);
    });
  });

  describe('assertCategoryAssignable', () => {
    beforeEach(() => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-49'] }));
    });

    it('null/undefined ⇒ no valida nada', async () => {
      await expect(service.assertCategoryAssignable(null)).resolves.toBeUndefined();
      await expect(service.assertCategoryAssignable(undefined)).resolves.toBeUndefined();
      expect(base.tax_categories.findFirst).not.toHaveBeenCalled();
    });

    it('fuera de alcance ⇒ 404', async () => {
      base.tax_categories.findFirst.mockResolvedValue(null);
      await expect(service.assertCategoryAssignable(99)).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({ error_code: 'CAT_FIND_001' }),
      });
      expect(base.tax_categories.findFirst.mock.calls[0][0].where).toEqual({ id: 99, store_id: 1 });
    });

    it('bajo ORGANIZATION busca en la org', async () => {
      base.stores.findFirst.mockResolvedValue(
        storeRow({ fiscal_scope: 'ORGANIZATION', responsibilities: ['O-33'] }),
      );
      base.tax_categories.findFirst.mockResolvedValue({ ...inc8, store_id: null, organization_id: 10 });
      await service.assertCategoryAssignable(7);
      expect(base.tax_categories.findFirst.mock.calls[0][0].where).toEqual({
        id: 7,
        organization_id: 10,
        store_id: null,
      });
    });

    it('no elegible ⇒ 400 con motivo', async () => {
      base.tax_categories.findFirst.mockResolvedValue({ ...inc8, tax_type: 'ica' });
      await expect(service.assertCategoryAssignable(7)).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({ error_code: 'SHIP_VALIDATE_001' }),
      });
    });

    it('IVA sin O-48 ⇒ 412 FISCAL_VAT_NOT_RESPONSIBLE_001 con context shipping', async () => {
      base.tax_categories.findFirst.mockResolvedValue(iva19);
      await expect(service.assertCategoryAssignable(3)).rejects.toMatchObject({
        status: 412,
        response: expect.objectContaining({
          error_code: 'FISCAL_VAT_NOT_RESPONSIBLE_001',
          details: expect.objectContaining({ context: 'shipping' }),
        }),
      });
    });

    it('INC sin O-33 ⇒ 412 FISCAL_INC_NOT_RESPONSIBLE_001 con context shipping', async () => {
      base.tax_categories.findFirst.mockResolvedValue(inc8);
      await expect(service.assertCategoryAssignable(7)).rejects.toMatchObject({
        status: 412,
        response: expect.objectContaining({
          error_code: 'FISCAL_INC_NOT_RESPONSIBLE_001',
          details: expect.objectContaining({ context: 'shipping' }),
        }),
      });
    });

    it('INC con O-33 ⇒ permitido', async () => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-33'] }));
      base.tax_categories.findFirst.mockResolvedValue(inc8);
      await expect(service.assertCategoryAssignable(7)).resolves.toBeUndefined();
    });
  });

  describe('getRateTaxOptions', () => {
    it('restaurante O-33 sin O-48: IVA deshabilitado, sugerencia INC sin preselección', async () => {
      base.stores.findFirst.mockResolvedValue(
        storeRow({ responsibilities: ['O-33', 'O-49'], industries: ['restaurant'] }),
      );
      base.tax_categories.findMany.mockResolvedValue([
        inc8,
        iva19,
        { ...iva19, id: 4, name: 'ReteICA', tax_type: 'reteica' },
      ]);
      const opts = await service.getRateTaxOptions();
      expect(opts.issuer).toEqual({ vat_responsible: false, inc_responsible: true, is_restaurant: true });
      expect(opts.categories).toEqual([
        { id: 7, name: 'INC 8%', tax_type: 'inc', rate_percent: 8, eligible: true, is_inclusive: null },
        expect.objectContaining({ id: 3, tax_type: 'iva', rate_percent: 19, eligible: false }),
        expect.objectContaining({ id: 4, tax_type: 'reteica', eligible: false }),
      ]);
      expect(opts.suggestion).toEqual(
        expect.objectContaining({ tax_type: 'inc', category_id: 7 }),
      );
      expect(opts.warnings).toBeUndefined();
    });

    it('INC sin O-33 ⇒ no elegible con motivo, sin warnings ni sugerencia', async () => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48'] }));
      base.tax_categories.findMany.mockResolvedValue([inc8]);
      const opts = await service.getRateTaxOptions();
      expect(opts.categories).toEqual([
        expect.objectContaining({
          id: 7,
          tax_type: 'inc',
          rate_percent: 8,
          eligible: false,
          reason: expect.stringContaining('O-33'),
        }),
      ]);
      expect(opts.suggestion).toBeUndefined();
      expect(opts.warnings).toBeUndefined();
    });

    it('expone is_inclusive de la categoría como pista de preselección (nunca entra al cálculo)', async () => {
      base.stores.findFirst.mockResolvedValue(
        storeRow({ responsibilities: ['O-48', 'O-33'] }),
      );
      base.tax_categories.findMany.mockResolvedValue([
        { ...inc8, is_inclusive: false },
        { ...iva19, is_inclusive: true },
      ]);
      const opts = await service.getRateTaxOptions();
      expect(opts.categories).toEqual([
        { id: 7, name: 'INC 8%', tax_type: 'inc', rate_percent: 8, eligible: true, is_inclusive: false },
        { id: 3, name: 'IVA 19%', tax_type: 'iva', rate_percent: 19, eligible: true, is_inclusive: true },
      ]);
    });
  });

  describe('chargeForRate', () => {
    it('incluido ⇒ bruto = precio de tarifa (INC 8 % en $15.000 ⇒ tax 1.111,11)', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_is_inclusive: true,
        tax_category: inc8,
      });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-33'] }));

      const charge = await service.chargeForRate(null, 5, 15000, { store_id: 1 });

      expect(charge).toMatchObject({
        applies: true,
        gross: 15000,
        tax: 1111.11,
        reason: 'inclusive',
      });
      expect(base.shipping_rates.findFirst.mock.calls[0][0].where).toEqual({
        id: 5,
        shipping_zone: { OR: [{ store_id: 1 }, { is_system: true, store_id: null }] },
      });
    });

    it('agregado ⇒ bruto = base + trunc(base·r) (10.000 IVA 19 % ⇒ 11.900)', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_is_inclusive: false,
        tax_category: iva19,
      });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48'] }));

      const charge = await service.chargeForRate(null, 5, 10000, { store_id: 1 });

      expect(charge).toEqual({
        applies: true,
        gross: 11900,
        base: 10000,
        tax: 1900,
        reason: 'exclusive',
      });
    });

    it('usa el client recibido (tx) en vez del baseClient', async () => {
      const tx: any = {
        shipping_rates: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 5, tax_is_inclusive: true, tax_category: inc8 }),
        },
        stores: { findFirst: jest.fn().mockResolvedValue(storeRow({ responsibilities: ['O-33'] })) },
      };
      const charge = await service.chargeForRate(tx, 5, 15000, { store_id: 1 });
      expect(tx.shipping_rates.findFirst).toHaveBeenCalled();
      expect(base.shipping_rates.findFirst).not.toHaveBeenCalled();
      expect(charge).toMatchObject({ applies: true, gross: 15000 });
    });

    it('IVA con emisor sin O-48 ⇒ bruto = precio + warn (nunca recargo sin impuesto)', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_is_inclusive: false,
        tax_category: iva19,
      });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-49'] }));
      const charge = await service.chargeForRate(null, 5, 10000, { store_id: 1 });
      expect(charge).toEqual({
        applies: false,
        gross: 10000,
        base: 10000,
        tax: 0,
        reason: 'vat_not_responsible',
      });
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('vat_not_responsible'),
      );
    });

    it('sin tarifa, tarifa ajena o sin categoría ⇒ bruto = precio sin leer al emisor', async () => {
      expect(await service.chargeForRate(null, null, 10000, { store_id: 1 })).toMatchObject({
        applies: false,
        gross: 10000,
      });
      base.shipping_rates.findFirst.mockResolvedValue(null);
      expect(await service.chargeForRate(null, 5, 10000, { store_id: 1 })).toMatchObject({
        applies: false,
        gross: 10000,
      });
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_is_inclusive: false,
        tax_category: null,
      });
      expect(await service.chargeForRate(null, 5, 10000, { store_id: 1 })).toEqual({
        applies: false,
        gross: 10000,
        base: 10000,
        tax: 0,
        reason: 'no_category',
      });
      expect(base.stores.findFirst).not.toHaveBeenCalled();
    });

    it('categoría de otra tienda ⇒ sin impuesto + warn', async () => {
      base.shipping_rates.findFirst.mockResolvedValue({
        id: 5,
        tax_is_inclusive: true,
        tax_category: { ...inc8, store_id: 99 },
      });
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-33'] }));
      const charge = await service.chargeForRate(null, 5, 15000, { store_id: 1 });
      expect(charge).toMatchObject({ applies: false, gross: 15000 });
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fuera del alcance'),
      );
    });
  });

  describe('loadRateTaxContext', () => {
    it('carga el lote en una lectura con una sola lectura del emisor', async () => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48', 'O-33'] }));
      base.shipping_rates.findMany.mockResolvedValue([
        { id: 5, tax_is_inclusive: true, tax_category: inc8 },
        { id: 6, tax_is_inclusive: false, tax_category: iva19 },
      ]);

      const ctx = await service.loadRateTaxContext([5, 6, 5], { store_id: 1 });

      expect(base.stores.findFirst).toHaveBeenCalledTimes(1);
      expect(base.shipping_rates.findMany.mock.calls[0][0].where).toEqual({
        id: { in: [5, 6] },
        shipping_zone: { OR: [{ store_id: 1 }, { is_system: true, store_id: null }] },
      });
      expect(ctx.get(5)).toMatchObject({
        rate_id: 5,
        tax_is_inclusive: true,
        vat_responsible: true,
        inc_responsible: true,
      });
      expect(ctx.get(5)?.category).toMatchObject({ id: 7 });
      expect(ctx.get(6)).toMatchObject({ rate_id: 6, tax_is_inclusive: false });
      expect(ctx.get(6)?.category).toMatchObject({ id: 3 });
    });

    it('tarifa ajena o inexistente ⇒ ausente del mapa (el consumidor cobra precio = bruto)', async () => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48'] }));
      base.shipping_rates.findMany.mockResolvedValue([
        { id: 5, tax_is_inclusive: true, tax_category: iva19 },
      ]);
      const ctx = await service.loadRateTaxContext([5, 999], { store_id: 1 });
      expect(ctx.has(5)).toBe(true);
      expect(ctx.has(999)).toBe(false);
    });

    it('categoría fuera de alcance ⇒ entrada con category null + warn', async () => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48'] }));
      base.shipping_rates.findMany.mockResolvedValue([
        { id: 5, tax_is_inclusive: false, tax_category: { ...iva19, store_id: 99 } },
      ]);
      const ctx = await service.loadRateTaxContext([5], { store_id: 1 });
      expect(ctx.get(5)).toMatchObject({ rate_id: 5, tax_is_inclusive: false, category: null });
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('fuera del alcance'),
      );
    });

    it('ids vacíos o inválidos ⇒ mapa vacío sin leer la DB', async () => {
      await expect(service.loadRateTaxContext([], { store_id: 1 })).resolves.toEqual(new Map());
      await expect(
        service.loadRateTaxContext([0, -1, NaN, 1.5] as any, { store_id: 1 }),
      ).resolves.toEqual(new Map());
      expect(base.stores.findFirst).not.toHaveBeenCalled();
      expect(base.shipping_rates.findMany).not.toHaveBeenCalled();
    });

    it('sin store_id explícito usa el contexto en curso', async () => {
      base.stores.findFirst.mockResolvedValue(storeRow({ responsibilities: ['O-48'] }));
      base.shipping_rates.findMany.mockResolvedValue([]);
      await service.loadRateTaxContext([5]);
      expect(base.shipping_rates.findMany.mock.calls[0][0].where.shipping_zone).toEqual({
        OR: [{ store_id: 1 }, { is_system: true, store_id: null }],
      });
    });
  });

  describe('toTaxCategoryView', () => {
    it('proyecta la forma del contrato', () => {
      expect(ShippingTaxService.toTaxCategoryView(inc8)).toEqual({
        id: 7,
        name: 'INC 8%',
        tax_type: 'inc',
        rate_percent: 8,
      });
      expect(ShippingTaxService.toTaxCategoryView(null)).toBeNull();
    });

    it('sin tipo ⇒ iva; otro tipo ⇒ su tipo real (no se etiqueta como iva)', () => {
      const base = { id: 9, name: 'X', tax_rates: [{ id: 90, name: 'X', rate: 0.1 }] };
      expect(
        ShippingTaxService.toTaxCategoryView({ ...base, tax_type: null } as any)?.tax_type,
      ).toBe('iva');
      expect(
        ShippingTaxService.toTaxCategoryView({ ...base, tax_type: 'ibua' } as any)?.tax_type,
      ).toBe('ibua');
      expect(
        ShippingTaxService.toTaxCategoryView({ ...base, tax_type: 'withholding' } as any)?.tax_type,
      ).toBe('withholding');
    });
  });
});
