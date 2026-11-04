import { BookingViewService } from './booking-view.service';

describe('BookingViewService (F6-B)', () => {
  const build = (roomTypes: unknown[], products: unknown[] = []) => {
    const lodging = { findMany: jest.fn().mockResolvedValue(roomTypes) };
    const productsFindMany = jest.fn().mockResolvedValue(products);
    const s3 = { signUrl: jest.fn(async (key?: string) => (key ? `signed:${key}` : undefined)) };
    const view = new BookingViewService(
      { lodging_unit_types: lodging, products: { findMany: productsFindMany } } as any,
      s3 as any,
    );
    return { view, lodging, productsFindMany };
  };

  const room = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    name: `Hab ${id}`,
    description: null,
    max_occupancy: 2,
    bed_config: null,
    images: [],
    ...over,
  });

  it('filters room types and secondary products by the store', async () => {
    const { view, lodging, productsFindMany } = build([room(1)], [
      { id: 5, slug: 'p-5', name: 'Desayuno', product_images: [] },
    ]);

    await view.read(7, { product_ids: [5] });

    expect(lodging.findMany.mock.calls[0][0].where).toEqual({ store_id: 7, is_active: true });
    expect(productsFindMany.mock.calls[0][0].where).toMatchObject({
      store_id: 7,
      id: { in: [5] },
      product_type: { not: 'service' },
    });
  });

  it('signs photos, keeps the owner product order and drops products no longer sold', async () => {
    const { view } = build(
      [room(1, { images: ['k/a.jpg', 'k/b.jpg'] })],
      [
        { id: 6, slug: 'p-6', name: 'Spa', product_images: [{ image_url: 'k/s.jpg' }] },
        { id: 5, slug: 'p-5', name: 'Desayuno', product_images: [] },
      ],
    );

    const data = await view.read(7, { product_ids: [5, 9, 6] });

    expect(data.room_types[0].image_url).toBe('signed:k/a.jpg');
    expect(data.products.map((p) => p.id)).toEqual([5, 6]);
    expect(data.products[1].image_url).toBe('signed:k/s.jpg');
  });

  it('does not read products when the app has none and works without a saved config', async () => {
    const { view, productsFindMany } = build([room(1)]);

    const data = await view.read(7, null);

    expect(productsFindMany).not.toHaveBeenCalled();
    expect(data.products).toEqual([]);
    expect(data.room_types).toHaveLength(1);
  });
});
