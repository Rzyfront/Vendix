import { resolveLineDestinations } from './line-destination.loader';

const productRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  product_type: 'prepared',
  is_batch_produced: true,
  track_inventory: true,
  _count: { recipes: 1 },
  ...over,
});

const clientWith = (opts: {
  industries: string[];
  products?: any[];
  levels?: any[];
}) => ({
  stores: { findUnique: jest.fn().mockResolvedValue({ industries: opts.industries }) },
  products: { findMany: jest.fn().mockResolvedValue(opts.products ?? []) },
  stock_levels: { findMany: jest.fn().mockResolvedValue(opts.levels ?? []) },
});

describe('resolveLineDestinations', () => {
  it('non-restaurant store: all null and the catalog is never read', async () => {
    const client = clientWith({ industries: ['retail'] });
    const out = await resolveLineDestinations(client, 5, [{ product_id: 1, quantity: 1, skip_kds: true }]);
    expect(out).toEqual([null]);
    expect(client.products.findMany).not.toHaveBeenCalled();
    expect(client.stock_levels.findMany).not.toHaveBeenCalled();
  });

  it('S12: sin isRestaurant lee la industria una vez; con isRestaurant no la lee y resuelve igual', async () => {
    const lines = [{ product_id: 1, quantity: 1 }];
    const base = clientWith({
      industries: ['restaurant'],
      products: [productRow({ id: 1 })],
      levels: [{ product_id: 1, product_variant_id: null, quantity_available: 9 }],
    });
    const viaRead = await resolveLineDestinations(base, 5, lines);
    expect(base.stores.findUnique).toHaveBeenCalledTimes(1);

    const given = clientWith({
      industries: ['retail'], // ignorado: manda lo que pasó quien ya la leyó
      products: [productRow({ id: 1 })],
      levels: [{ product_id: 1, product_variant_id: null, quantity_available: 9 }],
    });
    const viaOpt = await resolveLineDestinations(given, 5, lines, { isRestaurant: true });
    expect(given.stores.findUnique).not.toHaveBeenCalled();
    expect(viaOpt).toEqual(viaRead);

    const retail = await resolveLineDestinations(given, 5, lines, { isRestaurant: false });
    expect(retail).toEqual([null]);
  });

  it('restaurant: one products query and one stock query for many lines (no N+1)', async () => {
    const client = clientWith({
      industries: ['restaurant'],
      products: [productRow({ id: 1 }), productRow({ id: 2, is_batch_produced: false })],
      levels: [{ product_id: 1, product_variant_id: null, quantity_available: 9 }],
    });
    const out = await resolveLineDestinations(client, 5, [
      { product_id: 1, quantity: 1 },
      { product_id: 2, quantity: 1 },
      { product_id: 1, quantity: 2 },
    ]);
    expect(client.products.findMany).toHaveBeenCalledTimes(1);
    expect(client.stock_levels.findMany).toHaveBeenCalledTimes(1);
    expect(out.map((o) => o?.destination)).toEqual(['stock', 'kds', 'stock']);
  });

  it('restaurant: honors the cashier choice only where choosable', async () => {
    const client = clientWith({
      industries: ['restaurant'],
      products: [productRow({ id: 1 }), productRow({ id: 2, is_batch_produced: false })],
      levels: [
        { product_id: 1, product_variant_id: null, quantity_available: 9 },
        { product_id: 2, product_variant_id: null, quantity_available: 9 },
      ],
    });
    const out = await resolveLineDestinations(client, 5, [
      { product_id: 1, quantity: 1, requested: 'production' },
      { product_id: 2, quantity: 1, requested: 'production' },
    ]);
    expect(out.map((o) => o?.destination)).toEqual(['production', 'kds']);
  });

  it('producible line without stock goes to production regardless of the request', async () => {
    const client = clientWith({ industries: ['restaurant'], products: [productRow()] });
    const out = await resolveLineDestinations(client, 5, [
      { product_id: 1, quantity: 1, requested: 'stock' },
    ]);
    expect(out[0]).toEqual({ destination: 'production', skip_kds: true, choosable: false });
  });

  it('a recipe-less producible product is not producible (kds)', async () => {
    const client = clientWith({
      industries: ['restaurant'],
      products: [productRow({ _count: { recipes: 0 } })],
      levels: [{ product_id: 1, product_variant_id: null, quantity_available: 9 }],
    });
    const out = await resolveLineDestinations(client, 5, [{ product_id: 1, quantity: 1 }]);
    expect(out[0]?.destination).toBe('kds');
  });

  it('edit: a legacy line (NULL destination) stays null; a line with destination keeps it; a new line resolves', async () => {
    const client = clientWith({
      industries: ['restaurant'],
      products: [productRow({ id: 1 }), productRow({ id: 2 }), productRow({ id: 3 })],
      levels: [1, 2, 3].map((id) => ({ product_id: id, product_variant_id: null, quantity_available: 9 })),
    });
    const previous = new Map<string, { fulfillment_destination?: string | null }>([
      ['1:null', { fulfillment_destination: null }],
      ['2:null', { fulfillment_destination: 'production' }],
    ]);
    const out = await resolveLineDestinations(
      client,
      5,
      [
        { product_id: 1, quantity: 1 },
        { product_id: 2, quantity: 1 },
        { product_id: 3, quantity: 1 },
      ],
      { previous },
    );
    expect(out[0]).toBeNull();
    expect(out[1]?.destination).toBe('production');
    expect(out[2]?.destination).toBe('stock');
  });

  describe('B2 — edit path counts the order own reservation as available', () => {
    const previous = new Map([['1:null', { fulfillment_destination: 'stock' }]]);
    const withReservations = (available: number, reserved: number) => ({
      ...clientWith({
        industries: ['restaurant'],
        products: [productRow({ id: 1 })],
        levels: available > 0 ? [{ product_id: 1, product_variant_id: null, quantity_available: available }] : [],
      }),
      stock_reservations: {
        findMany: jest
          .fn()
          .mockResolvedValue(reserved > 0 ? [{ product_id: 1, product_variant_id: null, quantity: reserved }] : []),
      },
    });

    it('2 on hand, 2 reserved by this order (available 0): a "stock" line stays stock', async () => {
      const client = withReservations(0, 2);
      const [r] = await resolveLineDestinations(
        client,
        5,
        [{ product_id: 1, product_variant_id: null, quantity: 2 }],
        { previous, orderId: 77 },
      );
      expect(r?.destination).toBe('stock');
      expect(client.stock_reservations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            reserved_for_type: 'order',
            reserved_for_id: 77,
            status: 'active',
          }),
        }),
      );
    });

    it('without orderId the reservation is not read and the old behavior holds (production)', async () => {
      const client = withReservations(0, 2);
      const [r] = await resolveLineDestinations(
        client,
        5,
        [{ product_id: 1, product_variant_id: null, quantity: 2 }],
        { previous },
      );
      expect(client.stock_reservations.findMany).not.toHaveBeenCalled();
      expect(r?.destination).toBe('production');
    });

    it('the client explicit choice wins over the persisted destination (B4)', async () => {
      const client = withReservations(9, 0);
      const [r] = await resolveLineDestinations(
        client,
        5,
        [{ product_id: 1, product_variant_id: null, quantity: 1, requested: 'production' }],
        { previous, orderId: 77 },
      );
      expect(r?.destination).toBe('production');
    });
  });
});
