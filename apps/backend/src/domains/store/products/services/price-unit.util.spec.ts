import {
  normalizePriceUnitLines,
  resolveLineTotal,
  resolvePriceUnits,
  resolvePriceUnitScale,
} from './price-unit.util';

/**
 * Cliente Prisma mínimo: solo tiene que responder `price_unit_quantity` por
 * producto, que es lo único que la normalización lee de la base.
 */
const clientWithScales = (scales: Record<number, number>) => ({
  products: {
    findMany: async ({ where }: any) =>
      (where.id.in as number[]).map((id) => ({
        id,
        price_unit_quantity: scales[id] ?? 1,
      })),
  },
});

describe('price-unit.util', () => {
  describe('resolvePriceUnitScale / resolvePriceUnits', () => {
    it('colapsa a 1 con null, 0, 1 o basura', () => {
      expect(resolvePriceUnitScale(null)).toBe(1);
      expect(resolvePriceUnitScale(undefined)).toBe(1);
      expect(resolvePriceUnitScale(0)).toBe(1);
      expect(resolvePriceUnitScale(1)).toBe(1);
      expect(resolvePriceUnitScale('no-es-un-numero')).toBe(1);
    });

    it('convierte unidades de stock a unidades de precio', () => {
      expect(resolvePriceUnits(3000, 1000)).toBe(3);
      expect(resolvePriceUnits(500, 1000)).toBe(0.5);
      expect(resolvePriceUnits(3, 1)).toBe(3);
    });
  });

  describe('resolveLineTotal', () => {
    it('cobra $15.000 por 3.000 mm de un cable a $5.000 el metro', () => {
      expect(resolveLineTotal(5000, 3000, 1000)).toBe(15000);
    });

    it('con escala 1 es la aritmética histórica', () => {
      expect(resolveLineTotal(5000, 3, 1)).toBe(15000);
      expect(resolveLineTotal(5000, 3, null)).toBe(15000);
    });
  });

  describe('normalizePriceUnitLines', () => {
    it('no toca nada cuando ningún producto tiene escala', async () => {
      const lines = [
        { product_id: 1, quantity: 3, unit_price: 5000, total_price: 15000 },
      ];
      const result = await normalizePriceUnitLines(clientWithScales({}), lines);

      expect(result.adjusted).toBe(0);
      expect(result.subtotalDelta).toBe(0);
      expect(result.priceUnitByIndex).toEqual([null]);
      expect(lines[0].total_price).toBe(15000);
    });

    it('corrige la línea de un cliente viejo que no aplicó la escala', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 3000,
          unit_price: 5000,
          total_price: 15_000_000,
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(15000);
      expect(result.priceUnitByIndex).toEqual([1000]);
      expect(result.adjusted).toBe(1);
      expect(result.subtotalDelta).toBe(-14_985_000);
    });

    it('respeta la línea de un cliente que YA aplicó la escala', async () => {
      const lines = [
        { product_id: 1, quantity: 3000, unit_price: 5000, total_price: 15000 },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(15000);
      expect(result.subtotalDelta).toBe(0);
      expect(result.taxDelta).toBe(0);
    });

    it('deja intacta la línea neta y escalada aunque venga con final_unit_price', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 3000,
          unit_price: 5000,
          final_unit_price: 5950,
          total_price: 15000, // neto y YA escalado
          tax_amount_item: 950,
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(15000);
      expect(result.adjusted).toBe(0);
      expect(result.subtotalDelta).toBe(0);
      expect(result.taxDelta).toBe(0);
    });

    /**
     * El caso que motivó el contrato de magnitudes: el POS manda `unit_price`
     * neto y `total_price` bruto. Comparar el esperado neto contra ese bruto
     * daba una diferencia que era el IVA de la línea, no el desfase de escala,
     * y la cabecera —que ya venía neta y correcta— terminaba perdiendo el IVA.
     */
    it('no confunde el IVA con el desfase de escala (unit_price neto + total_price bruto)', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 3000,
          unit_price: 5000, // neto por metro
          final_unit_price: 5950, // bruto por metro (19%)
          total_price: 17850, // bruto y YA escalado: 5950 × 3
          tax_amount_item: 950,
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      // La línea queda en la magnitud de la columna (neta y escalada)...
      expect(lines[0].total_price).toBe(15000);
      // ...pero la cabecera no se mueve: no había desfase de escala.
      expect(result.subtotalDelta).toBe(0);
      expect(result.taxDelta).toBe(0);
      expect(lines[0].tax_amount_item).toBe(950);
    });

    it('sí corrige cuando el total bruto tampoco aplicó la escala', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 3000,
          unit_price: 5000,
          final_unit_price: 5950,
          total_price: 17_850_000, // bruto SIN escalar: 5950 × 3000
          tax_amount_item: 950,
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(15000);
      // Delta = efecto puro de la escala, en neto: 15.000 − (5.000 × 3.000)
      expect(result.subtotalDelta).toBe(-14_985_000);
    });

    it('excluye las líneas con presentación aplicada', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2,
          unit_price: 95000,
          total_price: 190000,
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
        { hasTierAtIndex: () => true },
      );

      expect(lines[0].total_price).toBe(190000);
      expect(result.adjusted).toBe(0);
      expect(result.priceUnitByIndex).toEqual([null]);
    });
  });
});
