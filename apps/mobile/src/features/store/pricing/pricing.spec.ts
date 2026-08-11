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
