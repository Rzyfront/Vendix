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
const factors: Record<number, number> = { [G]: 1, [LB]: 453.59237, [KG]: 1000 };
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
  it('kg sobre g es 1000; lb no es entero de g y no da escala', () => {
    expect(priceScaleFor(1000, 1)).toBe(1000);
    expect(priceScaleFor(453.59237, 1)).toBeNull();
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
