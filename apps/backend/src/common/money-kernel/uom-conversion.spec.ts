import {
  UomRef,
  chargeForAmount,
  convertAmount,
  integerRatio,
  minSellableAmount,
  pricingTypeFor,
  toStockUnits,
  validateProductUoms,
} from './uom-conversion';

// Filas del catálogo `units_of_measure` (migraciones 20260615182141 y
// 20260811100100): mismos códigos, dimensiones y factores.
const u = (
  id: number,
  code: string,
  dimension: string,
  factor: number | string,
): UomRef => ({ id, code, name: code, dimension, factor_to_base: factor });

const g = u(1, 'g', 'mass', '1.000000');
const kg = u(3, 'kg', 'mass', '1000.000000');
const lb = u(7, 'lb', 'mass', '500.000000');
const arroba = u(8, 'arroba', 'mass', '12500.000000');
const ml = u(4, 'ml', 'volume', 1);
const L = u(5, 'L', 'volume', 1000);
const gal = u(12, 'gal', 'volume', 3785.411784);
const mm = u(13, 'mm', 'length', 1);
const cm = u(14, 'cm', 'length', 10);
const m = u(15, 'm', 'length', 1000);
const unit = u(6, 'unit', 'count', 1);
const doc = u(20, 'doc', 'count', 12);

describe('uom-conversion — matriz de conversión (S11)', () => {
  // [cantidad, unidad vendida, unidad de inventario, unidades descontadas]
  const stockCases: Array<[number, UomRef, UomRef, number]> = [
    [0.245, kg, g, 245],
    [1, kg, g, 1000],
    [0.9995, kg, g, 1000], // error binario: 999,4999… debe dar 1000
    [1, lb, g, 500],
    [2.5, lb, g, 1250],
    [1, arroba, g, 12500],
    [0.5, L, ml, 500],
    [1.25, m, mm, 1250],
    [3, cm, mm, 30],
    [2, doc, unit, 24],
    [7, unit, unit, 7],
  ];
  it.each(stockCases)(
    '%p %s descuenta las unidades exactas de %s',
    (amount, from, stock, expected) => {
      expect(toStockUnits(amount, from, stock)).toBe(expected);
    },
  );

  it('una venta menor a media unidad de inventario descuenta 0 (el llamador decide)', () => {
    expect(toStockUnits(0.245, kg, kg)).toBe(0);
    expect(minSellableAmount(kg, kg)).toBe(1);
    expect(minSellableAmount(kg, g)).toBe(0.001);
  });

  it('no convierte entre dimensiones distintas', () => {
    expect(toStockUnits(1, kg, ml)).toBeNull();
    expect(convertAmount(1, L, g)).toBeNull();
  });

  // [precio por principal, cantidad, unidad vendida, principal, cobrado]
  const chargeCases: Array<[number, number, UomRef, UomRef, number]> = [
    [24000, 0.245, kg, kg, 5880],
    [24000, 245, g, kg, 5880],
    [24000, 1, lb, kg, 12000],
    [24000, 1, arroba, kg, 300000],
    [12000, 1, kg, lb, 24000],
    [3500, 250, ml, L, 875],
    [8000, 35, cm, m, 2800],
    [15000, 1, doc, doc, 15000],
    [1500, 3, unit, doc, 375],
  ];
  it.each(chargeCases)(
    'precio %p por principal × %p %s (principal %s) cobra %p',
    (price, amount, from, principal, expected) => {
      expect(chargeForAmount(price, amount, from, principal)).toBe(expected);
    },
  );

  it('la escala de precio es entera o no existe', () => {
    expect(integerRatio(kg, g)).toBe(1000);
    expect(integerRatio(lb, g)).toBe(500);
    expect(integerRatio(lb, kg)).toBeNull(); // 0,5 kg
    expect(integerRatio(g, kg)).toBeNull(); // menor que el inventario
    expect(integerRatio(gal, ml)).toBeNull(); // 3785,41 ml
    expect(integerRatio(doc, unit)).toBe(12);
  });

  it('pricing_type se deriva de la dimensión de la principal', () => {
    expect(pricingTypeFor(kg)).toBe('weight');
    expect(pricingTypeFor(lb)).toBe('weight');
    expect(pricingTypeFor(L)).toBe('unit');
    expect(pricingTypeFor(doc)).toBe('unit');
    expect(pricingTypeFor(null)).toBe('unit');
  });
});

describe('uom-conversion — validateProductUoms (S5, S10)', () => {
  const codes = (cfg: Parameters<typeof validateProductUoms>[0]) =>
    validateProductUoms(cfg).map((v) => v.code);

  it('acepta la configuración canónica: principal kg, también g y lb, inventario g', () => {
    expect(
      codes({ stock: g, principal: kg, additional: [g, lb], pricing_type: 'weight' }),
    ).toEqual([]);
  });

  it('producto sin unidades de venta (pieza o legado de peso) no se valida', () => {
    expect(codes({ stock: null, principal: null })).toEqual([]);
    expect(codes({ stock: kg, principal: null, pricing_type: 'weight' })).toEqual([]);
  });

  it('S5(b) LOMO AHUMADO: inventario kg con principal kg se rechaza', () => {
    const violations = validateProductUoms({ stock: kg, principal: kg });
    expect(violations.map((v) => v.code)).toEqual(['MEASURED_STOCK_NOT_BASE']);
    expect(violations[0].message).toContain('debe contarse en g');
    expect(codes({ stock: kg, principal: kg, additional: [g] })).toEqual([
      'SMALLER_THAN_STOCK',
      'MEASURED_STOCK_NOT_BASE',
    ]);
  });

  it('principal medible con inventario en la base es válido para volumen y longitud', () => {
    expect(codes({ stock: ml, principal: L, additional: [ml] })).toEqual([]);
    expect(codes({ stock: mm, principal: m, additional: [cm] })).toEqual([]);
    expect(codes({ stock: cm, principal: m })).toEqual(['MEASURED_STOCK_NOT_BASE']);
  });

  it('conteo admite inventario en unidades y venta por docena', () => {
    expect(codes({ stock: unit, principal: unit, additional: [doc] })).toEqual([]);
  });

  it('exige unidad de inventario cuando hay unidades de venta', () => {
    expect(codes({ stock: null, principal: kg })).toEqual(['STOCK_REQUIRED']);
  });

  it('rechaza unidades de otra dimensión, repetidas o no enteras', () => {
    expect(codes({ stock: g, principal: kg, additional: [L] })).toEqual([
      'DIMENSION_MISMATCH',
    ]);
    expect(codes({ stock: g, principal: kg, additional: [kg] })).toEqual([
      'DUPLICATE_SALE_UNIT',
    ]);
    expect(codes({ stock: ml, principal: L, additional: [gal] })).toEqual([
      'NOT_INTEGER_MULTIPLE',
    ]);
  });

  it('pricing_type debe corresponder a la principal cuando viene', () => {
    expect(codes({ stock: g, principal: kg, pricing_type: 'unit' })).toEqual([
      'PRICING_TYPE_MISMATCH',
    ]);
    expect(codes({ stock: ml, principal: L, pricing_type: 'weight' })).toEqual([
      'PRICING_TYPE_MISMATCH',
    ]);
  });

  it('la unidad de compra mide lo mismo y no es menor que el inventario', () => {
    expect(codes({ stock: g, principal: kg, purchase: arroba })).toEqual([]);
    expect(codes({ stock: kg, principal: null, purchase: g })).toEqual([
      'PURCHASE_SMALLER_THAN_STOCK',
    ]);
    expect(codes({ stock: g, principal: null, purchase: L })).toEqual([
      'PURCHASE_DIMENSION_MISMATCH',
    ]);
    // Envase: compra por unidad, inventario en ml, factor manual 750.
    expect(
      codes({ stock: ml, principal: null, purchase: unit, purchase_manual_factor: 750 }),
    ).toEqual([]);
  });
});
