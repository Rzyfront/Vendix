import {
  isContinuousStockUom,
  resolvePurchaseUomFactor,
} from './purchase-uom-factor.util';

const G = { code: 'g', dimension: 'mass', factor_to_base: '1.000000' };
const KG = { code: 'kg', dimension: 'mass', factor_to_base: '1000.000000' };
const ML = { code: 'ml', dimension: 'volume', factor_to_base: '1' };
const L = { code: 'l', dimension: 'volume', factor_to_base: '1000' };
const UNIT = { code: 'unit', dimension: 'count', factor_to_base: '1' };
const BOX = { code: 'caja', dimension: 'count', factor_to_base: '12' };

describe('resolvePurchaseUomFactor (QUI-1017)', () => {
  it('stock en g sin unidad de compra ⇒ bloqueado, nombrando el producto', () => {
    const r = resolvePurchaseUomFactor({
      name: 'Carne molida',
      stock_uom: G,
      purchase_uom: null,
      purchase_to_stock_factor: null,
    });
    expect(r).toEqual({
      kind: 'blocked',
      reason: 'missing_purchase_uom',
      message: expect.stringContaining('"Carne molida"'),
    });
    expect((r as { message: string }).message).toContain('unidad de compra');
  });

  it('no insumo kg → g ⇒ factor 1000 del catálogo aunque el guardado esté vacío', () => {
    expect(
      resolvePurchaseUomFactor({
        name: 'Lomo',
        stock_uom: G,
        purchase_uom: KG,
        purchase_to_stock_factor: null,
      }),
    ).toEqual({ kind: 'ok', factor: 1000 });
  });

  it('el catálogo gana sobre un factor guardado incoherente (kg → g guardado en 1)', () => {
    expect(
      resolvePurchaseUomFactor({
        stock_uom: G,
        purchase_uom: KG,
        purchase_to_stock_factor: 1,
      }),
    ).toEqual({ kind: 'ok', factor: 1000 });
  });

  it('l → ml ⇒ 1000; misma unidad ⇒ 1', () => {
    expect(
      resolvePurchaseUomFactor({ stock_uom: ML, purchase_uom: L }),
    ).toEqual({ kind: 'ok', factor: 1000 });
    expect(
      resolvePurchaseUomFactor({ stock_uom: KG, purchase_uom: KG }),
    ).toEqual({ kind: 'ok', factor: 1 });
  });

  it('compra en g con stock en kg ⇒ bloqueado (no hay conversión entera)', () => {
    expect(
      resolvePurchaseUomFactor({ name: 'Queso', stock_uom: KG, purchase_uom: G }),
    ).toMatchObject({ kind: 'blocked', reason: 'unresolvable_factor' });
  });

  it('envase → contenido usa el factor manual; sin él ⇒ bloqueado', () => {
    expect(
      resolvePurchaseUomFactor({
        stock_uom: G,
        purchase_uom: UNIT,
        purchase_to_stock_factor: 250,
      }),
    ).toEqual({ kind: 'ok', factor: 250 });
    expect(
      resolvePurchaseUomFactor({
        name: 'Café',
        stock_uom: G,
        purchase_uom: UNIT,
        purchase_to_stock_factor: null,
      }),
    ).toMatchObject({ kind: 'blocked', reason: 'unresolvable_factor' });
  });

  it('masa ↔ volumen ⇒ bloqueado', () => {
    expect(
      resolvePurchaseUomFactor({ stock_uom: ML, purchase_uom: KG }),
    ).toMatchObject({ kind: 'blocked', reason: 'unresolvable_factor' });
  });

  it('stock por unidad, sin stock declarado o sin producto ⇒ no aplica (histórico)', () => {
    expect(
      resolvePurchaseUomFactor({ stock_uom: UNIT, purchase_uom: BOX }),
    ).toEqual({ kind: 'not_applicable' });
    expect(
      resolvePurchaseUomFactor({ stock_uom: UNIT, purchase_uom: null }),
    ).toEqual({ kind: 'not_applicable' });
    expect(resolvePurchaseUomFactor({ stock_uom: null })).toEqual({
      kind: 'not_applicable',
    });
    expect(resolvePurchaseUomFactor(null)).toEqual({ kind: 'not_applicable' });
  });

  it('isContinuousStockUom solo para masa y volumen', () => {
    expect(isContinuousStockUom(G)).toBe(true);
    expect(isContinuousStockUom(L)).toBe(true);
    expect(isContinuousStockUom(UNIT)).toBe(false);
    expect(isContinuousStockUom(null)).toBe(false);
  });
});
