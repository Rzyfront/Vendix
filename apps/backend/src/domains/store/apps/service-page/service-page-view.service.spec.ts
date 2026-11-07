import { RequestContextService } from '@common/context/request-context.service';
import { ServicePageAppService } from './service-page-app.service';
import { ServicePageViewService } from './service-page-view.service';

const service = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `s-${id}`,
  name,
  description: null,
  base_price: '50000.00',
  sale_price: null,
  is_on_sale: false,
  service_duration_minutes: 60,
  service_duration_unit: 'hour',
  service_modality: 'in_person',
  requires_booking: true,
  product_images: [],
  product_categories: [],
  ...over,
});

const product = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  slug: `p-${id}`,
  name: `Producto ${id}`,
  product_images: [],
  ...over,
});

describe('ServicePageViewService (F6-B)', () => {
  const build = (services: unknown[], products: unknown[] = []) => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(services)
      .mockResolvedValueOnce(products);
    const s3 = { signUrl: jest.fn(async (key?: string) => (key ? `signed:${key}` : undefined)) };
    const view = new ServicePageViewService({ products: { findMany } } as any, s3 as any);
    return { view, findMany, s3 };
  };

  it('filters services and secondary products by the store and the sold-online rule', async () => {
    const { view, findMany } = build([service(1, 'Facial')], [product(5)]);

    await view.read(7, { featured_service_ids: [], product_ids: [5] });

    const servicesWhere = findMany.mock.calls[0][0].where;
    expect(servicesWhere).toMatchObject({
      store_id: 7,
      state: 'active',
      available_for_ecommerce: true,
      usage_nature: 'sale',
      product_type: 'service',
    });
    expect(servicesWhere.id).toBeUndefined();
    expect(findMany.mock.calls[1][0].where).toMatchObject({
      store_id: 7,
      id: { in: [5] },
      product_type: { not: 'service' },
    });
  });

  it('puts the featured services first in the owner order, then the rest by name, like the public page', async () => {
    const { view } = build([service(1, 'Ana'), service(2, 'Beto'), service(3, 'Carla')]);

    const data = await view.read(7, { featured_service_ids: [3, 99, 2], product_ids: [] });

    expect(data.services.map((s) => s.id)).toEqual([3, 2, 1]);
    expect(data.featured_service_ids).toEqual([3, 2]);
  });

  it('returns price (sale price when on sale), signed image, categories and the products in the owner order', async () => {
    const { view } = build(
      [
        service(1, 'Facial', {
          is_on_sale: true,
          sale_price: '40000.00',
          product_images: [{ image_url: 'k/1.jpg' }],
          product_categories: [{ categories: { id: 9, name: 'Rostro', slug: 'rostro' } }],
        }),
      ],
      [product(3, { product_images: [{ image_url: 'k/3.jpg' }] }), product(2)],
    );

    const data = await view.read(7, { featured_service_ids: [], product_ids: [2, 3, 77] });

    expect(data.services[0]).toMatchObject({
      price: 40000,
      image_url: 'signed:k/1.jpg',
      categories: [{ id: 9, name: 'Rostro', slug: 'rostro' }],
      requires_booking: true,
      service_duration_minutes: 60,
      service_duration_unit: 'hour',
    });
    expect(data.products.map((p) => p.id)).toEqual([2, 3]);
    expect(data.products[1].image_url).toBe('signed:k/3.jpg');
  });

  it('does not query secondary products when none is chosen and tolerates a missing config', async () => {
    const { view, findMany } = build([]);

    const data = await view.read(7, null);

    expect(data).toEqual({ services: [], featured_service_ids: [], products: [] });
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('ServicePageAppService.previewContext (F6-B)', () => {
  it('reads the preview for the store of the request, with the stored config and whatever the status', async () => {
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(10);
    const config = { featured_service_ids: [1] };
    const prisma = {
      store_apps: { findFirst: jest.fn().mockResolvedValue({ id: 1, status: 'draft', config }) },
    };
    const view = { read: jest.fn().mockResolvedValue({ services: [] }) };
    const app = new ServicePageAppService(prisma as any, {} as any, view as any);

    await app.previewContext();

    expect(prisma.store_apps.findFirst.mock.calls[0][0].where).toEqual({ store_id: 10, kind: 'service_page' });
    expect(view.read).toHaveBeenCalledWith(10, config);
  });
});
