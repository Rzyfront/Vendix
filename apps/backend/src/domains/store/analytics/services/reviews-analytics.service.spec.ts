import { ReviewsAnalyticsService } from './reviews-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * QUI-548 follow-up: el reporte "Reseñas por producto" fallaba en pantalla
 * porque el registry apunta a `GET reviews/by-product` y ese endpoint no
 * existía (solo el `/export`). Estos specs cubren la agregación compartida
 * por pantalla y archivo (pantalla == archivo).
 */
type MockStorePrismaService = {
  reviews: { findMany: jest.Mock };
  store_settings: { findFirst: jest.Mock };
} & Partial<StorePrismaService>;

function makeReview(overrides: {
  id: number;
  product_id: number;
  name: string;
  sku: string;
  rating: number;
  verified_purchase?: boolean;
  state?: string;
  created_at?: Date;
}) {
  return {
    id: overrides.id,
    product_id: overrides.product_id,
    rating: overrides.rating,
    verified_purchase: overrides.verified_purchase ?? false,
    state: overrides.state ?? 'approved',
    created_at: overrides.created_at ?? new Date('2026-09-01T15:00:00.000Z'),
    products: { name: overrides.name, sku: overrides.sku },
  };
}

describe('ReviewsAnalyticsService.getReviewsByProduct', () => {
  let prisma: MockStorePrismaService;
  let service: ReviewsAnalyticsService;

  beforeEach(() => {
    prisma = {
      reviews: { findMany: jest.fn() },
      store_settings: { findFirst: jest.fn() },
    } as MockStorePrismaService;

    // Sin timezone en tienda -> DEFAULT_STORE_TIMEZONE ('America/Bogota').
    prisma.store_settings.findFirst.mockResolvedValue(null);

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 3, is_super_admin: false, is_owner: false });

    service = new ReviewsAnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('agrupa por producto con promedio a 1 decimal y distribución de estrellas', async () => {
    prisma.reviews.findMany.mockResolvedValue([
      makeReview({ id: 1, product_id: 10, name: 'Café', sku: 'CAF-1', rating: 5, verified_purchase: true }),
      makeReview({ id: 2, product_id: 10, name: 'Café', sku: 'CAF-1', rating: 4 }),
      makeReview({ id: 3, product_id: 20, name: 'Té', sku: 'TE-1', rating: 3, state: 'pending' }),
    ]);

    const rows = await service.getReviewsByProduct({} as any);

    expect(rows).toHaveLength(2);
    const cafe = rows.find((r) => r.product_id === 10)!;
    expect(cafe.total_reviews).toBe(2);
    expect(cafe.average_rating).toBe(4.5);
    expect(cafe.stars_5).toBe(1);
    expect(cafe.stars_4).toBe(1);
    expect(cafe.verified_count).toBe(1);
    expect(cafe.pending_count).toBe(0);
    const te = rows.find((r) => r.product_id === 20)!;
    expect(te.pending_count).toBe(1);
    expect(te.last_review_date).toBeInstanceOf(Date);
  });

  it('devuelve arreglo vacío sin reseñas en el rango', async () => {
    prisma.reviews.findMany.mockResolvedValue([]);
    await expect(service.getReviewsByProduct({} as any)).resolves.toEqual([]);
  });

  it('exige contexto de tienda', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(undefined as any);
    await expect(service.getReviewsByProduct({} as any)).rejects.toThrow();
  });
});
