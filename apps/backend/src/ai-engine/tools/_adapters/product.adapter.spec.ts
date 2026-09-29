import {
  PRODUCT_ADAPTER_VERSION,
  effectiveTracking,
  parseAttributes,
  taxBreakdown,
  variantLabel,
} from './product.adapter';

/**
 * Paso 15 (T6) — contrato del adaptador `products`.
 *
 * Pinnea (a) la versión del adaptador contra el contrato (`'1'`),
 * (b) equivalencia happy con los mappers que vivían inline en
 * `products.tools.ts` y (c) degradación honesta: columna ausente sale `null`,
 * nunca un cero o un texto inventado.
 */
describe('product.adapter', () => {
  describe('versión', () => {
    it("implementa el contrato v1 de las tools", () => {
      expect(PRODUCT_ADAPTER_VERSION).toBe('1');
    });
  });

  describe('taxBreakdown', () => {
    it('happy: filas {name, rate_pct} con el porcentaje redondeado', () => {
      expect(
        taxBreakdown([
          { tax_categories: { tax_rates: [{ rate: 0.19, name: 'IVA 19%' }] } },
          { tax_categories: { tax_rates: [{ rate: 0.08, name: 'INC 8%' }] } },
        ]),
      ).toEqual([
        { name: 'IVA 19%', rate_pct: 19 },
        { name: 'INC 8%', rate_pct: 8 },
      ]);
    });

    it('sad: rate ausente o no numérico sale null, nunca un 0% inventado', () => {
      expect(
        taxBreakdown([
          { tax_categories: { tax_rates: [{ name: 'IVA sin tasa' }] } },
          { tax_categories: { tax_rates: [{ rate: 'basura', name: 'X' }] } },
        ]),
      ).toEqual([
        { name: 'IVA sin tasa', rate_pct: null },
        { name: 'X', rate_pct: null },
      ]);
    });

    it('sad: nombre ausente sale null y entrada nula sale []', () => {
      expect(
        taxBreakdown([
          { tax_categories: { tax_rates: [{ rate: 0.19 }] } },
        ]),
      ).toEqual([{ name: null, rate_pct: 19 }]);
      expect(taxBreakdown(null)).toEqual([]);
      expect(taxBreakdown(undefined)).toEqual([]);
    });
  });

  describe('effectiveTracking', () => {
    it('el override manda cuando está fijado; null hereda del producto', () => {
      expect(effectiveTracking({ track_inventory: true })).toBe(true);
      expect(effectiveTracking({ track_inventory: false })).toBe(false);
      expect(
        effectiveTracking(
          { track_inventory: false },
          { track_inventory_override: true },
        ),
      ).toBe(true);
      expect(
        effectiveTracking(
          { track_inventory: true },
          { track_inventory_override: false },
        ),
      ).toBe(false);
      expect(
        effectiveTracking(
          { track_inventory: true },
          { track_inventory_override: null },
        ),
      ).toBe(true);
    });
  });

  describe('variantLabel', () => {
    it('nombre explícito, luego atributos, luego SKU, luego id', () => {
      expect(variantLabel({ id: 1, name: 'Roja' })).toBe('Roja');
      expect(
        variantLabel({
          id: 2,
          attributes: { Talla: 'M', Color: 'Rojo' },
          sku: 'V-2',
        }),
      ).toBe('Talla: M, Color: Rojo');
      expect(variantLabel({ id: 3, sku: 'V-3' })).toBe('V-3');
      expect(variantLabel({ id: 4 })).toBe('variante 4');
    });

    it('parseAttributes: objeto plano o null, nunca inventa claves', () => {
      expect(parseAttributes({ a: 1 })).toEqual({ a: '1' });
      expect(parseAttributes(null)).toBeNull();
      expect(parseAttributes({})).toBeNull();
    });
  });
});
