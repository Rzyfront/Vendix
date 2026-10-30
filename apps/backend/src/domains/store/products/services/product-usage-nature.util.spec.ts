import {
  applyUsageNatureRules,
  assertSaleNatureLines,
  assertSaleNatureProducts,
  isSaleNature,
} from './product-usage-nature.util';

describe('product-usage-nature.util', () => {
  describe('isSaleNature', () => {
    it('treats null/undefined as sale (column default)', () => {
      expect(isSaleNature(undefined)).toBe(true);
      expect(isSaleNature(null)).toBe(true);
      expect(isSaleNature('sale')).toBe(true);
      expect(isSaleNature('supply')).toBe(false);
      expect(isSaleNature('internal_use')).toBe(false);
    });
  });

  describe('applyUsageNatureRules', () => {
    it('leaves a retail payload without usage_nature untouched', () => {
      const dto = { name: 'Camisa', is_sellable: true, available_for_ecommerce: true };
      expect(applyUsageNatureRules(dto)).toBe(dto);
    });

    it('supply: never sellable nor published, always ingredient', () => {
      const out = applyUsageNatureRules({
        usage_nature: 'supply',
        is_sellable: true,
        is_ingredient: false,
        available_for_ecommerce: true,
        is_featured: true,
        is_on_sale: true,
        online_purchase_url: 'https://x',
      });
      expect(out).toMatchObject({
        is_sellable: false,
        is_ingredient: true,
        available_for_ecommerce: false,
        is_featured: false,
        is_on_sale: false,
        online_purchase_url: null,
      });
    });

    it('internal_use: never sellable and never an ingredient', () => {
      const out = applyUsageNatureRules({
        usage_nature: 'internal_use',
        is_sellable: true,
        is_ingredient: true,
        available_for_ecommerce: true,
      });
      expect(out).toMatchObject({
        is_sellable: false,
        is_ingredient: false,
        available_for_ecommerce: false,
      });
    });

    it('partial update inherits the existing non-sale nature', () => {
      const out = applyUsageNatureRules({ is_sellable: true }, 'internal_use');
      expect(out.is_sellable).toBe(false);
    });

    it('moving back to sale without is_sellable makes it sellable again', () => {
      expect(
        applyUsageNatureRules<{ usage_nature: string; is_sellable?: boolean }>({ usage_nature: 'sale' }, 'internal_use').is_sellable,
      ).toBe(true);
    });

    it('a sale product that is also an ingredient keeps selling (the sauce)', () => {
      const dto = { usage_nature: 'sale', is_sellable: true, is_ingredient: true };
      expect(applyUsageNatureRules(dto, 'sale')).toBe(dto);
    });
  });

  describe('assertSaleNatureProducts', () => {
    it('passes sale products', () => {
      expect(() =>
        assertSaleNatureProducts([{ id: 1, name: 'Hamburguesa', usage_nature: 'sale' }]),
      ).not.toThrow();
    });

    it('rejects a supply with a 422 and a readable message', () => {
      try {
        assertSaleNatureProducts([{ id: 7, name: 'Harina', usage_nature: 'supply' }]);
        fail('expected throw');
      } catch (e: any) {
        expect(e.getStatus()).toBe(422);
        expect(e.getResponse()).toMatchObject({
          error_code: 'PROD_NATURE_NOT_SELLABLE',
          message: '"Harina" es un producto de Insumo y no se puede vender.',
        });
      }
    });
  });

  it('rejects a legacy pure ingredient (sale nature, is_ingredient && !is_sellable)', () => {
    expect(() =>
      assertSaleNatureProducts([
        { id: 2, name: 'Leche Entera 1L', usage_nature: 'sale', is_ingredient: true, is_sellable: false },
      ]),
    ).toThrow('"Leche Entera 1L" es un producto de Insumo y no se puede vender.');
  });

  it('lets a sellable sale product that is also an ingredient through (the sauce)', () => {
    expect(() =>
      assertSaleNatureProducts([
        { id: 3, name: 'Salsa', usage_nature: 'sale', is_ingredient: true, is_sellable: true },
      ]),
    ).not.toThrow();
  });

  describe('assertSaleNatureLines', () => {
    it('does not query when there are no product lines', async () => {
      const prisma = { products: { findMany: jest.fn() } };
      await assertSaleNatureLines(prisma, [{ product_id: null }]);
      await assertSaleNatureLines(prisma, undefined);
      expect(prisma.products.findMany).not.toHaveBeenCalled();
    });

    it('queries only non-sale offenders among the line products', async () => {
      const prisma = { products: { findMany: jest.fn().mockResolvedValue([]) } };
      await assertSaleNatureLines(prisma, [{ product_id: 3 }, { product_id: 3 }, { product_id: 4 }]);
      expect(prisma.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: [3, 4] },
            OR: [
              { usage_nature: { not: 'sale' } },
              { is_ingredient: true, is_sellable: false },
            ],
          },
        }),
      );
    });

    it('rejects when a line is an internal-use product', async () => {
      const prisma = {
        products: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ id: 9, name: 'Toalla', usage_nature: 'internal_use' }]),
        },
      };
      await expect(assertSaleNatureLines(prisma, [{ product_id: 9 }])).rejects.toMatchObject({
        response: expect.objectContaining({
          error_code: 'PROD_NATURE_NOT_SELLABLE',
          message: '"Toalla" es un producto de Uso interno y no se puede vender.',
        }),
      });
    });
  });
});
