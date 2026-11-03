import {
  pickDefaultPrincipal,
  priceScaleFor,
  rescalePrice,
  rescalePriceAnchored,
  rescaleTierOverrides,
  countRescalableTierOverrides,
  countFixedPerUnitTierRules,
} from './sale-uom-principal.util';
import { applyTierAdjustment } from '../../../../../shared/services/pricing/tier-adjustment.util';

/**
 * PR #1062 ronda 2 (HIGH) — stock en g, precio $25.000 por kg (escala 1000).
 * Las candidatas se listan g, lb, kg; marcarlas en ese orden hacía principal
 * a g y el precio pasaba a cobrarse por gramo sin convertir.
 */
const G = 1;
const LB = 2;
const KG = 3;
// Catálogo: la libra comercial colombiana son 500 g exactos
// (20260811100100_uom_catalog_and_price_unit/migration.sql).
const factors: Record<number, number> = { [G]: 1, [LB]: 500, [KG]: 1000 };
const scaleOf = (id: number) => priceScaleFor(factors[id], 1);

describe('pickDefaultPrincipal', () => {
  it('marcando g, lb, kg con precio por kg, la principal es kg', () => {
    expect(pickDefaultPrincipal([G, LB, KG], null, 1000, scaleOf)).toBe(KG);
  });

  it('con precio por unidad de stock, la principal es g', () => {
    expect(pickDefaultPrincipal([KG, G], null, 1, scaleOf)).toBe(G);
  });

  it('conserva la principal elegida mientras siga marcada', () => {
    expect(pickDefaultPrincipal([G, KG], G, 1000, scaleOf)).toBe(G);
  });

  it('sin coincidencia no fija principal; sin marcadas, null', () => {
    expect(pickDefaultPrincipal([G], null, 1000, scaleOf)).toBeNull();
    expect(pickDefaultPrincipal([], null, 1000, scaleOf)).toBeNull();
  });

  it('marcando de a una (g, luego lb, luego kg) con precio por kg, la principal queda kg y la escala no cambia', () => {
    // Simula toggleSaleUom: cada toggle recalcula con la principal previa.
    let checked: number[] = [];
    let principal: number | null = null;
    const scale = 1000;
    const steps: Array<number | null> = [];
    for (const id of [G, LB, KG]) {
      checked = [...checked, id];
      principal = pickDefaultPrincipal(checked, principal, scale, scaleOf);
      steps.push(principal);
    }
    expect(steps).toEqual([null, null, KG]);
  });
});

describe('priceScaleFor', () => {
  it('kg sobre g es 1000 y lb sobre g es 500; lb sobre kg no es entero y no da escala', () => {
    expect(priceScaleFor(1000, 1)).toBe(1000);
    expect(priceScaleFor(500, 1)).toBe(500);
    expect(priceScaleFor(500, 1000)).toBeNull();
  });
});

describe('rescalePrice', () => {
  it('$25.000 por kg pasa a $25 por g, y vuelve', () => {
    expect(rescalePrice(25000, 1000, 1)).toBe(25);
    expect(rescalePrice(25, 1, 1000)).toBe(25000);
  });

  it('misma escala o precio vacío no cambian', () => {
    expect(rescalePrice(25000, 1000, 1000)).toBe(25000);
    expect(rescalePrice(0, 1000, 1)).toBe(0);
  });
});

describe('cambio de unidad de stock (PR #1062 ronda 3, H2)', () => {
  it('stock g → kg con principal g a $25: la principal pasa a kg y el precio a $25.000 por factores absolutos', () => {
    const absFactor: Record<number, number> = { [G]: 1, [LB]: 500, [KG]: 1000 };
    // Stock nuevo kg: g y lb (menores) se podan; la escala vuelve a 1.
    const kept = [KG];
    const next = pickDefaultPrincipal(kept, null, 1, (id) =>
      priceScaleFor(absFactor[id], 1000),
    );
    expect(next).toBe(KG);
    // La escala relativa no ve el cambio (1 → 1) y dejaba $25 por kg.
    expect(rescalePrice(25, 1, 1)).toBe(25);
    // Entre factores absolutos (g = 1 → kg = 1000) se conserva el precio real.
    expect(rescalePrice(25, absFactor[G], absFactor[next as number])).toBe(25000);
  });
});

describe('rescalePriceAnchored (PR #1062 ronda 4, punto 1)', () => {
  it('kg → g → kg con $25.000/kg con IVA (base 21.008,40) vuelve al precio original', () => {
    // kg → g: la base por gramo se redondea a centavos (Decimal(12,2)).
    const toGram = rescalePriceAnchored(21008.4, 1000, 1, null);
    expect(toGram.value).toBe(21.01);
    expect(toGram.anchor).toEqual({ value: 21008.4, scale: 1000 });
    // g → kg: se deriva del ancla, no del 21,01 ya redondeado (daba 21.010).
    const back = rescalePriceAnchored(toGram.value, 1, 1000, toGram.anchor);
    expect(back.value).toBe(21008.4);
    // Con IVA 19 %: 21.008,40 × 1,19 = $25.000 por kg, igual que al inicio.
    expect(Math.round(back.value * 1.19 * 100) / 100).toBe(25000);
  });

  it('si el precio se editó a mano, el ancla vieja se descarta', () => {
    const edited = rescalePriceAnchored(30, 1, 1000, { value: 21008.4, scale: 1000 });
    expect(edited.value).toBe(30000);
    expect(edited.anchor).toEqual({ value: 30, scale: 1 });
  });

  it('kg → lb pasando por g sigue derivando del ancla original', () => {
    const g = rescalePriceAnchored(21008.4, 1000, 1, null);
    const lb = rescalePriceAnchored(g.value, 1, 500, g.anchor);
    expect(lb.value).toBe(10504.2);
  });
});

describe('rescaleTierOverrides (PR #1062 ronda 5, H2)', () => {
  const row = (
    id: number,
    kind: 'customer_tier' | 'sale_unit',
    override_price: number | null,
    enabled = true,
  ) => ({ tier: { id, kind }, enabled, override_price });

  it('Mayorista a $22.000/kg pasa a $22/g al cambiar la principal kg → g', () => {
    const rows = [row(1, 'customer_tier', 22000)];
    const out = rescaleTierOverrides(rows, 1000, 1, null);
    expect(out.rows[0].override_price).toBe(22);
    expect(out.changed).toBe(1);
    // 300 g con Mayorista: $6.600, no $6.600.000.
    expect(300 * out.rows[0].override_price!).toBe(6600);
  });

  it('kg → g → kg vuelve al precio original por el ancla de cada tarifa', () => {
    const first = rescaleTierOverrides([row(1, 'customer_tier', 21008.4)], 1000, 1, null);
    expect(first.rows[0].override_price).toBe(21.01);
    const back = rescaleTierOverrides(first.rows, 1, 1000, first.anchors);
    expect(back.rows[0].override_price).toBe(21008.4);
  });

  it('presentaciones, tarifas por porcentaje y deshabilitadas no se tocan', () => {
    const rows = [
      row(2, 'sale_unit', 60000),
      row(3, 'customer_tier', null),
      row(4, 'customer_tier', 22000, false),
    ];
    const out = rescaleTierOverrides(rows, 1000, 1, null);
    expect(out.rows).toEqual(rows);
    expect(out.changed).toBe(0);
    expect(countRescalableTierOverrides(rows)).toBe(0);
  });
});

describe('countFixedPerUnitTierRules (PR #1062 ronda 6, L2)', () => {
  const row = (
    tier: Record<string, unknown>,
    override_price: number | null = null,
    enabled = true,
  ) => ({
    tier: { kind: 'customer_tier', ...tier },
    enabled,
    override_price,
  });
  const discount = {
    adjustment_type: 'fixed_amount_discount',
    adjustment_value: '2000',
    amount_scope: 'per_unit',
  };

  it('el descuento fijo por unidad cambia de significado al pasar de kg a g', () => {
    // −$2.000 sobre $25.000/kg = $23.000/kg; sobre $25/g queda en $0.
    expect(applyTierAdjustment(25000, 1, discount)).toBe(23000);
    expect(applyTierAdjustment(25, 1, discount)).toBe(0);
    expect(countFixedPerUnitTierRules([row(discount)])).toBe(1);
  });

  it('cuenta precio fijo y recargo fijo por unidad', () => {
    expect(
      countFixedPerUnitTierRules([
        row({ adjustment_type: 'fixed_price', adjustment_value: 20000 }),
        row({ adjustment_type: 'fixed_amount_surcharge', adjustment_value: 500 }),
      ]),
    ).toBe(2);
  });

  it('no cuenta porcentajes, montos por paquete, overrides, deshabilitadas ni presentaciones', () => {
    expect(
      countFixedPerUnitTierRules([
        row({ adjustment_type: 'percent_discount', discount_percentage: 10 }),
        row({ ...discount, amount_scope: 'per_package' }),
        row(discount, 22000),
        row(discount, null, false),
        { tier: { kind: 'sale_unit', ...discount }, enabled: true, override_price: null },
      ]),
    ).toBe(0);
  });
});
