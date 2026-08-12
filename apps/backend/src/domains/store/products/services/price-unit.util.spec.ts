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

    /**
     * EL AGUJERO QUE DEJABA `final_unit_price` COMO ÚNICO TESTIGO.
     *
     * El camino vivo no manda `final_unit_price`: el POS web cotiza con
     * `unit_price` neto + `tax_amount_item` + `total_price` bruto
     * (`pos.component.ts#onQuote`). Sin el testigo unitario la función no podía
     * reconstruir el bruto esperado, leía el IVA como desfase de escala y
     * reescalaba el impuesto proporcional a la corrección del total.
     *
     * Medido en dev contra `POST /store/quotations` con el producto 394 (escala
     * 1.000, $5.000/m) — 2 m a $3.781,51 el metro:
     *   correcto → neto 7.563,02 + IVA 1.436,97 = 9.000,00
     *   obtenido → neto 7.563,02 + IVA 1.207,54 = 8.770,56
     * El IVA salía multiplicado por 7563,02/9000 ≈ 0,8403. Faltaban $229,44.
     */
    it('lee el bruto desde tax_amount_item cuando no viene final_unit_price', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2000, // 2 m de un cable en mm
          unit_price: 3781.51, // neto por metro
          tax_rate: 0.19,
          tax_amount_item: 1436.97,
          total_price: 9000, // bruto y YA escalado: 3.781,51 × 2 × 1,19
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      // La línea queda en la magnitud de la columna (neta y escalada)...
      expect(lines[0].total_price).toBe(7563.02);
      // ...y el IVA NO se toca: su base no cambió, solo la magnitud del total.
      expect(lines[0].tax_amount_item).toBe(1436.97);
      expect(result.subtotalDelta).toBe(0);
      expect(result.taxDelta).toBe(0);
    });

    it('lee el bruto desde tax_rate cuando es el único testigo', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2000,
          unit_price: 3781.51,
          tax_rate: 0.19,
          total_price: 9000, // bruto y YA escalado
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(7563.02);
      expect(result.subtotalDelta).toBe(0);
      expect(result.taxDelta).toBe(0);
    });

    /**
     * El simétrico del anterior: el mismo cliente, los mismos testigos, pero el
     * bruto tampoco aplicó la escala (3.781,51 × 2.000 × 1,19). Acá SÍ hay
     * desfase de escala y hay que corregir las dos magnitudes de la cabecera —
     * medidas contra el neto sin escalar, no contra el bruto recibido.
     */
    it('corrige neto e IVA cuando el bruto sin final_unit_price tampoco aplicó la escala', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2000,
          unit_price: 3781.51,
          tax_rate: 0.19,
          tax_amount_item: 1_436_973.8, // IVA del neto sin escalar
          total_price: 8_999_993.8, // 7.563.020 × 1,19
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(7563.02);
      expect(lines[0].tax_amount_item).toBe(1436.97);
      // Delta = efecto puro de la escala en neto: 7.563,02 − 7.563.020
      expect(result.subtotalDelta).toBeCloseTo(-7_555_456.98, 2);
      expect(result.taxDelta).toBeCloseTo(-1_435_536.83, 2);
      expect(result.adjusted).toBe(1);
    });

    /**
     * El testigo nuevo no puede secuestrar la lectura NETA sin escalar: acá el
     * total llegó crudo en neto y el delta tiene que medirse contra él, no
     * contra su bruto reconstruido.
     */
    it('el testigo de impuesto no confunde un neto sin escalar con un bruto', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2000,
          unit_price: 3781.51,
          tax_amount_item: 1_436_973.8,
          total_price: 7_563_020, // neto SIN escalar
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(7563.02);
      expect(lines[0].tax_amount_item).toBe(1436.97);
      expect(result.subtotalDelta).toBeCloseTo(-7_555_456.98, 2);
    });

    it('no mueve nada cuando la línea ya vino neta y escalada con su impuesto', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2000,
          unit_price: 3781.51,
          tax_rate: 0.19,
          tax_amount_item: 1436.97,
          total_price: 7563.02, // neto y YA escalado
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(7563.02);
      expect(lines[0].tax_amount_item).toBe(1436.97);
      expect(result.adjusted).toBe(0);
      expect(result.subtotalDelta).toBe(0);
      expect(result.taxDelta).toBe(0);
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
        { isPresentationAtIndex: () => true },
      );

      expect(lines[0].total_price).toBe(190000);
      expect(result.adjusted).toBe(0);
      expect(result.priceUnitByIndex).toEqual([null]);
    });

    /**
     * `price_tiers` cumple dos papeles y solo UNO justifica la exclusión.
     *
     * Una PRESENTACIÓN (`kind='sale_unit'`, Rollo 20 m) cambia la magnitud de
     * `quantity`: `unit_price` es el precio del paquete y dividir otra vez
     * cobraría de menos. Una TARIFA DE CLIENTE (`kind='customer_tier'`,
     * Mayorista) solo cambia el número: lo sigue expresando por unidad de
     * PRECIO, así que la escala del producto aplica igual que sin tarifa.
     *
     * El predicado se llamaba `hasTierAtIndex` y excluía las dos. Con eso, 2 m
     * de un cable a $4.500 el metro con tarifa Mayorista se persistían tal como
     * los mandara el cliente: `POST /store/orders` guardó **$9.000.000**
     * (orden 730 en dev) en vez de $9.000.
     */
    it('NO excluye una línea con tarifa de cliente: la escala sigue aplicando', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 2000, // 2 m de un cable en mm
          unit_price: 4500, // precio Mayorista POR METRO
          total_price: 9_000_000, // el cliente mandó la aritmética cruda
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
        // Una tarifa de cliente no es presentación: packSize resuelve a 1.
        { isPresentationAtIndex: () => false },
      );

      expect(lines[0].total_price).toBe(9000);
      expect(result.adjusted).toBe(1);
      expect(result.priceUnitByIndex).toEqual([1000]);
    });

    /**
     * Una línea de PESO trae `quantity = 1` y el multiplicador real en `weight`,
     * con su propia unidad en `weight_unit`. Dividir `quantity` por la escala no
     * la corrige: la destruye. 1,35 kg de queso a $22.000 el kilo se persistía
     * en **$22,00** (`22000 × 1 / 1000`) — un cobro mil veces menor, que es peor
     * que no haber aplicado la escala.
     *
     * La línea queda fuera porque el peso YA es la magnitud de venta y el precio
     * ya se expresa por unidad de peso; no hay una segunda escala que aplicar.
     */
    it('NO toca una línea de peso: el peso ya es su magnitud de venta', async () => {
      const lines = [
        {
          product_id: 1,
          quantity: 1,
          weight: 1.35,
          unit_price: 22000,
          total_price: 29700,
        },
      ];
      const result = await normalizePriceUnitLines(
        clientWithScales({ 1: 1000 }),
        lines,
      );

      expect(lines[0].total_price).toBe(29700);
      expect(result.adjusted).toBe(0);
      expect(result.priceUnitByIndex).toEqual([null]);
      expect(result.subtotalDelta).toBe(0);
    });

    it('un weight en 0 o nulo no exime a la línea de la escala', async () => {
      // Solo un peso POSITIVO identifica una línea de peso; un 0 residual no
      // puede servir de puerta para saltarse el recálculo.
      for (const weight of [0, null, undefined]) {
        const lines = [
          {
            product_id: 1,
            quantity: 3000,
            weight,
            unit_price: 5000,
            total_price: 15_000_000,
          },
        ];
        const result = await normalizePriceUnitLines(
          clientWithScales({ 1: 1000 }),
          lines,
        );
        expect(lines[0].total_price).toBe(15000);
        expect(result.adjusted).toBe(1);
      }
    });
  });
});
