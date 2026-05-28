import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
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
        { provide: PromotionEngineService, useValue: promotionEngine },
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
        { provide: PromotionEngineService, useValue: promotionEngine },
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
