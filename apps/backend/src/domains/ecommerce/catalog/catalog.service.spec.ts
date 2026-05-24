import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { S3Service } from '@common/services/s3.service';
import { PriceResolverService } from '../../store/products/services/price-resolver.service';
import { CatalogService } from './catalog.service';

describe('CatalogService reviews', () => {
  let service: CatalogService;
  let prisma: {
    store_settings: { findFirst: jest.Mock };
    products: { findFirst: jest.Mock };
    reviews: { aggregate: jest.Mock; count: jest.Mock };
  };

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
      products: { findFirst: jest.fn() },
      reviews: {
        aggregate: jest.fn(),
        count: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: EcommercePrismaService, useValue: prisma },
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
