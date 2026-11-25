import { ProductsService } from './products.service';

/**
 * addImage keeps "a product with images has exactly one main image":
 * POS, product list and ecommerce cards only read `is_main = true`.
 *
 * The fake prisma keeps images in memory and emulates the row lock taken by
 * `SELECT ... FOR UPDATE`: the lock is held until the transaction callback
 * ends, as Postgres does, so concurrent additions are serialized only if the
 * service takes the lock before reading the current main image.
 */
type Img = { id: number; product_id: number; is_main: boolean; image_url: string };

function buildService(initial: Img[] = []) {
  const images: Img[] = initial.map((i) => ({ ...i }));
  let nextId = images.reduce((m, i) => Math.max(m, i.id), 0) + 1;
  let lock: Promise<void> = Promise.resolve();
  const tick = () => new Promise((r) => setImmediate(r));

  const runTx = async <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    let release: () => void = () => undefined;
    const tx = {
      products: {
        findFirst: jest.fn(async ({ where }: any) => {
          await tick();
          return where.id === 10 ? { id: 10 } : null;
        }),
      },
      $queryRaw: jest.fn(async () => {
        const previous = lock;
        lock = new Promise<void>((r) => (release = r));
        await previous;
        return [{ id: 10 }];
      }),
      product_images: {
        findFirst: jest.fn(async ({ where }: any) => {
          await tick();
          return (
            images.find(
              (i) => i.product_id === where.product_id && i.is_main === where.is_main,
            ) ?? null
          );
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          await tick();
          images
            .filter((i) => i.product_id === where.product_id)
            .forEach((i) => Object.assign(i, data));
          return { count: 0 };
        }),
        create: jest.fn(async ({ data }: any) => {
          await tick();
          const row = { id: nextId++, ...data } as Img;
          images.push(row);
          return row;
        }),
      },
    };
    try {
      return await fn(tx);
    } finally {
      release();
    }
  };

  const service = Object.create(ProductsService.prototype) as any;
  service.prisma = { $transaction: jest.fn(runTx) };
  return { service, images };
}

const mains = (images: Img[]) => images.filter((i) => i.is_main);

describe('ProductsService.addImage — la primera imagen queda como principal', () => {
  it('sin imágenes previas y sin is_main: la nueva queda principal', async () => {
    const { service, images } = buildService();
    const created = await service.addImage(10, { image_url: 'a.jpg' });
    expect(created.is_main).toBe(true);
    expect(mains(images)).toHaveLength(1);
  });

  it('is_main: false explícito sin principal existente: también queda principal', async () => {
    const { service } = buildService([
      { id: 1, product_id: 10, is_main: false, image_url: 'old.jpg' },
    ]);
    const created = await service.addImage(10, { image_url: 'b.jpg', is_main: false });
    expect(created.is_main).toBe(true);
  });

  it('con otra principal existente: la nueva queda secundaria', async () => {
    const { service, images } = buildService([
      { id: 1, product_id: 10, is_main: true, image_url: 'main.jpg' },
    ]);
    const created = await service.addImage(10, { image_url: 'b.jpg' });
    expect(created.is_main).toBe(false);
    expect(mains(images).map((i) => i.id)).toEqual([1]);
  });

  it('con is_main: true: desmarca las demás y queda como única principal', async () => {
    const { service, images } = buildService([
      { id: 1, product_id: 10, is_main: true, image_url: 'main.jpg' },
      { id: 2, product_id: 10, is_main: false, image_url: 'x.jpg' },
    ]);
    const created = await service.addImage(10, { image_url: 'c.jpg', is_main: true });
    expect(created.is_main).toBe(true);
    expect(mains(images).map((i) => i.id)).toEqual([created.id]);
  });

  it('dos altas simultáneas sin principal: exactamente una queda principal', async () => {
    const { service, images } = buildService();
    const [a, b] = await Promise.all([
      service.addImage(10, { image_url: 'a.jpg' }),
      service.addImage(10, { image_url: 'b.jpg' }),
    ]);
    expect([a.is_main, b.is_main].filter(Boolean)).toHaveLength(1);
    expect(images).toHaveLength(2);
    expect(mains(images)).toHaveLength(1);
  });

  it('producto inexistente o inactivo: error y no crea nada', async () => {
    const { service, images } = buildService();
    await expect(service.addImage(99, { image_url: 'a.jpg' })).rejects.toMatchObject({
      errorCode: 'PROD_FIND_001',
    });
    expect(images).toHaveLength(0);
  });
});
