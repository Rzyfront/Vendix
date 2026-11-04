import { RequestContextService } from '@common/context/request-context.service';
import { ProductPageAppService } from './product-page-app.service';
import { ProductPageViewService } from './product-page-view.service';

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  slug: `p-${id}`,
  name: `Producto ${id}`,
  description: null,
  product_images: [],
  product_variants: [],
  ...over,
});

describe('ProductPageViewService (F6-B)', () => {
  const build = (rows: unknown[]) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    const s3 = { signUrl: jest.fn(async (key?: string) => (key ? `signed:${key}` : undefined)) };
    const service = new ProductPageViewService({ products: { findMany } } as any, s3 as any);
    return { service, findMany, s3 };
  };

  it('filters the catalog by the store and the sold-online rule', async () => {
    const { service, findMany } = build([row(1)]);

    await service.read(7, { product_id: 1, complement_product_ids: [2, 3] });

    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      store_id: 7,
      id: { in: [1, 2, 3] },
      state: 'active',
      available_for_ecommerce: true,
      usage_nature: 'sale',
    });
  });

  it('returns the featured product with its signed image and variants, and the complements in the owner order', async () => {
    const { service } = build([
      row(2, { product_images: [{ image_url: 'k/2.jpg' }] }),
      row(1, {
        description: 'Crema',
        product_images: [{ image_url: 'k/1.jpg' }],
        product_variants: [
          { id: 10, name: 'Chica', sku: 'C' },
          { id: 11, name: null, sku: 'G-SKU' },
        ],
      }),
      row(3),
    ]);

    const data = await service.read(7, { product_id: 1, complement_product_ids: [3, 2, 99] });

    expect(data.product).toEqual({
      id: 1,
      slug: 'p-1',
      name: 'Producto 1',
      description: 'Crema',
      image_url: 'signed:k/1.jpg',
      variants: [
        { id: 10, name: 'Chica' },
        { id: 11, name: 'G-SKU' },
      ],
    });
    // 99 is not sellable: dropped; the owner's order is kept.
    expect(data.complements.map((c) => [c.id, c.image_url])).toEqual([
      [3, null],
      [2, 'signed:k/2.jpg'],
    ]);
  });

  it('without a chosen product, or when it is no longer sellable, there is no product and no query for the former', async () => {
    const { service, findMany } = build([]);

    await expect(service.read(7, null)).resolves.toEqual({ product: null, complements: [] });
    expect(findMany).not.toHaveBeenCalled();

    await expect(service.read(7, { product_id: 1, complement_product_ids: [] })).resolves.toEqual({
      product: null,
      complements: [],
    });
  });
});

describe('ProductPageAppService.previewContext (F6-B)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads the preview data of the store in the request context, published or not', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(7);
    const config = { product_id: 1, complement_product_ids: [], page: { schema_version: 1, blocks: [] } };
    const findFirst = jest.fn().mockResolvedValue({ id: 1, status: 'draft', config, domain_settings: null });
    const data = { product: null, complements: [] };
    const view = { read: jest.fn().mockResolvedValue(data) };
    const service = new ProductPageAppService({ store_apps: { findFirst } } as any, {} as any, view as any);

    await expect(service.previewContext()).resolves.toBe(data);
    expect(findFirst.mock.calls[0][0].where).toEqual({ store_id: 7, kind: 'product_page' });
    expect(view.read).toHaveBeenCalledWith(7, config);
  });

  it('without a store in the context it refuses', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(undefined as any);
    const service = new ProductPageAppService({} as any, {} as any, { read: jest.fn() } as any);
    await expect(service.previewContext()).rejects.toThrow();
  });
});
