import { resolveReturnStockUnits } from './return-stock-units.util';

describe('resolveReturnStockUnits', () => {
  const weightLine = {
    product_id: 7,
    product_variant_id: null,
    quantity: 1,
    stock_units_consumed: 180,
  };

  it('devolver la línea de 0,180 kg reingresa 180 (lo que descontó la venta), no 1', () => {
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: null, quantity: 1 },
        [weightLine],
      ),
    ).toBe(180);
  });

  it('línea sin snapshot reingresa su cantidad (histórico)', () => {
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: null, quantity: 3 },
        [{ ...weightLine, quantity: 5, stock_units_consumed: null }],
      ),
    ).toBe(3);
  });

  it('presentación: devolución parcial reparte en proporción (2 de 4 bultos de 50)', () => {
    expect(
      resolveReturnStockUnits(
        { product_id: 9, product_variant_id: 2, quantity: 2 },
        [
          {
            product_id: 9,
            product_variant_id: 2,
            quantity: 4,
            stock_units_consumed: 200,
          },
        ],
      ),
    ).toBe(100);
  });

  it('agrega varias pesadas del mismo producto (dos líneas: 180 g + 320 g)', () => {
    const sold = [weightLine, { ...weightLine, stock_units_consumed: 320 }];
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: null, quantity: 2 },
        sold,
      ),
    ).toBe(500);
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: null, quantity: 1 },
        sold,
      ),
    ).toBe(250);
  });

  it('no mezcla variantes ni productos distintos', () => {
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: 3, quantity: 1 },
        [weightLine],
      ),
    ).toBe(1);
    expect(
      resolveReturnStockUnits(
        { product_id: 8, product_variant_id: null, quantity: 1 },
        [weightLine],
      ),
    ).toBe(1);
  });

  it('sin orden de venta (lista vacía) reingresa la cantidad', () => {
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: null, quantity: 4 },
        [],
      ),
    ).toBe(4);
  });
});
