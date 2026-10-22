import { EmbeddingEventsListener } from './embedding-events.listener';

describe('EmbeddingEventsListener - products.bulk_updated', () => {
  let listener: EmbeddingEventsListener;
  let queue: { add: jest.Mock; addBulk: jest.Mock };
  let prisma: { products: { findMany: jest.Mock } };

  beforeEach(() => {
    queue = {
      add: jest.fn().mockResolvedValue({}),
      addBulk: jest.fn().mockResolvedValue([]),
    };
    prisma = { products: { findMany: jest.fn() } };
    listener = new EmbeddingEventsListener(queue as any, prisma as any);
  });

  it('relee con filtro store_id e ids y encola N jobs con el contenido compuesto', async () => {
    prisma.products.findMany.mockResolvedValue([
      {
        id: 1,
        name: 'Harina',
        description: 'Fina',
        product_categories: [{ categories: { name: 'Despensa' } }],
      },
      { id: 2, name: 'Arroz', description: null, product_categories: [] },
    ]);

    await listener.handleProductsBulkUpdated({
      store_id: 9,
      organization_id: 3,
      product_ids: [1, 2, 2],
    });

    const where = prisma.products.findMany.mock.calls[0][0].where;
    expect(where).toEqual(
      expect.objectContaining({ store_id: 9, id: { in: [1, 2] } }),
    );
    expect(where.state).toEqual({ not: 'archived' });

    expect(queue.addBulk).toHaveBeenCalledTimes(1);
    const jobs = queue.addBulk.mock.calls[0][0];
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toEqual({
      name: 'embed',
      data: {
        store_id: 9,
        organization_id: 3,
        entity_type: 'product',
        entity_id: 1,
        content: 'Harina. Fina. Category: Despensa',
      },
      opts: expect.objectContaining({
        attempts: 2,
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 100 },
      }),
    });
    expect(jobs[1].data.content).toBe('Arroz');
  });

  it('no consulta ni encola con la lista vacía', async () => {
    await listener.handleProductsBulkUpdated({
      store_id: 9,
      organization_id: 3,
      product_ids: [],
    });
    expect(prisma.products.findMany).not.toHaveBeenCalled();
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it('un error del queue no se propaga', async () => {
    prisma.products.findMany.mockResolvedValue([
      { id: 1, name: 'Harina', description: null, product_categories: [] },
    ]);
    queue.addBulk.mockRejectedValue(new Error('redis down'));

    await expect(
      listener.handleProductsBulkUpdated({
        store_id: 9,
        organization_id: 3,
        product_ids: [1],
      }),
    ).resolves.toBeUndefined();
  });

  it('un error de lectura no se propaga', async () => {
    prisma.products.findMany.mockRejectedValue(new Error('db down'));
    await expect(
      listener.handleProductsBulkUpdated({
        store_id: 9,
        organization_id: 3,
        product_ids: [1],
      }),
    ).resolves.toBeUndefined();
    expect(queue.addBulk).not.toHaveBeenCalled();
  });
});
