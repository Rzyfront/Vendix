import { RequestContextService } from '@common/context/request-context.service';
import { StorefrontPriceService } from '../../../ecommerce/shared/services/storefront-price.service';
import { PriceResolverService } from '../../products/services/price-resolver.service';
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
  base_price: '0.00',
  sale_price: null,
  is_on_sale: false,
  track_inventory: false,
  product_images: [],
  product_categories: [],
  product_tax_assignments: [],
  product_variants: [],
  ...over,
});

describe('ServicePageViewService (F6-B)', () => {
  const storefrontPrice = new StorefrontPriceService(new PriceResolverService());

  const build = (
    services: unknown[],
    products: unknown[] = [],
    opts: { tierAssignments?: unknown[]; tierOverrides?: unknown[]; promotions?: Map<number, any> } = {},
  ) => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(services)
      .mockResolvedValueOnce(products);
    const s3 = { signUrl: jest.fn(async (key?: string) => (key ? `signed:${key}` : undefined)) };
    const prisma = {
      products: { findMany },
      product_price_tier_assignments: {
        findMany: jest.fn().mockResolvedValue(opts.tierAssignments ?? []),
      },
      product_price_tier_overrides: {
        findMany: jest.fn().mockResolvedValue(opts.tierOverrides ?? []),
      },
    };
    const promotionEngine = {
      findActiveAutoPromotionsForProducts: jest
        .fn()
        .mockResolvedValue(opts.promotions ?? new Map()),
    };
    const view = new ServicePageViewService(
      prisma as any,
      s3 as any,
      storefrontPrice,
      promotionEngine as any,
    );
    return { view, findMany, s3, prisma, promotionEngine };
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
    const { view, s3 } = build(
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
      is_plan: false,
      service_duration_minutes: 60,
      service_duration_unit: 'hour',
    });
    expect(data.products.map((p) => p.id)).toEqual([2, 3]);
    expect(data.products[1].image_url).toBe('signed:k/3.jpg');
    // Reutiliza la imagen ya firmada por `resolvePreviewProductCards` (no firma dos veces `k/1.jpg`).
    expect(s3.signUrl.mock.calls.filter(([k]) => k === 'k/1.jpg')).toHaveLength(1);
  });

  it('does not query secondary products when none is chosen and tolerates a missing config', async () => {
    const { view, findMany } = build([]);

    const data = await view.read(7, null);

    expect(data).toEqual({ services: [], featured_service_ids: [], products: [] });
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('proyecta block_products en orden manual con variantes, presentación por defecto y promociones activas', async () => {
    const { view } = build(
      [],
      [
        product(8, {
          base_price: '20000.00',
          product_variants: [{ id: 81, name: 'Chica', sku: 'C', price_override: '25000.00', is_on_sale: false }],
        }),
        product(5, {
          base_price: '10000.00',
          product_variants: [{ id: 51, name: 'Oculta por presentación', sku: 'H', price_override: '12000.00' }],
        }),
      ],
      {
        tierAssignments: [
          {
            product_id: 5,
            price_tier_id: 3,
            price_tier: {
              id: 3,
              name: 'Pack x6',
              discount_percentage: 0,
              adjustment_type: 'fixed_price',
              adjustment_value: null,
              amount_scope: 'package',
              is_package_unit: true,
              units_per_package: 6,
            },
          },
        ],
        tierOverrides: [
          {
            product_id: 5,
            price_tier_id: 3,
            variant_id: null,
            override_price: '54000.00',
            override_units_per_package: 6,
          },
        ],
      },
    );

    const data = await view.read(7, {
      featured_service_ids: [],
      product_ids: [],
      page: {
        schema_version: 1,
        blocks: [{ id: 'products', type: 'products', enabled: true, props: { selection: 'manual', product_ids: [5, 8] } }],
      },
    });

    expect(data.block_products?.map((p) => p.id)).toEqual([5, 8]);
    // Producto 5 con presentación por defecto: precio del paquete y sin variantes.
    expect(data.block_products?.[0]).toMatchObject({ final_price: 54000, variants: [] });
    expect(data.block_products?.[1].variants).toEqual([
      expect.objectContaining({ id: 81, name: 'Chica', final_price: 25000 }),
    ]);
  });
});

describe('ServicePageViewService — precio igual al público (apps-booking-detail A)', () => {
  const storefrontPrice = new StorefrontPriceService(new PriceResolverService());

  it('cada servicio trae final_price resuelto como el catálogo público (IVA 19 % y promoción automática) y proyecta is_plan', async () => {
    const findMany = jest.fn().mockResolvedValueOnce([
      service(1, 'Facial', {
        base_price: '50000.00',
        track_inventory: false,
        product_tax_assignments: [],
        product_variants: [],
      }),
      service(2, 'Masaje', {
        base_price: '80000.00',
        track_inventory: false,
        product_tax_assignments: [],
        product_variants: [],
      }),
      service(3, 'Plan bienestar 3 días', {
        base_price: '100000.00',
        track_inventory: false,
        service_pricing_type: 'package',
        plan_duration_days: 3,
        product_tax_assignments: [
          {
            is_inclusive: false,
            tax_categories: {
              is_inclusive: false,
              tax_rates: [{ rate: '0.19', is_inclusive: false }],
            },
          },
        ],
        product_variants: [],
      }),
    ]);
    const prisma = {
      products: { findMany },
      product_price_tier_assignments: { findMany: jest.fn().mockResolvedValue([]) },
      product_price_tier_overrides: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const promotionEngine = {
      findActiveAutoPromotionsForProducts: jest.fn().mockResolvedValue(
        new Map([[2, { promotional_price: 60000, is_quantity_tiered: false }]]),
      ),
    };
    const s3 = { signUrl: jest.fn(async () => undefined) };
    const view = new ServicePageViewService(prisma as any, s3 as any, storefrontPrice, promotionEngine as any);

    const data = await view.read(7, { featured_service_ids: [], product_ids: [] });

    expect(data.services.map((s) => [s.id, s.price, s.final_price, s.is_plan])).toEqual([
      [1, 50000, 50000, false],
      [2, 80000, 60000, false],
      [3, 100000, 119000, true],
    ]);
    // Los servicios se leen con los campos de precio e is_plan que usa el catálogo público.
    expect(findMany.mock.calls[0][0].select).toMatchObject({
      product_tax_assignments: expect.any(Object),
      service_duration_minutes: true,
      requires_booking: true,
      service_pricing_type: true,
      plan_duration_days: true,
    });
  });

  it('devuelve todos los servicios en línea sin recortar a 60 para el selector y la selección manual', async () => {
    const many = Array.from({ length: 65 }, (_, i) =>
      service(i + 1, `Servicio ${String(i + 1).padStart(2, '0')}`, {
        track_inventory: false,
        product_tax_assignments: [],
        product_variants: [],
      }),
    );
    const findMany = jest.fn().mockResolvedValueOnce(many);
    const prisma = {
      products: { findMany },
      product_price_tier_assignments: { findMany: jest.fn().mockResolvedValue([]) },
      product_price_tier_overrides: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const promotionEngine = {
      findActiveAutoPromotionsForProducts: jest.fn().mockResolvedValue(new Map()),
    };
    const s3 = { signUrl: jest.fn(async () => undefined) };
    const view = new ServicePageViewService(prisma as any, s3 as any, storefrontPrice, promotionEngine as any);

    const data = await view.read(7, {
      featured_service_ids: [],
      product_ids: [],
      page: {
        schema_version: 1,
        blocks: [{ id: 'services', type: 'services', enabled: true, props: { selection: 'manual', service_ids: [65] } }],
      },
    });

    expect(data.services).toHaveLength(65);
    expect(data.services.some((s) => s.id === 65)).toBe(true);
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
