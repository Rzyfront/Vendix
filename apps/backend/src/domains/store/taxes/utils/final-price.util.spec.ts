import {
  calculateVariantFinalPrice,
  extractTypedRates,
  groupRatesByProductId,
  resolveOrderLineFinals,
  resolveVariantEffectivePrice,
} from './final-price.util';

/**
 * Precio FINAL con impuesto (display-only).
 *
 * Fija el contrato aditivo: valores persistidos intactos, finales derivados
 * con `resolveLineTotals`. Inclusivo NO crece el total; agregado suma encima.
 */
describe('final-price.util', () => {
  const exc19 = {
    is_inclusive: false,
    tax_categories: {
      is_inclusive: false,
      tax_rates: [{ rate: 0.19, is_inclusive: false }],
    },
  };
  const inc19 = {
    is_inclusive: true,
    tax_categories: {
      is_inclusive: true,
      tax_rates: [{ rate: 0.19, is_inclusive: true }],
    },
  };

  describe('extractTypedRates (precedencia canónica F-012)', () => {
    it('sin asignaciones devuelve [] (precio intacto, cero regresión)', () => {
      expect(extractTypedRates({ base_price: 10000 })).toEqual([]);
      expect(extractTypedRates(null)).toEqual([]);
      expect(extractTypedRates({})).toEqual([]);
    });

    it('el flag de la asignación gana sobre categoría y tasa', () => {
      const rates = extractTypedRates({
        product_tax_assignments: [
          {
            is_inclusive: true,
            tax_categories: {
              is_inclusive: false,
              tax_rates: [{ rate: 0.19, is_inclusive: false }],
            },
          },
        ],
      });
      expect(rates).toEqual([{ rate: 0.19, is_inclusive: true }]);
    });

    it('hereda el default canónico categoría → primera tasa → false', () => {
      expect(
        extractTypedRates({
          product_tax_assignments: [
            {
              tax_categories: {
                is_inclusive: true,
                tax_rates: [{ rate: 0.19, is_inclusive: false }],
              },
            },
          ],
        }),
      ).toEqual([{ rate: 0.19, is_inclusive: true }]);

      expect(
        extractTypedRates({
          product_tax_assignments: [
            {
              tax_categories: {
                tax_rates: [{ rate: 0.19, is_inclusive: true }],
              },
            },
          ],
        }),
      ).toEqual([{ rate: 0.19, is_inclusive: true }]);

      expect(
        extractTypedRates({
          product_tax_assignments: [
            { tax_categories: { tax_rates: [{ rate: 0.19 }] } },
          ],
        }),
      ).toEqual([{ rate: 0.19, is_inclusive: false }]);
    });
  });

  describe('resolveVariantEffectivePrice (sale > override > base)', () => {
    const product = { base_price: 8000 };
    it('prioriza sale cuando hay oferta', () => {
      expect(
        resolveVariantEffectivePrice(
          { is_on_sale: true, sale_price: 7000, price_override: 9000 },
          product,
        ),
      ).toBe(7000);
    });
    it('usa override sin oferta', () => {
      expect(
        resolveVariantEffectivePrice(
          { is_on_sale: false, sale_price: 7000, price_override: 10000 },
          product,
        ),
      ).toBe(10000);
    });
    it('cae a la base del producto sin override', () => {
      expect(
        resolveVariantEffectivePrice({ price_override: null }, product),
      ).toBe(8000);
    });
  });

  describe('calculateVariantFinalPrice', () => {
    const product = (assignments: any[]) => ({
      base_price: 8000,
      product_tax_assignments: assignments,
    });

    it('variante inclusiva: override 10000 + INC 19% → 10000', () => {
      expect(
        calculateVariantFinalPrice(
          { price_override: 10000 },
          product([inc19]),
        ),
      ).toBe(10000);
    });

    it('variante agregada: override 10000 + EXC 19% → 11900', () => {
      expect(
        calculateVariantFinalPrice(
          { price_override: 10000 },
          product([exc19]),
        ),
      ).toBe(11900);
    });

    it('sin tasas hereda el efectivo intacto', () => {
      expect(
        calculateVariantFinalPrice({ price_override: 10000 }, product([])),
      ).toBe(10000);
    });
  });

  describe('resolveOrderLineFinals', () => {
    it('línea agregada: unit 10000 + 19% → final_unit 11900', () => {
      expect(
        resolveOrderLineFinals(10000, 2, [{ rate: 0.19, is_inclusive: false }]),
      ).toEqual({ final_unit_price: 11900, final_total_price: 23800 });
    });

    it('línea inclusiva: unit 10000 + INC 19% → final_unit 10000', () => {
      expect(
        resolveOrderLineFinals(10000, 3, [{ rate: 0.19, is_inclusive: true }]),
      ).toEqual({ final_unit_price: 10000, final_total_price: 30000 });
    });

    it('sin tasas el final es el unit intacto', () => {
      expect(resolveOrderLineFinals(10000, 1, [])).toEqual({
        final_unit_price: 10000,
        final_total_price: 10000,
      });
    });

    it('el total se redondea a 2 decimales', () => {
      const { final_total_price } = resolveOrderLineFinals(100, 3, [
        { rate: 0.19, is_inclusive: false },
      ]);
      // 119 * 3 = 357 exacto; con tasa fraccionaria el redondeo manda.
      expect(final_total_price).toBe(357);
      const odd = resolveOrderLineFinals(10.1, 3, [
        { rate: 0.19, is_inclusive: false },
      ]);
      expect(odd.final_total_price).toBe(
        Math.round(odd.final_unit_price * 3 * 100) / 100,
      );
    });
  });

  describe('groupRatesByProductId', () => {
    it('agrupa UN batch por producto y omite filas sin product_id', () => {
      const grouped = groupRatesByProductId([
        { product_id: 7, ...exc19 },
        { product_id: 7, ...inc19 },
        { product_id: 9, ...exc19 },
      ] as any);
      expect(grouped.get(7)).toEqual([
        { rate: 0.19, is_inclusive: false },
        { rate: 0.19, is_inclusive: true },
      ]);
      expect(grouped.get(9)).toEqual([{ rate: 0.19, is_inclusive: false }]);
    });
  });
});
