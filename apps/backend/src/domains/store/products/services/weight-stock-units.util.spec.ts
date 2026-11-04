import {
  convertWeightToStockUnits,
  packagingStockUnits,
  resolveCommittedStockUnits,
  resolveWeightLineStockUnits,
  resolveWeightLinesStockUnits,
  WeightUomFactor,
} from './weight-stock-units.util';

const KG: WeightUomFactor = { code: 'kg', dimension: 'mass', factor_to_base: '1000' };
const G: WeightUomFactor = { code: 'g', dimension: 'mass', factor_to_base: '1' };
const LB: WeightUomFactor = { code: 'lb', dimension: 'mass', factor_to_base: '453.59237' };
const M: WeightUomFactor = { code: 'm', dimension: 'length', factor_to_base: '1000' };

const weighed = (weight: number | string, extra: Record<string, unknown> = {}) => ({
  product_id: 7,
  weight,
  weight_unit: 'kg',
  ...extra,
});

describe('convertWeightToStockUnits', () => {
  it('0,180 kg con stock en g ⇒ 180', () => {
    expect(convertWeightToStockUnits(0.18, 1000, 1)).toEqual({ units: 180, floored: false });
  });

  it('0,9995 kg con stock en g ⇒ 1000 (sin error de coma flotante)', () => {
    expect(convertWeightToStockUnits(0.9995, 1000, 1)?.units).toBe(1000);
  });

  it('peso máximo 999 kg con stock en g ⇒ 999 000', () => {
    expect(convertWeightToStockUnits(999, 1000, 1)?.units).toBe(999000);
  });

  it('1 lb con stock en g ⇒ 454', () => {
    expect(convertWeightToStockUnits(1, 453.59237, 1)?.units).toBe(454);
  });

  it.each([
    [0.18, 1, true],
    [0.4, 1, true],
    [0.5, 1, false],
  ])('stock en kg: %s kg ⇒ %s (nunca 0, floored=%s)', (weight, units, floored) => {
    expect(convertWeightToStockUnits(weight, 1000, 1000)).toEqual({ units, floored });
  });

  it('stock en kg: 2,5 kg ⇒ 3 (redondeo al entero más cercano)', () => {
    expect(convertWeightToStockUnits(2.5, 1000, 1000)?.units).toBe(3);
  });

  it('0 g no es una pesada: no convierte', () => {
    expect(convertWeightToStockUnits(0, 1, 1)).toBeNull();
  });
});

describe('resolveWeightLineStockUnits', () => {
  it('el servidor manda: si el cliente envía 0 en una pesada, persiste lo calculado (≥ 1)', () => {
    const result = resolveWeightLineStockUnits(
      weighed(0.18, { stock_units_consumed: 0 }),
      KG,
      KG,
    );
    expect(result.units).toBe(1);
    expect(result.source).toBe('floored');
    expect(result.client_mismatch).toBe(0);
  });

  it('el cliente con decimal no se descarta en silencio: queda como discrepancia', () => {
    const result = resolveWeightLineStockUnits(
      weighed(0.18, { stock_units_consumed: 179.6 }),
      G,
      KG,
    );
    expect(result.units).toBe(180);
    expect(result.client_mismatch).toBe(179.6);
  });

  it('cliente que coincide: sin discrepancia', () => {
    const result = resolveWeightLineStockUnits(
      weighed(0.18, { stock_units_consumed: 180 }),
      G,
      KG,
    );
    expect(result).toEqual({ units: 180, source: 'computed' });
  });

  it('producto de peso SIN stock_uom: null (histórico, 1 por pesada), aunque el cliente mande un número', () => {
    expect(
      resolveWeightLineStockUnits(weighed(0.18, { stock_units_consumed: 180 }), null, KG),
    ).toEqual({ units: null, source: 'no_stock_uom' });
  });

  it('0 g / línea sin peso: no aplica', () => {
    expect(resolveWeightLineStockUnits(weighed(0), G, G).source).toBe('not_weight');
  });

  it('unidad pesada desconocida o de otra dimensión: usa el cliente como legado si es entero ≥ 1', () => {
    expect(
      resolveWeightLineStockUnits(weighed(0.18, { stock_units_consumed: 180 }), G, M),
    ).toEqual({ units: 180, source: 'client_legacy' });
    expect(
      resolveWeightLineStockUnits(weighed(0.18, { stock_units_consumed: 0 }), G, undefined).units,
    ).toBeNull();
  });
});

describe('resolveWeightLinesStockUnits (lote)', () => {
  const client = {
    products: {
      findMany: jest.fn().mockResolvedValue([
        { id: 7, stock_uom: G },
        { id: 8, stock_uom: KG },
        { id: 9, stock_uom: null },
      ]),
    },
    units_of_measure: { findMany: jest.fn().mockResolvedValue([KG, G, LB]) },
  };

  it('alinea por índice, convierte cada línea con la unidad de stock de SU producto y avisa del piso', async () => {
    const logger = { warn: jest.fn() };
    const units = await resolveWeightLinesStockUnits(
      client,
      [
        { product_id: 7, weight: 0.18, weight_unit: 'kg' },
        { product_id: 8, weight: 0.18, weight_unit: 'KG' },
        { product_id: 9, weight: 0.18, weight_unit: 'kg' },
        { product_id: 7, quantity: 3 } as never,
        { product_id: 7, weight: '1', weight_unit: 'lb', stock_units_consumed: 999 },
      ],
      logger,
    );
    expect(units).toEqual([180, 1, null, null, 454]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('se descuenta 1'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('stock_units_consumed=999'));
  });

  it('sin líneas de peso no consulta nada', async () => {
    client.products.findMany.mockClear();
    await expect(resolveWeightLinesStockUnits(client, [{ product_id: 1 }])).resolves.toEqual([null]);
    expect(client.products.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveCommittedStockUnits', () => {
  it('misma fórmula que el commit de inventario', () => {
    expect(resolveCommittedStockUnits({ quantity: 1, stock_units_consumed: 180 })).toBe(180);
    expect(resolveCommittedStockUnits({ quantity: 2, stock_units_consumed: null })).toBe(2);
  });
});

describe('packagingStockUnits', () => {
  it('una pesada no es empaque', () => {
    expect(packagingStockUnits({ weight: '0.180', stock_units_consumed: 180 })).toBeNull();
  });

  it('una presentación sí', () => {
    expect(packagingStockUnits({ weight: null, stock_units_consumed: 50 })).toBe(50);
  });
});
