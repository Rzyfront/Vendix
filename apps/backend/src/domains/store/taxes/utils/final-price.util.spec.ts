import {
  calculateVariantFinalPrice,
  extractTypedRates,
  groupRatesByProductId,
  resolveLineUnits,
  resolveOrderLineFinals,
  resolveOrderLinePrintedGross,
  resolveOrderLineTaxTotal,
  resolveVariantEffectivePrice,
} from './final-price.util';
// F-158: `calculateVariantFinalPrice`/`resolveOrderLineFinals` solo exponen
// `.total` — para observar `unclosed_residual_cents` (el campo que declara el
// contrato closest-below) hay que llamar al kernel directamente con los
// mismos insumos.
import { resolveLineTotals } from './tax-inclusive-math.util';

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

    // F-216: los cuatro casos que separaban este productor (display) del de
    // cobro (`payments.service.ts:2436 resolveCatalogUnitBasePrice`). Cada
    // expectativa es el numero que el cobro ya devolvia antes de este cambio.
    describe('paridad con el productor de cobro (F-216)', () => {
      const onSale = { base_price: 8000, is_on_sale: true, sale_price: 6000 };

      it('hereda la oferta del producto cuando la variante no tiene precio propio', () => {
        expect(
          resolveVariantEffectivePrice({ price_override: null }, onSale),
        ).toBe(6000);
      });

      it('el override de la variante sigue ganandole a la oferta del producto', () => {
        expect(
          resolveVariantEffectivePrice({ price_override: 9000 }, onSale),
        ).toBe(9000);
      });

      it('un override en 0 no es un precio: cae al siguiente peldano', () => {
        expect(
          resolveVariantEffectivePrice({ price_override: 0 }, onSale),
        ).toBe(6000);
        expect(
          resolveVariantEffectivePrice({ price_override: 0 }, product),
        ).toBe(8000);
      });

      it('una oferta de variante en 0 tampoco lo es', () => {
        expect(
          resolveVariantEffectivePrice(
            { is_on_sale: true, sale_price: 0, price_override: 9000 },
            onSale,
          ),
        ).toBe(9000);
      });

      it('sin oferta activa en el producto la base sigue mandando', () => {
        expect(
          resolveVariantEffectivePrice(
            { price_override: null },
            { base_price: 8000, is_on_sale: false, sale_price: 6000 },
          ),
        ).toBe(8000);
      });
    });
  });

  describe('calculateVariantFinalPrice', () => {
    const product = (assignments: any[]) => ({
      base_price: 8000,
      product_tax_assignments: assignments,
    });

    it('variante inclusiva: override 10000 + INC 19% → 9999.99 (closest-below, residuo declarado)', () => {
      // F-158: con truncado a 2 decimales no existe base cuyo bruto dé
      // 10.000,00 exacto (`tax-inclusive-math.util.ts:79-83,95`); el kernel
      // elige el mayor bruto por debajo (closest-below) y DECLARA el
      // céntimo que no cierra. El bruto NO se conserva exacto.
      expect(
        calculateVariantFinalPrice(
          { price_override: 10000 },
          product([inc19]),
        ),
      ).toBe(9999.99);

      expect(
        resolveLineTotals(10000, [{ rate: 0.19, is_inclusive: true }])
          .unclosed_residual_cents,
      ).toBe(1);
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
        resolveOrderLineFinals({ unit_price: 10000, quantity: 2 }, [
          { rate: 0.19, is_inclusive: false },
        ]),
      ).toEqual({ final_unit_price: 11900, final_total_price: 23800 });
    });

    it('línea inclusiva: unit 10000 + INC 19% → final_unit 9999.99 (closest-below, residuo declarado)', () => {
      // F-158: mismo contrato closest-below que `calculateVariantFinalPrice`
      // — el bruto de 10000 con INC 19% inclusivo no cierra exacto a 2
      // decimales, así que el final por unidad es 9999.99, no 10000.
      expect(
        resolveOrderLineFinals({ unit_price: 10000, quantity: 3 }, [
          { rate: 0.19, is_inclusive: true },
        ]),
      ).toEqual({ final_unit_price: 9999.99, final_total_price: 29999.97 });

      expect(
        resolveLineTotals(10000, [{ rate: 0.19, is_inclusive: true }])
          .unclosed_residual_cents,
      ).toBe(1);
    });

    it('sin tasas el final es el unit intacto', () => {
      expect(resolveOrderLineFinals({ unit_price: 10000, quantity: 1 }, [])).toEqual({
        final_unit_price: 10000,
        final_total_price: 10000,
      });
    });

    it('el total se redondea a 2 decimales', () => {
      const { final_total_price } = resolveOrderLineFinals(
        { unit_price: 100, quantity: 3 },
        [{ rate: 0.19, is_inclusive: false }],
      );
      // 119 * 3 = 357 exacto; con tasa fraccionaria el redondeo manda.
      expect(final_total_price).toBe(357);
      const odd = resolveOrderLineFinals({ unit_price: 10.1, quantity: 3 }, [
        { rate: 0.19, is_inclusive: false },
      ]);
      expect(odd.final_total_price).toBe(
        Math.round(odd.final_unit_price * 3 * 100) / 100,
      );
    });

    // C.12 — F-202: la fila real id=1691 (quantity=1,
    // price_unit_quantity=1000, unit_price=5000) publicaba 5950 donde la
    // línea vale 5,95. Con la firma nueva el total sale 1.000× menor.
    it('C.12/F-202 — línea con escala 1000: el total usa quantity/escala, no quantity', () => {
      const exc19 = [{ rate: 0.19, is_inclusive: false }];
      const scaled = resolveOrderLineFinals(
        { unit_price: 5000, quantity: 1, price_unit_quantity: 1000 },
        exc19,
      );
      expect(scaled.final_unit_price).toBe(5950);
      expect(scaled.final_total_price).toBe(5.95);
      const legacy = resolveOrderLineFinals(
        { unit_price: 5000, quantity: 1 },
        exc19,
      );
      expect(legacy.final_total_price).toBe(5950);
      expect(scaled.final_total_price).toBe(legacy.final_total_price / 1000);
    });

    // C.12 — F-016: con peso capturado el multiplicador es el peso,
    // aunque `quantity` diga otra cosa (p. ej. quantity=3, weight=1.35).
    it('C.12/F-016 — línea con peso: el total usa weight, no quantity', () => {
      const weighed = resolveOrderLineFinals(
        { unit_price: 10000, quantity: 3, weight: 1.35 },
        [{ rate: 0.19, is_inclusive: false }],
      );
      expect(weighed.final_unit_price).toBe(11900);
      expect(weighed.final_total_price).toBe(16065);
    });

    // C.12 — guarda: multiplicador degenerado (0, negativo, NaN) no
    // divide por cero ni negativiza el total; peso 0 cae a la rama
    // de cantidad.
    it('C.12 — guarda contra multiplicador ≤ 0', () => {
      expect(resolveLineUnits({ quantity: 0 })).toBe(0);
      expect(resolveLineUnits({ quantity: -2 })).toBe(0);
      expect(resolveLineUnits({ quantity: NaN })).toBe(0);
      expect(
        resolveOrderLineFinals({ unit_price: 100, quantity: 0 }, []).final_total_price,
      ).toBe(0);
      // Peso 0 no anula la línea: cae a la rama de cantidad.
      expect(resolveLineUnits({ quantity: 2, weight: 0 })).toBe(2);
    });

    // F-151 (major, CP-pos-exclusive-tax-double-charge) — el marcador ADR-08
    // (`tax_amount_item IS NULL` = línea pre-ADR-08 con `unit_price` ya
    // bruto) evita que una tasa EXCLUSIVA se vuelva a sumar sobre un bruto
    // que ya la trae adentro. Base 8403 / bruto exclusivo 9999,57 hace la
    // diferencia (inflar vs. no inflar) visible a simple vista.
    describe('F-151 — marcador ADR-08 (tax_amount_item)', () => {
      const exc19 = [{ rate: 0.19, is_inclusive: false }];

      it('con desglose (tax_amount_item con valor): deriva el bruto desde la BASE', () => {
        expect(
          resolveOrderLineFinals(
            { unit_price: 8403, quantity: 1, tax_amount_item: 1596.57 },
            exc19,
          ),
        ).toEqual({ final_unit_price: 9999.57, final_total_price: 9999.57 });
      });

      it('sin desglose (tax_amount_item: null, línea pre-ADR-08): unit_price YA es el bruto, no se re-aplica la tasa', () => {
        // Misma tasa exclusiva 19% que el caso anterior, pero acá
        // `unit_price` ya es el publicado (9999.57) — sin el fix esto
        // hubiera dado 11899,49 (9999.57 × 1.19), un segundo IVA inventado.
        expect(
          resolveOrderLineFinals(
            { unit_price: 9999.57, quantity: 1, tax_amount_item: null },
            exc19,
          ),
        ).toEqual({ final_unit_price: 9999.57, final_total_price: 9999.57 });
      });

      it('sin el campo (undefined): idéntico al comportamiento de hoy — deriva siempre', () => {
        // Un llamador que no fue migrado a pasar `tax_amount_item`
        // (`orders.service.ts`, fuera de este carril) no puede cambiar de
        // semántica sin revisión: `undefined` cae en la misma rama que el
        // caso "con desglose".
        expect(
          resolveOrderLineFinals({ unit_price: 8403, quantity: 1 }, exc19),
        ).toEqual({ final_unit_price: 9999.57, final_total_price: 9999.57 });
      });
    });
  });

  describe('resolveOrderLineTaxTotal / resolveOrderLinePrintedGross (C.7)', () => {
    it('prioriza `order_item_taxes`, que YA es el total de línea', () => {
      expect(
        resolveOrderLineTaxTotal({
          quantity: 3,
          tax_amount_item: 1900,
          order_item_taxes: [{ tax_amount: 5700 }],
        }),
      ).toBe(5700);
    });

    it('suma las N tasas del desglose mixto', () => {
      expect(
        resolveOrderLineTaxTotal({
          quantity: 1,
          tax_amount_item: 2700,
          order_item_taxes: [{ tax_amount: 1900 }, { tax_amount: 800 }],
        }),
      ).toBe(2700);
    });

    it('sin filas cae al escalar por unidad × line_units (ADR-10)', () => {
      expect(
        resolveOrderLineTaxTotal({ quantity: 3, tax_amount_item: 1900 }),
      ).toBe(5700);
      // Escala: `price_unit_quantity` divide la cantidad.
      expect(
        resolveOrderLineTaxTotal({
          quantity: 6,
          price_unit_quantity: 2,
          tax_amount_item: 1000,
        }),
      ).toBe(3000);
      // Peso manda sobre cantidad.
      expect(
        resolveOrderLineTaxTotal({ quantity: 1, weight: 2.5, tax_amount_item: 400 }),
      ).toBe(1000);
    });

    it('línea pre-ADR-08 (`tax_amount_item` NULL y sin filas) no inventa impuesto', () => {
      expect(
        resolveOrderLineTaxTotal({ quantity: 2, tax_amount_item: null }),
      ).toBe(0);
    });

    it('el bruto impreso suma el impuesto de línea al total y el prorrateo al unitario', () => {
      expect(
        resolveOrderLinePrintedGross({
          quantity: 3,
          unit_price: 10000,
          total_price: 30000,
          tax_amount_item: 1900,
          order_item_taxes: [{ tax_amount: 5700 }],
        }),
      ).toEqual({ gross_unit_price: 11900, gross_total_price: 35700 });
    });

    it('marcador ADR-08: la línea legacy sale intacta, sin doble cobro', () => {
      expect(
        resolveOrderLinePrintedGross({
          quantity: 2,
          unit_price: 11900,
          total_price: 23800,
          tax_amount_item: null,
          order_item_taxes: [],
        }),
      ).toEqual({ gross_unit_price: 11900, gross_total_price: 23800 });
    });

    it('línea exenta: sin impuesto las columnas no se mueven', () => {
      expect(
        resolveOrderLinePrintedGross({
          quantity: 1,
          unit_price: 50000,
          total_price: 50000,
          tax_amount_item: 0,
          order_item_taxes: [],
        }),
      ).toEqual({ gross_unit_price: 50000, gross_total_price: 50000 });
    });

    it('el total manda: Σ líneas cierra al centavo aunque el unitario no sea exacto', () => {
      // 3 × 3.333,33 con IVA de línea 1.900: el unitario prorratea (633,33)
      // pero el total de línea es el persistido + el impuesto de LÍNEA.
      const gross = resolveOrderLinePrintedGross({
        quantity: 3,
        unit_price: 3333.33,
        total_price: 9999.99,
        tax_amount_item: 633.33,
        order_item_taxes: [{ tax_amount: 1900 }],
      });
      expect(gross.gross_total_price).toBe(11899.99);
      expect(gross.gross_unit_price).toBe(3966.66);
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
