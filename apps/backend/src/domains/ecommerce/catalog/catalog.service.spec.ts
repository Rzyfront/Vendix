import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { StorefrontPriceService } from '../shared/services/storefront-price.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';
import { RequestContextService } from '@common/context/request-context.service';
import { CatalogService } from './catalog.service';

describe('CatalogService reviews', () => {
  let service: CatalogService;
  let prisma: {
    store_settings: { findFirst: jest.Mock };
    products: { findFirst: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    reviews: { aggregate: jest.Mock; count: jest.Mock };
    promotions: { findMany: jest.Mock };
    product_categories: { findMany: jest.Mock };
  };
  let promotionEngine: { findActiveAutoPromotionsForProducts: jest.Mock };

  const enabledSettings = {
    settings: { ecommerce: { catalog: { allow_reviews: true } } },
  };

  const disabledSettings = {
    settings: { ecommerce: { catalog: { allow_reviews: false } } },
  };

  const baseProduct = {
    id: 100,
    name: 'Producto',
    slug: 'producto',
    description: 'Detalle',
    base_price: 100,
    sale_price: null,
    is_on_sale: false,
    sku: 'SKU-100',
    stock_quantity: 10,
    track_inventory: true,
    product_images: [{ id: 1, image_url: 'image-key', is_main: true }],
    brands: { id: 1, name: 'Marca' },
    product_categories: [],
    product_variants: [],
    product_tax_assignments: [],
    product_type: 'physical',
    requires_booking: false,
    service_duration_minutes: null,
    service_modality: null,
    booking_mode: null,
  };

  beforeEach(async () => {
    prisma = {
      store_settings: { findFirst: jest.fn().mockResolvedValue(enabledSettings) },
      products: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      reviews: {
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      promotions: { findMany: jest.fn().mockResolvedValue([]) },
      product_categories: { findMany: jest.fn().mockResolvedValue([]) },
    };
    promotionEngine = {
      findActiveAutoPromotionsForProducts: jest
        .fn()
        .mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: prisma },
        {
          provide: S3Service,
          useValue: { signUrl: jest.fn(async (key) => key) },
        },
        {
          provide: PriceResolverService,
          useValue: {
            resolvePrice: jest.fn(() => ({
              unitBasePrice: 100,
              unitPriceWithTax: 100,
            })),
          },
        },
        StorefrontPriceService,
        { provide: PromotionEngineService, useValue: promotionEngine },
        {
          provide: MenuAvailabilityCheckerService,
          useValue: {
            getAvailabilityMap: jest.fn().mockResolvedValue(new Map()),
          },
        },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    }).compile();

    service = module.get(CatalogService);
  });

  it('returns zero review metrics and no public reviews when reviews are disabled', async () => {
    prisma.store_settings.findFirst.mockResolvedValueOnce(disabledSettings);
    prisma.products.findFirst.mockResolvedValue({
      ...baseProduct,
      reviews: undefined,
    });

    const result = await service.getProductBySlug('producto');

    expect(result.avg_rating).toBe(0);
    expect(result.review_count).toBe(0);
    expect(result.reviews).toEqual([]);
    expect(prisma.reviews.aggregate).not.toHaveBeenCalled();
    expect(prisma.products.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.not.objectContaining({ reviews: expect.anything() }),
      }),
    );
  });

  it('uses real approved review aggregates while returning the latest public reviews', async () => {
    prisma.products.findFirst.mockResolvedValue({
      ...baseProduct,
      reviews: [
        {
          id: 1,
          rating: 5,
          comment: 'Muy bueno',
          created_at: new Date('2026-01-01T00:00:00Z'),
          users: { first_name: 'Ana', last_name: 'Diaz' },
        },
      ],
    });
    prisma.reviews.aggregate.mockResolvedValue({ _avg: { rating: 4.24 } });
    prisma.reviews.count.mockResolvedValue(17);

    const result = await service.getProductBySlug('producto');

    expect(result.avg_rating).toBe(4.2);
    expect(result.review_count).toBe(17);
    expect(result.reviews).toHaveLength(1);
    expect(prisma.reviews.aggregate).toHaveBeenCalledWith({
      where: { product_id: 100, state: 'approved' },
      _avg: { rating: true },
    });
    expect(prisma.reviews.count).toHaveBeenCalledWith({
      where: { product_id: 100, state: 'approved' },
    });
  });
});

describe('CatalogService active promotions on listing', () => {
  let service: CatalogService;
  let prisma: {
    store_settings: { findFirst: jest.Mock };
    products: { findMany: jest.Mock; count: jest.Mock };
    promotions: { findMany: jest.Mock };
    product_categories: { findMany: jest.Mock };
  };
  let promotionEngine: { findActiveAutoPromotionsForProducts: jest.Mock };

  const listedProduct = (id: number, categoryId?: number) => ({
    id,
    name: `Producto ${id}`,
    slug: `producto-${id}`,
    description: 'Detalle',
    base_price: 100,
    sale_price: null,
    is_on_sale: false,
    is_featured: false,
    sku: `SKU-${id}`,
    track_inventory: true,
    stock_quantity: 5,
    product_images: [],
    brands: null,
    product_categories: categoryId
      ? [{ category_id: categoryId, categories: { id: categoryId, name: 'C' } }]
      : [],
    product_variants: [],
    product_tax_assignments: [],
    product_type: 'physical',
    requires_booking: false,
    service_duration_minutes: null,
    service_modality: null,
    booking_mode: null,
    stock_levels: [],
    _count: { product_variants: 0 },
  });

  beforeEach(async () => {
    prisma = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { ecommerce: { catalog: { allow_reviews: true } } },
        }),
      },
      products: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      promotions: { findMany: jest.fn().mockResolvedValue([]) },
      product_categories: { findMany: jest.fn().mockResolvedValue([]) },
    };
    promotionEngine = {
      findActiveAutoPromotionsForProducts: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: prisma },
        {
          provide: S3Service,
          useValue: { signUrl: jest.fn(async (key) => key ?? null) },
        },
        {
          provide: PriceResolverService,
          useValue: {
            resolvePrice: jest.fn(() => ({
              unitBasePrice: 100,
              unitPriceWithTax: 100,
            })),
          },
        },
        StorefrontPriceService,
        { provide: PromotionEngineService, useValue: promotionEngine },
        {
          provide: MenuAvailabilityCheckerService,
          useValue: {
            getAvailabilityMap: jest.fn().mockResolvedValue(new Map()),
          },
        },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    }).compile();

    service = module.get(CatalogService);
  });

  it('attaches active_promotion to products that match a product-scope auto promotion', async () => {
    prisma.products.findMany.mockResolvedValueOnce([listedProduct(1)]);
    prisma.products.count.mockResolvedValueOnce(1);
    promotionEngine.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
      new Map([
        [
          1,
          {
            id: 99,
            name: '20% OFF',
            type: 'percentage',
            scope: 'product',
            discount_percentage: 20,
            promotional_price: 80,
            badge_label: '-20% OFF',
            priority: 1,
          },
        ],
      ]),
    );

    const result = await service.getProducts({} as any);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].active_promotion).toMatchObject({
      id: 99,
      promotional_price: 80,
      badge_label: '-20% OFF',
    });
    expect(promotionEngine.findActiveAutoPromotionsForProducts).toHaveBeenCalled();
  });

  it('attaches active_promotion when a product qualifies by category scope', async () => {
    prisma.products.findMany.mockResolvedValueOnce([listedProduct(2, 7)]);
    prisma.products.count.mockResolvedValueOnce(1);
    promotionEngine.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
      new Map([
        [
          2,
          {
            id: 200,
            name: 'Cat 10%',
            type: 'percentage',
            scope: 'category',
            discount_percentage: 10,
            promotional_price: 90,
            badge_label: '-10% OFF',
            priority: 0,
          },
        ],
      ]),
    );

    const result = await service.getProducts({} as any);

    expect(result.data[0].active_promotion).toMatchObject({
      id: 200,
      scope: 'category',
      promotional_price: 90,
    });
    // Inputs forwarded to the engine include the product's category ids.
    const call =
      promotionEngine.findActiveAutoPromotionsForProducts.mock.calls[0][0];
    expect(call[0].category_ids).toContain(7);
  });

  it('leaves active_promotion=null when no promotion applies', async () => {
    prisma.products.findMany.mockResolvedValueOnce([listedProduct(3)]);
    prisma.products.count.mockResolvedValueOnce(1);
    promotionEngine.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
      new Map(),
    );

    const result = await service.getProducts({} as any);

    expect(result.data[0].active_promotion).toBeNull();
  });

  it('expands has_discount=true to include products in active auto promotions', async () => {
    // Promotion engine call result for the page is empty; we focus on the
    // additional id-based filter applied to the products query.
    prisma.products.findMany.mockResolvedValueOnce([]);
    prisma.products.count.mockResolvedValueOnce(0);
    promotionEngine.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
      new Map(),
    );
    prisma.promotions.findMany.mockResolvedValueOnce([
      {
        scope: 'product',
        promotion_products: [{ product_id: 11 }, { product_id: 12 }],
        promotion_categories: [],
      },
      {
        scope: 'category',
        promotion_products: [],
        promotion_categories: [{ category_id: 5 }],
      },
    ]);
    prisma.product_categories.findMany.mockResolvedValueOnce([
      { product_id: 21 },
    ]);

    await service.getProducts({ has_discount: 'true' } as any);

    const where = prisma.products.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            { is_on_sale: true },
            { id: { in: expect.arrayContaining([11, 12, 21]) } },
          ]),
        }),
      ]),
    );
  });

  it('keeps the legacy is_on_sale branch when no active auto promotion exists', async () => {
    prisma.products.findMany.mockResolvedValueOnce([]);
    prisma.products.count.mockResolvedValueOnce(0);
    promotionEngine.findActiveAutoPromotionsForProducts.mockResolvedValueOnce(
      new Map(),
    );
    prisma.promotions.findMany.mockResolvedValueOnce([]);

    await service.getProducts({ has_discount: 'true' } as any);

    const where = prisma.products.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([{ is_on_sale: true }]),
        }),
      ]),
    );
  });
});

describe('CatalogService featured fill cascade', () => {
  let service: CatalogService;
  let prisma: {
    store_settings: { findFirst: jest.Mock };
    products: { findMany: jest.Mock; count: jest.Mock };
    order_items: { groupBy: jest.Mock };
    promotions: { findMany: jest.Mock };
    product_categories: { findMany: jest.Mock };
  };
  let promotionEngine: { findActiveAutoPromotionsForProducts: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };

  const STORE_ID = 9;

  const product = (id: number, is_featured = false) => ({
    id,
    name: `Producto ${id}`,
    slug: `producto-${id}`,
    description: 'Detalle',
    base_price: 100,
    sale_price: null,
    is_on_sale: false,
    is_featured,
    sku: `SKU-${id}`,
    track_inventory: true,
    stock_quantity: 5,
    product_images: [],
    brands: null,
    product_categories: [],
    product_variants: [],
    product_tax_assignments: [],
    product_type: 'physical',
    requires_booking: false,
    service_duration_minutes: null,
    service_modality: null,
    booking_mode: null,
    stock_levels: [],
    _count: { product_variants: 0 },
  });

  const ids = (result: { data: Array<{ id: number }> }) =>
    result.data.map((p) => p.id);

  beforeEach(async () => {
    prisma = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { ecommerce: { catalog: {} } },
        }),
      },
      products: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      order_items: { groupBy: jest.fn().mockResolvedValue([]) },
      promotions: { findMany: jest.fn().mockResolvedValue([]) },
      product_categories: { findMany: jest.fn().mockResolvedValue([]) },
    };
    promotionEngine = {
      findActiveAutoPromotionsForProducts: jest
        .fn()
        .mockResolvedValue(new Map()),
    };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: prisma },
        {
          provide: S3Service,
          useValue: { signUrl: jest.fn(async (key) => key ?? null) },
        },
        {
          provide: PriceResolverService,
          useValue: {
            resolvePrice: jest.fn(() => ({
              unitBasePrice: 100,
              unitPriceWithTax: 100,
            })),
          },
        },
        StorefrontPriceService,
        { provide: PromotionEngineService, useValue: promotionEngine },
        {
          provide: MenuAvailabilityCheckerService,
          useValue: {
            getAvailabilityMap: jest.fn().mockResolvedValue(new Map()),
          },
        },
        { provide: CACHE_MANAGER, useValue: cache },
      ],
    }).compile();

    service = module.get(CatalogService);

    // Habilita el escalón 2 (más vendidos) proveyendo store context.
    jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(STORE_ID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fills up to limit in order featured -> best sellers -> newest', async () => {
    prisma.products.findMany
      // Escalón 1: destacados
      .mockResolvedValueOnce([product(1, true), product(2, true)])
      // Escalón 2: best sellers (regresa desordenado, se reordena por ranking)
      .mockResolvedValueOnce([product(5), product(3)])
      // Escalón 3: newest filler
      .mockResolvedValueOnce([product(9)]);
    prisma.order_items.groupBy.mockResolvedValueOnce([
      { product_id: 3, _sum: { quantity: 9 } },
      { product_id: 5, _sum: { quantity: 4 } },
    ]);

    const result = await service.getProducts({
      fill: 'true',
      is_featured: 'true',
      limit: 5,
    } as any);

    expect(ids(result)).toEqual([1, 2, 3, 5, 9]);
    expect(result.data).toHaveLength(5);
    expect(result.meta).toMatchObject({ page: 1, limit: 5, total_pages: 1 });
    // La cascada nunca consulta count.
    expect(prisma.products.count).not.toHaveBeenCalled();
  });

  it('does not duplicate a product that is both featured and a best seller', async () => {
    prisma.products.findMany
      .mockResolvedValueOnce([product(1, true), product(2, true)])
      // El best seller 2 ya está en seen; sólo debe consultarse el 4.
      .mockResolvedValueOnce([product(4)]);
    prisma.order_items.groupBy.mockResolvedValueOnce([
      { product_id: 2, _sum: { quantity: 20 } },
      { product_id: 4, _sum: { quantity: 8 } },
    ]);

    const result = await service.getProducts({
      fill: 'true',
      is_featured: 'true',
      limit: 3,
    } as any);

    expect(ids(result)).toEqual([1, 2, 4]);
    expect(result.data).toHaveLength(3);
    // El id ya visto (2) se excluye del filtro de best sellers.
    const bestSellerWhere = prisma.products.findMany.mock.calls[1][0].where;
    expect(bestSellerWhere.id).toEqual({ in: [4] });
  });

  it('keeps availability where without is_featured on the fill steps but with it on featured', async () => {
    prisma.products.findMany
      .mockResolvedValueOnce([product(1, true)])
      .mockResolvedValueOnce([product(2)])
      .mockResolvedValueOnce([product(9)]);
    prisma.order_items.groupBy.mockResolvedValueOnce([
      { product_id: 2, _sum: { quantity: 5 } },
    ]);

    await service.getProducts({
      fill: 'true',
      is_featured: 'true',
      limit: 3,
    } as any);

    const featuredWhere = prisma.products.findMany.mock.calls[0][0].where;
    const bestSellerWhere = prisma.products.findMany.mock.calls[1][0].where;
    const fillerWhere = prisma.products.findMany.mock.calls[2][0].where;

    expect(featuredWhere.is_featured).toBe(true);

    for (const where of [bestSellerWhere, fillerWhere]) {
      expect(where.is_featured).toBeUndefined();
      expect(where.state).toBe('active');
      expect(where.available_for_ecommerce).toBe(true);
      expect(where.is_sellable).toBe(true);
    }
    expect(fillerWhere.id).toEqual({ notIn: [1, 2] });
  });

  it('falls back to newest when there are no sales in the last 30 days', async () => {
    prisma.products.findMany
      // Escalón 1
      .mockResolvedValueOnce([product(1, true)])
      // Escalón 3 (sin escalón 2 porque no hay best sellers)
      .mockResolvedValueOnce([product(8), product(9)]);
    prisma.order_items.groupBy.mockResolvedValueOnce([]);

    const result = await service.getProducts({
      fill: 'true',
      is_featured: 'true',
      limit: 3,
    } as any);

    expect(ids(result)).toEqual([1, 8, 9]);
    expect(prisma.order_items.groupBy).toHaveBeenCalled();
    // Sólo dos consultas: destacados + filler (best sellers no aporta candidatos).
    expect(prisma.products.findMany).toHaveBeenCalledTimes(2);
  });

  it('returns fewer than limit without throwing when catalog is insufficient', async () => {
    prisma.products.findMany
      .mockResolvedValueOnce([product(1, true)])
      .mockResolvedValueOnce([]);
    prisma.order_items.groupBy.mockResolvedValueOnce([]);

    const result = await service.getProducts({
      fill: 'true',
      is_featured: 'true',
      limit: 5,
    } as any);

    expect(result.data.length).toBeLessThan(5);
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(result.data.length);
  });

  it('does NOT enter the cascade when fill=true but is_featured is missing', async () => {
    prisma.products.findMany.mockResolvedValueOnce([]);
    prisma.products.count.mockResolvedValueOnce(0);

    await service.getProducts({ fill: 'true', limit: 5 } as any);

    // Ruta normal de listado sí consulta count; la cascada nunca lo hace.
    expect(prisma.products.count).toHaveBeenCalled();
  });
});

/**
 * QUI-648 fase 2b — proyección de presentaciones en el catálogo público.
 *
 * Estos tests usan el `PriceResolverService` REAL (no un mock) a propósito: lo
 * que se está protegiendo es ARITMÉTICA DE DINERO, y un resolver mockeado
 * dejaría pasar exactamente el bug que importa (mezclar la escala del paquete
 * con la de la unidad).
 */
describe('CatalogService available_sale_units (QUI-648 fase 2b)', () => {
  let service: CatalogService;
  let prisma: any;
  let storeIdSpy: jest.SpyInstance;

  const SALE_UNIT_PRODUCT = {
    id: 500,
    name: 'Cable',
    slug: 'cable',
    description: null,
    base_price: 5,
    sale_price: null,
    is_on_sale: false,
    is_featured: false,
    sku: 'CABLE',
    track_inventory: true,
    stock_uom_id: null,
    product_images: [],
    brands: null,
    product_categories: [],
    product_variants: [],
    product_tax_assignments: [],
    product_type: 'physical',
    requires_booking: false,
    service_duration_minutes: null,
    service_modality: null,
    booking_mode: null,
    // 88.500 unidades de stock, todas en la fila base (sin variantes).
    stock_levels: [{ product_variant_id: null, quantity_available: 88500 }],
    _count: { product_variants: 0 },
  };

  // Metro (default): 1.000 unidades por paquete, precio explícito 5.000.
  // Rollo 20 m: 20.000 unidades por paquete, precio explícito 95.000.
  const ASSIGNMENTS = [
    {
      product_id: 500,
      price_tier_id: 71,
      is_default: true,
      price_tier: {
        id: 71,
        name: 'Metro',
        discount_percentage: 0,
        is_package_unit: true,
        units_per_package: 1000,
      },
    },
    {
      product_id: 500,
      price_tier_id: 72,
      is_default: false,
      price_tier: {
        id: 72,
        name: 'Rollo 20 m',
        discount_percentage: 0,
        is_package_unit: true,
        units_per_package: 20000,
      },
    },
  ];

  const OVERRIDES = [
    {
      product_id: 500,
      price_tier_id: 71,
      variant_id: null,
      override_price: 5000,
      override_units_per_package: null,
    },
    {
      product_id: 500,
      price_tier_id: 72,
      variant_id: null,
      override_price: 95000,
      override_units_per_package: null,
    },
  ];

  const buildModule = async (selectorEnabled: boolean | undefined) => {
    prisma = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: {
            ecommerce: {
              catalog: {
                allow_reviews: false,
                // `undefined` reproduce la tienda que jamás oyó hablar del
                // selector: el default del flag es APAGADO.
                ...(selectorEnabled === undefined
                  ? {}
                  : { enable_sale_unit_selector: selectorEnabled }),
              },
            },
          },
        }),
      },
      products: {
        findFirst: jest.fn().mockResolvedValue({ ...SALE_UNIT_PRODUCT }),
        findMany: jest.fn().mockResolvedValue([{ ...SALE_UNIT_PRODUCT }]),
        count: jest.fn().mockResolvedValue(1),
      },
      reviews: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 0 } }),
        count: jest.fn().mockResolvedValue(0),
      },
      promotions: { findMany: jest.fn().mockResolvedValue([]) },
      product_categories: { findMany: jest.fn().mockResolvedValue([]) },
      units_of_measure: { findMany: jest.fn().mockResolvedValue([]) },
      product_price_tier_assignments: {
        findMany: jest.fn(async (args: any) =>
          // `resolveDefaultSaleUnits` filtra por `is_default`;
          // `listPublicSaleUnitsForProducts` no. El mock respeta el where para
          // que las dos lecturas no se pisen.
          args?.where?.is_default
            ? ASSIGNMENTS.filter((a) => a.is_default)
            : ASSIGNMENTS,
        ),
      },
      product_price_tier_overrides: {
        findMany: jest.fn().mockResolvedValue(OVERRIDES),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: EcommercePrismaService, useValue: prisma },
        { provide: StorePrismaService, useValue: prisma },
        {
          provide: S3Service,
          useValue: { signUrl: jest.fn(async (key) => key ?? null) },
        },
        // Resolver REAL: la aritmética del paquete es lo que se está probando.
        PriceResolverService,
        StorefrontPriceService,
        {
          provide: PromotionEngineService,
          useValue: {
            findActiveAutoPromotionsForProducts: jest
              .fn()
              .mockResolvedValue(new Map()),
          },
        },
        {
          provide: MenuAvailabilityCheckerService,
          useValue: {
            getAvailabilityMap: jest.fn().mockResolvedValue(new Map()),
          },
        },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    }).compile();

    service = module.get(CatalogService);
  };

  beforeEach(() => {
    storeIdSpy = jest
      .spyOn(RequestContextService, 'getStoreId')
      .mockReturnValue(10);
  });

  afterEach(() => {
    storeIdSpy.mockRestore();
  });

  it('publica las presentaciones y mantiene las invariantes de escala cuando el flag está encendido', async () => {
    await buildModule(true);

    const detail: any = await service.getProductBySlug('cable');

    expect(detail.available_sale_units).toHaveLength(2);
    // Orden = el de `listPublicSaleUnitsForProducts` (sort_order), no reordenado.
    expect(detail.available_sale_units.map((u: any) => u.price_tier_id)).toEqual(
      [71, 72],
    );

    const [metro, rollo] = detail.available_sale_units;
    // `price` es el precio del PAQUETE ENTERO: nunca `precio * units_per_package`.
    expect(metro.price).toBe(5000);
    expect(rollo.price).toBe(95000);
    // available_packages = floor(unidades / packSize efectivo).
    expect(metro.available_packages).toBe(88); // floor(88500 / 1000)
    expect(rollo.available_packages).toBe(4); // floor(88500 / 20000)
    expect(metro.units_per_package).toBe(1000);
    expect(rollo.units_per_package).toBe(20000);
    expect(metro.is_default).toBe(true);
    expect(rollo.is_default).toBe(false);

    // Invariante 1: la presentación por defecto cotiza EXACTAMENTE `final_price`.
    expect(metro.price).toBe(detail.final_price);
    // Invariante 2: `price_from` es el mínimo publicado.
    expect(detail.price_from).toBe(
      Math.min(...detail.available_sale_units.map((u: any) => u.price)),
    );
    expect(detail.sale_unit_count).toBe(2);
  });

  it('deja la respuesta idéntica a la histórica cuando el flag está apagado', async () => {
    await buildModule(false);
    const off: any = await service.getProductBySlug('cable');

    await buildModule(true);
    const on: any = await service.getProductBySlug('cable');

    // Lo NUEVO desaparece...
    expect(off.available_sale_units).toEqual([]);
    expect(off.sale_unit_count).toBe(0);
    expect(off.price_from).toBeNull();

    // ...y lo VIEJO no se mueve ni un centavo. Ésta es la garantía de cero
    // regresión para el cliente que no se actualice.
    expect(off.final_price).toBe(on.final_price);
    expect(off.sale_unit).toEqual(on.sale_unit);
    expect(off.available_stock).toBe(on.available_stock);
    expect(off.available_stock_units).toBe(on.available_stock_units);
    expect(off.stock_quantity).toBe(on.stock_quantity);
  });

  it('trata la AUSENCIA del flag como apagado (el default es false, no true)', async () => {
    await buildModule(undefined);

    const detail: any = await service.getProductBySlug('cable');

    // Si alguien copiara el patrón `!== false` de `show_variants`, esta tienda
    // —cuyos settings ni mencionan la clave— estrenaría el selector encendido.
    expect(detail.available_sale_units).toEqual([]);
    expect(detail.sale_unit_count).toBe(0);
    expect(detail.price_from).toBeNull();
    // La presentación por defecto sigue rigiendo el precio publicado.
    expect(detail.final_price).toBe(5000);
    expect(detail.sale_unit).toEqual({
      price_tier_id: 71,
      name: 'Metro',
      units_per_package: 1000,
    });
  });

  it('proyecta sale_unit_count y price_from en el LISTADO sin tocar final_price', async () => {
    await buildModule(true);

    const listing: any = await service.getProducts({ page: 1, limit: 10 } as any);
    const card = listing.data[0];

    expect(card.sale_unit_count).toBe(2);
    expect(card.price_from).toBe(5000);
    expect(card.final_price).toBe(5000);
    expect(card.available_stock).toBe(88);
    expect(card.available_stock_units).toBe(88500);
    // El listado hidrata en LOTE: una sola lectura de asignaciones por página,
    // nunca una por producto.
    expect(
      prisma.product_price_tier_assignments.findMany,
    ).toHaveBeenCalledTimes(2); // 1 default en lote + 1 abanico en lote
  });
});
