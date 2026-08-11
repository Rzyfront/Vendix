/**
 * Paridad de aritmética móvil ↔ backend (QUI-648).
 *
 * Cada caso de acá tiene su gemelo conceptual en
 * `apps/backend/src/domains/store/products/services/price-unit.util.ts` y
 * `packaging.util.ts`. Si uno de los dos lados cambia sin el otro, el POS móvil
 * y el POS web dejan de cobrar lo mismo por la misma venta — que es exactamente
 * lo que estas pruebas existen para impedir.
 */
import {
  roundMoney,
  resolveLineTotal,
  resolveUnitPriceAtBase,
  resolvePriceUnitQuantity,
} from './price-unit.util';
import { resolvePackSize, resolveStockUnitsConsumed } from './packaging.util';
import {
  resolveNetUnitPriceAtStockUnit,
  resolvePresentationPrice,
  resolveSaleUnitPresentations,
} from './sale-unit.util';
import {
  PIECE_SALE_UNIT,
  resolveSaleUnitConfig,
  requiresSaleQuantityCapture,
  resolveStockUnitsFromCapture,
  resolveSaleQuantity,
  isSaleUnitLine,
  formatSaleQuantity,
  resolveQuantityStep,
} from './sale-capture.util';

describe('resolveLineTotal — cero regresión con escala 1', () => {
  it('colapsa a unitPrice × quantity cuando la escala está ausente', () => {
    expect(resolveLineTotal(1500, 3)).toBe(4500);
    expect(resolveLineTotal(1500, 3, null)).toBe(4500);
    expect(resolveLineTotal(1500, 3, 1)).toBe(4500);
  });

  it('ignora escalas inválidas (0, negativa, NaN) en vez de dividir por ellas', () => {
    expect(resolveLineTotal(1000, 2, 0)).toBe(2000);
    expect(resolveLineTotal(1000, 2, -5)).toBe(2000);
    expect(resolveLineTotal(1000, 2, Number.NaN)).toBe(2000);
  });

  it('reproduce exactamente el producto simple para precios de 2 decimales', () => {
    for (const price of [0, 0.01, 19.99, 1234.56, 99999.99]) {
      for (const qty of [1, 2, 7, 33]) {
        expect(resolveLineTotal(price, qty, 1)).toBe(roundMoney(price * qty));
      }
    }
  });
});

describe('resolveLineTotal — el caso que la feature vino a evitar', () => {
  // Cable a $5.000 el metro, stock en milímetros: base_price=5000, N=1000.
  it('cobra $12.500 por 2.500 mm y NO $25.000', () => {
    expect(resolveLineTotal(5000, 2500, 1000)).toBe(12500);

    // El camino viejo: redondear el precio unitario ANTES de multiplicar.
    const roundedUnit = roundMoney(5000 / 1000); // $5,00
    expect(roundedUnit * 2500).toBe(12500);

    // El camino verdaderamente roto es la escala chica: cinta a $5 el metro
    // son $0,005/mm, que redondeado a centavos es $0,01 → cobra el DOBLE.
    expect(resolveLineTotal(5, 2500, 1000)).toBe(12.5);
    expect(roundMoney(5 / 1000) * 2500).toBe(25);
  });

  it('redondea UNA sola vez, al final', () => {
    // 1 unidad de un producto a $0,005 efectivos no se convierte en $0,01.
    expect(resolveLineTotal(5, 1, 1000)).toBe(0.01); // sí redondea el TOTAL
    expect(resolveLineTotal(5, 200, 1000)).toBe(1); // y 200 mm son $1 exactos
  });
});

describe('resolveUnitPriceAtBase / resolvePriceUnitQuantity', () => {
  it('no redondea el precio por unidad de stock', () => {
    expect(resolveUnitPriceAtBase(5, 1000)).toBe(0.005);
    expect(resolveUnitPriceAtBase(5000, 1000)).toBe(5);
    expect(resolveUnitPriceAtBase(1500, 1)).toBe(1500);
    expect(resolveUnitPriceAtBase(1500, null)).toBe(1500);
  });

  it('normaliza la escala a un número >= 1', () => {
    expect(resolvePriceUnitQuantity(undefined)).toBe(1);
    expect(resolvePriceUnitQuantity(null)).toBe(1);
    expect(resolvePriceUnitQuantity(0)).toBe(1);
    expect(resolvePriceUnitQuantity(1)).toBe(1);
    expect(resolvePriceUnitQuantity(1000)).toBe(1000);
  });
});

describe('resolvePackSize — cascada override ?? tier ?? 1', () => {
  it('el override del producto gana sobre el de la tarifa', () => {
    expect(resolvePackSize(12, 50)).toBe(50);
  });

  it('sin override usa el de la tarifa', () => {
    expect(resolvePackSize(12, null)).toBe(12);
    expect(resolvePackSize(12, undefined)).toBe(12);
  });

  it('cualquier valor <= 1 colapsa a 1 (comportamiento sin empaque)', () => {
    expect(resolvePackSize(null, null)).toBe(1);
    expect(resolvePackSize(1, null)).toBe(1);
    expect(resolvePackSize(0, null)).toBe(1);
    expect(resolvePackSize(-3, null)).toBe(1);
  });
});

describe('resolveStockUnitsConsumed', () => {
  it('devuelve null cuando no hay empaque, para no persistir snapshot', () => {
    expect(resolveStockUnitsConsumed(5, null, null)).toBeNull();
    expect(resolveStockUnitsConsumed(5, 1, null)).toBeNull();
  });

  it('multiplica paquetes × packSize cuando hay empaque', () => {
    expect(resolveStockUnitsConsumed(3, 50, null)).toBe(150);
    expect(resolveStockUnitsConsumed(3, 12, 50)).toBe(150);
  });
});

describe('presentaciones de venta', () => {
  const cable = {
    base_price: 5000,
    price_unit_quantity: 1000, // $5.000 por metro, stock en mm
    enabled_price_tier_ids: [7],
  };

  it('el precio por unidad de stock descuenta la escala', () => {
    expect(resolveNetUnitPriceAtStockUnit(cable)).toBe(5);
    expect(
      resolveNetUnitPriceAtStockUnit({ base_price: 1200, is_on_sale: true, sale_price: 900 }),
    ).toBe(900);
    // Una "oferta" mayor que el precio base no es una oferta.
    expect(
      resolveNetUnitPriceAtStockUnit({ base_price: 1200, is_on_sale: true, sale_price: 1500 }),
    ).toBe(1200);
  });

  it('un override_price explícito ES el precio del paquete', () => {
    const r = resolvePresentationPrice(cable, 20000, 85000, 10);
    expect(r).toEqual({
      unitPrice: 85000,
      hasExplicitPrice: true,
      ambiguous: false,
    });
  });

  it('con escala 1 coincide con la fórmula del web (base × packSize)', () => {
    const bulto = { base_price: 2000, price_unit_quantity: 1 };
    const r = resolvePresentationPrice(bulto, 50, null, 0);
    expect(r.unitPrice).toBe(2000 * 50);
    expect(r.ambiguous).toBe(false);
  });

  it('marca ambigua la presentación sin precio explícito sobre producto con escala', () => {
    // El web resolvería `base_price × packSize` (sin dividir por la escala) y
    // el móvil `precio_por_mm × packSize`. Dos números distintos, sin árbitro.
    expect(resolvePresentationPrice(cable, 20000, null, 10).ambiguous).toBe(true);
  });

  it('solo ofrece tarifas del allowlist y de kind sale_unit', () => {
    const tiers = [
      { id: 7, name: 'Rollo 20 m', kind: 'sale_unit' as const, units_per_package: 20000 },
      { id: 8, name: 'Mayorista', kind: 'customer_tier' as const, discount_percentage: 15 },
      { id: 9, name: 'Caja x12', kind: 'sale_unit' as const, units_per_package: 12 },
    ];
    // Con precio explícito la presentación es inequívoca y sí se ofrece.
    const out = resolveSaleUnitPresentations(
      cable,
      tiers,
      [{ price_tier_id: 7, variant_id: null, override_price: 85000 }],
      7,
    );
    expect(out.map((p) => p.tierId)).toEqual([7]);
    expect(out[0].packSize).toBe(20000);
    expect(out[0].unitPrice).toBe(85000);
    expect(out[0].isDefault).toBe(true);
  });

  it('no ofrece una presentación ambigua en vez de cobrar distinto que el web', () => {
    const out = resolveSaleUnitPresentations(
      cable,
      [{ id: 7, name: 'Rollo 20 m', kind: 'sale_unit' as const, units_per_package: 20000 }],
      [],
    );
    expect(out).toEqual([]);
  });

  it('un producto sin allowlist no ofrece nada (se vende como hoy)', () => {
    expect(
      resolveSaleUnitPresentations({ base_price: 100 }, [
        { id: 1, name: 'Caja', kind: 'sale_unit' as const, units_per_package: 6 },
      ]),
    ).toEqual([]);
  });

  it('el override del producto pisa el packSize de la tarifa', () => {
    const out = resolveSaleUnitPresentations(
      { base_price: 1000, enabled_price_tier_ids: [3] },
      [{ id: 3, name: 'Bulto', kind: 'sale_unit' as const, units_per_package: 25 }],
      [{ price_tier_id: 3, variant_id: null, override_units_per_package: 50 }],
    );
    expect(out[0].packSize).toBe(50);
    expect(out[0].unitPrice).toBe(50000);
  });
});

/* ==========================================================================
 * QUI-648 fase 2 — la CAPTURA.
 *
 * Gemelo conceptual de `pos-sale-unit.service.ts` (`configFor`) y de
 * `pos/utils/line-units.util.ts` del web. Lo que se prueba acá es que el cajero
 * teclea 3 y el carrito guarda 3000, y —sobre todo— que el producto por pieza
 * no se entera de que nada de esto existe.
 * ========================================================================== */

/** Catálogo `units_of_measure` reducido a lo que la conversión necesita. */
const CATALOG = [
  { id: 1, code: 'mm', name: 'Milímetro', dimension: 'length', factor_to_base: 1 },
  { id: 2, code: 'cm', name: 'Centímetro', dimension: 'length', factor_to_base: 10 },
  { id: 3, code: 'm', name: 'Metro', dimension: 'length', factor_to_base: 1000 },
  { id: 4, code: 'g', name: 'Gramo', dimension: 'mass', factor_to_base: 1 },
  { id: 5, code: 'kg', name: 'Kilogramo', dimension: 'mass', factor_to_base: 1000 },
];

describe('resolveSaleUnitConfig — NO REGRESIÓN del producto por pieza', () => {
  // Este bloque es el criterio de aceptación más importante de la fase: un
  // producto sin `stock_uom_id` y sin escala tiene que comportarse EXACTAMENTE
  // como antes — se agrega de un toque, stepper en unidades, sin sufijo.
  it('un producto sin unidad de stock ni escala resuelve por pieza', () => {
    expect(resolveSaleUnitConfig({}, CATALOG)).toEqual(PIECE_SALE_UNIT);
    expect(resolveSaleUnitConfig({ price_unit_quantity: 1 }, CATALOG)).toEqual(
      PIECE_SALE_UNIT,
    );
    expect(
      resolveSaleUnitConfig({ stock_uom_id: null, price_unit_quantity: null }, CATALOG),
    ).toEqual(PIECE_SALE_UNIT);
  });

  it('un producto por pieza NUNCA pide captura de cantidad', () => {
    expect(requiresSaleQuantityCapture(resolveSaleUnitConfig({}, CATALOG))).toBe(false);
    expect(requiresSaleQuantityCapture(PIECE_SALE_UNIT)).toBe(false);
    expect(requiresSaleQuantityCapture(resolveSaleUnitConfig(null, CATALOG))).toBe(false);
  });

  it('con escala pero sin unidad de stock conserva la escala y sigue por pieza', () => {
    // El precio se publica por N unidades, pero no hay unidad física que
    // convertir: la aritmética de cobro ya lo maneja, la captura no cambia.
    const config = resolveSaleUnitConfig({ price_unit_quantity: 1000 }, CATALOG);
    expect(config.priceUnitQuantity).toBe(1000);
    expect(config.stockUnit).toBeNull();
    expect(requiresSaleQuantityCapture(config)).toBe(false);
  });
});

describe('resolveSaleUnitConfig — la unidad de captura derivada', () => {
  // Cable con stock en milímetros y precio por metro.
  const cable = { stock_uom_id: 1, price_unit_quantity: 1000 };

  it('deriva metro sobre milímetro (factor_to_base × price_unit_quantity)', () => {
    const config = resolveSaleUnitConfig(cable, CATALOG);
    expect(config.stockUnit?.code).toBe('mm');
    expect(config.captureUnit?.code).toBe('m');
    expect(config.unitsPerCapture).toBe(1000);
    expect(config.priceUnitQuantity).toBe(1000);
    expect(requiresSaleQuantityCapture(config)).toBe(true);
  });

  it('deriva kilo sobre gramo con la misma regla', () => {
    const config = resolveSaleUnitConfig(
      { stock_uom_id: 4, price_unit_quantity: 1000 },
      CATALOG,
    );
    expect(config.captureUnit?.code).toBe('kg');
    expect(config.unitsPerCapture).toBe(1000);
  });

  it('deriva centímetro cuando la escala es 10, no salta a metro', () => {
    const config = resolveSaleUnitConfig(
      { stock_uom_id: 1, price_unit_quantity: 10 },
      CATALOG,
    );
    expect(config.captureUnit?.code).toBe('cm');
    expect(config.unitsPerCapture).toBe(10);
  });

  it('lee la unidad de stock desde el objeto anidado cuando falta el id plano', () => {
    const config = resolveSaleUnitConfig(
      { stock_uom: { id: 1 }, price_unit_quantity: 1000 },
      CATALOG,
    );
    expect(config.captureUnit?.code).toBe('m');
  });

  it('NO cruza dimensiones: gramos con escala 1000 no capturan en metros', () => {
    // 'm' y 'kg' comparten factor_to_base = 1000. Sin el filtro de dimensión
    // el cajero terminaría pesando cable en metros.
    const config = resolveSaleUnitConfig(
      { stock_uom_id: 4, price_unit_quantity: 1000 },
      CATALOG,
    );
    expect(config.captureUnit?.code).toBe('kg');
    expect(config.stockUnit?.dimension).toBe('mass');
  });
});

describe('resolveSaleUnitConfig — cuando no se puede convertir, no se inventa', () => {
  it('sin catálogo cargado cae a por pieza en vez de adivinar la conversión', () => {
    const config = resolveSaleUnitConfig({ stock_uom_id: 1, price_unit_quantity: 1000 }, []);
    expect(config.stockUnit).toBeNull();
    expect(config.priceUnitQuantity).toBe(1000);
    expect(requiresSaleQuantityCapture(config)).toBe(false);
  });

  it('con una unidad de stock que el catálogo no tiene, cae a por pieza', () => {
    const config = resolveSaleUnitConfig(
      { stock_uom_id: 999, price_unit_quantity: 1000 },
      CATALOG,
    );
    expect(config.stockUnit).toBeNull();
    expect(requiresSaleQuantityCapture(config)).toBe(false);
  });

  it('sin unidad equivalente a la escala, captura en la unidad de stock', () => {
    // Escala 100 sobre mm: el catálogo no tiene un decímetro, así que se
    // captura en mm. Nunca se redondea una equivalencia que no existe.
    const config = resolveSaleUnitConfig(
      { stock_uom_id: 1, price_unit_quantity: 100 },
      CATALOG,
    );
    expect(config.captureUnit?.code).toBe('mm');
    expect(config.unitsPerCapture).toBe(1);
    expect(requiresSaleQuantityCapture(config)).toBe(false);
  });

  it('con escala 1 la unidad de captura ES la de stock (sin conversión)', () => {
    const config = resolveSaleUnitConfig({ stock_uom_id: 3 }, CATALOG);
    expect(config.captureUnit?.code).toBe('m');
    expect(config.unitsPerCapture).toBe(1);
    // Preguntar la cantidad acá sería una regresión: se agrega de un toque.
    expect(requiresSaleQuantityCapture(config)).toBe(false);
  });
});

describe('resolveStockUnitsFromCapture — el cajero teclea 3, se guardan 3000', () => {
  it('convierte la unidad de venta a la unidad mínima', () => {
    expect(resolveStockUnitsFromCapture(3, 1000)).toBe(3000);
    expect(resolveStockUnitsFromCapture(2.5, 1000)).toBe(2500);
    expect(resolveStockUnitsFromCapture(0.35, 1000)).toBe(350);
  });

  it('sin factor devuelve la cantidad tal cual (producto por pieza)', () => {
    expect(resolveStockUnitsFromCapture(3, 1)).toBe(3);
    expect(resolveStockUnitsFromCapture(7, 0)).toBe(7);
  });

  it('redondea al entero porque el inventario es Int', () => {
    expect(resolveStockUnitsFromCapture(1.0004, 1000)).toBe(1000);
    expect(resolveStockUnitsFromCapture(1.0006, 1000)).toBe(1001);
  });

  it('devuelve 0 cuando la captura no alcanza ni una unidad mínima', () => {
    // Vender aire no es una venta: el caller avisa cuál es el mínimo real.
    expect(resolveStockUnitsFromCapture(0.0004, 1000)).toBe(0);
    expect(resolveStockUnitsFromCapture(0, 1000)).toBe(0);
    expect(resolveStockUnitsFromCapture(-3, 1000)).toBe(0);
    expect(resolveStockUnitsFromCapture(Number.NaN, 1000)).toBe(0);
  });
});

describe('líneas del carrito — NO REGRESIÓN del producto por pieza', () => {
  // Una línea sin unidad de captura es indistinguible de una línea anterior a
  // esta fase: misma cantidad, mismo texto, mismo paso del stepper.
  const pieza = { quantity: 4 };

  it('muestra la cantidad cruda, sin sufijo', () => {
    expect(resolveSaleQuantity(pieza)).toBe(4);
    expect(formatSaleQuantity(pieza)).toBe('4');
  });

  it('no es una línea capturada en unidad de venta', () => {
    expect(isSaleUnitLine(pieza)).toBe(false);
    expect(isSaleUnitLine({ quantity: 4, saleUnitCode: null })).toBe(false);
    expect(
      isSaleUnitLine({ quantity: 4, saleUnitCode: 'm', stockUnitsPerSaleUnit: 1 }),
    ).toBe(false);
    // Factor sin código tampoco: los dos campos se escriben juntos.
    expect(isSaleUnitLine({ quantity: 4, stockUnitsPerSaleUnit: 1000 })).toBe(false);
  });

  it('el stepper se sigue moviendo de a 1', () => {
    expect(resolveQuantityStep(pieza)).toBe(1);
    expect(resolveQuantityStep({ quantity: 4, saleUnitCode: 'm' })).toBe(1);
    expect(
      resolveQuantityStep({ quantity: 4, saleUnitCode: 'm', stockUnitsPerSaleUnit: 1 }),
    ).toBe(1);
  });
});

describe('líneas del carrito — capturadas en unidad de venta', () => {
  // 3 metros de cable: el carrito guarda 3000 mm, el cajero lee "3 m".
  const tresMetros = {
    quantity: 3000,
    saleUnitCode: 'm',
    stockUnitsPerSaleUnit: 1000,
  };

  it('se lee en la unidad capturada, nunca en la mínima', () => {
    expect(resolveSaleQuantity(tresMetros)).toBe(3);
    expect(isSaleUnitLine(tresMetros)).toBe(true);
    expect(formatSaleQuantity(tresMetros)).toBe('3 m');
  });

  it('formatea decimales con coma y hasta 3 dígitos, sin ceros de relleno', () => {
    expect(formatSaleQuantity({ ...tresMetros, quantity: 2500 })).toBe('2,5 m');
    expect(formatSaleQuantity({ ...tresMetros, quantity: 350 })).toBe('0,35 m');
    expect(formatSaleQuantity({ ...tresMetros, quantity: 1 })).toBe('0,001 m');
    expect(
      formatSaleQuantity({ quantity: 2350, saleUnitCode: 'kg', stockUnitsPerSaleUnit: 1000 }),
    ).toBe('2,35 kg');
  });

  it('el stepper se mueve de a UNA unidad de venta', () => {
    // Con paso 1 llegar a 3 metros costaba 3000 toques.
    expect(resolveQuantityStep(tresMetros)).toBe(1000);
    expect(resolveSaleQuantity({ ...tresMetros, quantity: 3000 + 1000 })).toBe(4);
  });

  it('el cobro NO cambia por capturar en otra unidad', () => {
    // 3 m de cable a $5.000/m son $15.000, se hayan tecleado como 3 o 3000.
    const quantity = resolveStockUnitsFromCapture(3, 1000);
    expect(quantity).toBe(3000);
    expect(resolveLineTotal(5000, quantity, 1000)).toBe(15000);
    // Y la línea se sigue mostrando en metros.
    expect(
      formatSaleQuantity({ quantity, saleUnitCode: 'm', stockUnitsPerSaleUnit: 1000 }),
    ).toBe('3 m');
  });
});
