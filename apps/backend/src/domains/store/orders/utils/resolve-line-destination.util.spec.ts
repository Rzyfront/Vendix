import {
  lineConsumesOwnStock,
  resolveLineDestination,
  ResolveLineDestinationInput,
} from './resolve-line-destination.util';

const base = {
  product_type: 'prepared',
  is_batch_produced: false,
  track_inventory: true,
  has_active_recipe: true,
};

const run = (over: Partial<ResolveLineDestinationInput> & { p?: Partial<typeof base> }) =>
  resolveLineDestination({
    isRestaurant: true,
    product: { ...base, ...(over.p ?? {}) },
    availableStock: 10,
    isScheduled: false,
    ...over,
  });

describe.each([false, true])('resolveLineDestination (isScheduled=%s)', (isScheduled) => {
  it('producible with stock defaults to stock and is choosable', () => {
    expect(run({ isScheduled, p: { is_batch_produced: true } })).toEqual({
      destination: 'stock',
      skip_kds: true,
      choosable: true,
    });
  });

  it('producible with stock honors the cashier choice of production', () => {
    expect(
      run({ isScheduled, requested: 'production', p: { is_batch_produced: true } }),
    ).toEqual({ destination: 'production', skip_kds: true, choosable: true });
  });

  it('producible with stock never honors a kds request', () => {
    expect(run({ isScheduled, requested: 'kds', p: { is_batch_produced: true } }).destination).toBe(
      'stock',
    );
  });

  it('producible without stock goes to production and ignores the request', () => {
    expect(
      run({ isScheduled, availableStock: 0, requested: 'stock', p: { is_batch_produced: true } }),
    ).toEqual({ destination: 'production', skip_kds: true, choosable: false });
  });

  it('producible with less stock than the line quantity goes to production', () => {
    expect(
      run({ isScheduled, availableStock: 2, quantity: 3, p: { is_batch_produced: true } })
        .destination,
    ).toBe('production');
  });

  it('producible without inventory tracking goes to production', () => {
    expect(
      run({ isScheduled, p: { is_batch_produced: true, track_inventory: false } }),
    ).toEqual({ destination: 'production', skip_kds: true, choosable: false });
  });

  it('batch-produced without active recipe is not producible: prepared goes to kds', () => {
    expect(run({ isScheduled, p: { is_batch_produced: true, has_active_recipe: false } })).toEqual({
      destination: 'kds',
      skip_kds: false,
      choosable: false,
    });
  });

  it('prepared not producible goes to kds and ignores skip_kds and the request', () => {
    expect(run({ isScheduled, requested: 'stock', clientSkipKds: true })).toEqual({
      destination: 'kds',
      skip_kds: false,
      choosable: false,
    });
  });

  it('other product with stock leaves the stock', () => {
    expect(run({ isScheduled, p: { product_type: 'physical' } })).toEqual({
      destination: 'stock',
      skip_kds: true,
      choosable: false,
    });
  });

  it('other product without stock stays stock (the no-overselling guard blocks later)', () => {
    expect(run({ isScheduled, availableStock: 0, p: { product_type: 'physical' } }).destination).toBe(
      'stock',
    );
  });

  it('other product without inventory only records the sale', () => {
    expect(
      run({ isScheduled, p: { product_type: 'physical', track_inventory: false } }).destination,
    ).toBe('stock');
  });

  it('a requested production is ignored for non producible products', () => {
    expect(run({ isScheduled, requested: 'production', p: { product_type: 'physical' } }).destination).toBe(
      'stock',
    );
  });
});

describe('resolveLineDestination outside the matrix', () => {
  it('non-restaurant stores keep the client skip_kds and no destination', () => {
    expect(run({ isRestaurant: false, clientSkipKds: true, p: { is_batch_produced: true } })).toEqual({
      destination: null,
      skip_kds: true,
      choosable: false,
    });
    expect(run({ isRestaurant: false, p: { is_batch_produced: true } }).skip_kds).toBe(false);
  });

  it('custom lines (no product) keep the client skip_kds', () => {
    expect(
      resolveLineDestination({
        isRestaurant: true,
        product: null,
        availableStock: 0,
        isScheduled: false,
        clientSkipKds: true,
      }),
    ).toEqual({ destination: null, skip_kds: true, choosable: false });
  });

  it('service products have no matrix decision', () => {
    expect(run({ p: { product_type: 'service' }, clientSkipKds: false }).destination).toBeNull();
  });
});

describe('lineConsumesOwnStock', () => {
  it('excludes only production lines', () => {
    expect(lineConsumesOwnStock({ fulfillment_destination: 'production' })).toBe(false);
    expect(lineConsumesOwnStock({ fulfillment_destination: 'stock' })).toBe(true);
    expect(lineConsumesOwnStock({ fulfillment_destination: 'kds' })).toBe(true);
    expect(lineConsumesOwnStock({ fulfillment_destination: null })).toBe(true);
    expect(lineConsumesOwnStock({})).toBe(true);
  });
});
