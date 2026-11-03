import {
  pickDefaultPrincipal,
  priceScaleFor,
  rescalePrice,
} from './sale-uom-principal.util';

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
