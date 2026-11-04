import {
  resolveReturnStockUnits,
  ReturnStockAllocator,
} from './return-stock-units.util';

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

  it('pesadas desiguales (180 g + 320 g): devolver ambas reingresa 500; una sola, la menor (180), nunca el promedio', () => {
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
    ).toBe(180);
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

  it('línea vendida con consumido = 0 reingresa 0 (lo que salió), no 1', () => {
    expect(
      resolveReturnStockUnits(
        { product_id: 7, product_variant_id: null, quantity: 1 },
        [{ ...weightLine, stock_units_consumed: 0 }],
      ),
    ).toBe(0);
  });
});

describe('ReturnStockAllocator — líneas mezcladas y devoluciones repetidas', () => {
  const bundle = { id: 1, product_id: 9, product_variant_id: null, quantity: 1, stock_units_consumed: 50 };
  const loose = { id: 2, product_id: 9, product_variant_id: null, quantity: 3, stock_units_consumed: null };
  const ret = (quantity: number, order_item_id?: number) => ({
    product_id: 9,
    product_variant_id: null,
    quantity,
    order_item_id,
  });

  it('1 bulto de 50 + 3 sueltas: devolver las 3 sueltas reingresa 3 (no 40)', () => {
    const allocator = new ReturnStockAllocator([bundle, loose]);
    expect(allocator.take(ret(3))).toEqual({ units: 3, ambiguous: true });
  });

  it('con order_item_id se toma la línea exacta: el bulto reingresa 50 (no 13)', () => {
    const allocator = new ReturnStockAllocator([bundle, loose]);
    expect(allocator.take(ret(1, 1))).toEqual({ units: 50, ambiguous: false });
    expect(allocator.take(ret(3, 2))).toEqual({ units: 3, ambiguous: false });
  });

  it('devolver todo lo que queda es exacto aunque las líneas sean distintas: 4 ⇒ 53', () => {
    expect(new ReturnStockAllocator([bundle, loose]).take(ret(4))).toEqual({
      units: 53,
      ambiguous: false,
    });
  });

  it('pesadas de 0,180 y 2,000 kg (stock en g): devolver una no reingresa 1 090', () => {
    const allocator = new ReturnStockAllocator([
      { id: 1, product_id: 7, product_variant_id: null, quantity: 1, stock_units_consumed: 180, weight: '0.180' },
      { id: 2, product_id: 7, product_variant_id: null, quantity: 1, stock_units_consumed: 2000, weight: '2.000' },
    ]);
    expect(allocator.take({ product_id: 7, product_variant_id: null, quantity: 1 })).toEqual({
      units: 180,
      ambiguous: true,
    });
    // La segunda devolución ya solo puede ser la de 2 kg.
    expect(allocator.take({ product_id: 7, product_variant_id: null, quantity: 1 })).toEqual({
      units: 2000,
      ambiguous: false,
    });
  });

  it('presentación homogénea, devolución parcial repetida: 4 bultos de 50 ⇒ 2 + 2 = 100 + 100, y no más', () => {
    const allocator = new ReturnStockAllocator([
      { id: 1, product_id: 9, product_variant_id: 2, quantity: 4, stock_units_consumed: 200 },
    ]);
    const twoBundles = { product_id: 9, product_variant_id: 2, quantity: 2 };
    expect(allocator.take(twoBundles)).toEqual({ units: 100, ambiguous: false });
    expect(allocator.take(twoBundles)).toEqual({ units: 100, ambiguous: false });
    // Ya se devolvió todo: una tercera no reingresa nada.
    expect(allocator.take({ ...twoBundles, quantity: 1 })).toEqual({
      units: 0,
      ambiguous: false,
      exhausted: true,
    });
  });

  it('pesada parcial ya devuelta: la devolución repetida de la misma línea no duplica', () => {
    const allocator = new ReturnStockAllocator([
      { id: 1, product_id: 7, product_variant_id: null, quantity: 1, stock_units_consumed: 180, weight: 0.18 },
    ]);
    expect(allocator.take({ product_id: 7, product_variant_id: null, quantity: 1 }).units).toBe(180);
    expect(allocator.take({ product_id: 7, product_variant_id: null, quantity: 1 })).toEqual({
      units: 0,
      ambiguous: false,
      exhausted: true,
    });
  });
});
