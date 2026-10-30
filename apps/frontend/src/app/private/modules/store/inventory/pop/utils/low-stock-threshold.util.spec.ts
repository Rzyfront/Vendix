import {
  popLineAvailableStock,
  popLineHasStockData,
  resolvePopLowStockThreshold,
} from './low-stock-threshold.util';

describe('low-stock-threshold.util (QUI-861)', () => {
  it('reorder_point gana sobre min_stock_level', () => {
    expect(
      resolvePopLowStockThreshold(
        { reorder_point: 7, min_stock_level: 3 } as any,
        10,
      ),
    ).toEqual({ threshold: 7, fromProduct: true });
  });

  it('min_stock_level propio gana sobre API y tienda', () => {
    expect(
      resolvePopLowStockThreshold(
        { min_stock_level: 3, low_stock_threshold: 8 } as any,
        10,
      ),
    ).toEqual({ threshold: 3, fromProduct: true });
  });

  it('cero y negativos no cuentan como mínimo propio', () => {
    expect(
      resolvePopLowStockThreshold({ min_stock_level: 0 } as any, 10),
    ).toEqual({ threshold: 10, fromProduct: false });
  });

  it('sin mínimo propio usa el resuelto por API y luego tienda', () => {
    expect(
      resolvePopLowStockThreshold({ low_stock_threshold: 8 } as any, 10),
    ).toEqual({ threshold: 8, fromProduct: false });
    expect(resolvePopLowStockThreshold({} as any, 10)).toEqual({
      threshold: 10,
      fromProduct: false,
    });
    expect(resolvePopLowStockThreshold(null, 10)).toEqual({
      threshold: 10,
      fromProduct: false,
    });
  });

  it('stock actual: variante gana a base; stock_quantity gana a stock', () => {
    expect(
      popLineAvailableStock({
        product: { stock_quantity: 17 },
        variant: { stock_quantity: 4 },
      } as any),
    ).toBe(4);
    expect(
      popLineAvailableStock(
        { product: { stock_quantity: 9, stock: 3 } } as any,
      ),
    ).toBe(9);
    expect(popLineAvailableStock({ product: {} } as any)).toBe(0);
    expect(popLineAvailableStock(null)).toBe(0);
  });

  it('gate: oculta sin tracking o en borrador restaurado (stock:0 placeholder)', () => {
    expect(
      popLineHasStockData({ product: { stock_quantity: 17 } } as any),
    ).toBe(true);
    // Sin tracking: la cifra no significa nada (el catálogo dice "Disponible").
    expect(
      popLineHasStockData(
        { product: { stock_quantity: 17, track_inventory: false } } as any,
      ),
    ).toBe(false);
    // Borrador restaurado: pop-cart.service reconstruye con stock:0 y sin
    // stock_quantity — mostrarlo sería un "Stock bajo" inventado.
    expect(
      popLineHasStockData({ product: { stock: 0 } } as any),
    ).toBe(false);
    expect(popLineHasStockData(null)).toBe(false);
  });
});
