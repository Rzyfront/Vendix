import { ReviewsAnalyticsService } from './reviews-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. `reviews` carries both the raw delegation
 * methods (groupBy/aggregate/count) used by getReviewsSummary and findMany used
 * by getReviewsByProduct; `$queryRaw` is shared between the scoped client and
 * `withoutScope()` so the trend can be stubbed on the same function.
 */
type MockStorePrismaService = {
  reviews: {
    findMany: jest.Mock;
    groupBy: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  store_settings: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
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
      reviews: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      store_settings: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    // Sin timezone en tienda -> DEFAULT_STORE_TIMEZONE ('America/Bogota').
    prisma.store_settings.findFirst.mockResolvedValue(null);
    const queryRawMock = prisma.$queryRaw;
    prisma.withoutScope.mockReturnValue({ $queryRaw: queryRawMock });

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

describe('ReviewsAnalyticsService summary + trend (QUI-629)', () => {
  let service: ReviewsAnalyticsService;
  let prisma: MockStorePrismaService;

  const QUERY = { date_from: '2026-07-08', date_to: '2026-07-08' };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      reviews: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      store_settings: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    prisma.store_settings.findFirst.mockResolvedValue(null);

    // Share the same $queryRaw mock across `prisma.$queryRaw` and the
    // `withoutScope()` client. Tests set per-call responses via
    // mockResolvedValueOnce on the shared function.
    const queryRawMock = prisma.$queryRaw;
    prisma.withoutScope.mockReturnValue({ $queryRaw: queryRawMock });

    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, is_super_admin: false, is_owner: false });

    service = new ReviewsAnalyticsService(prisma as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('QUI-629: average and histogram consider ONLY approved reviews (the ones visible in the store)', async () => {
    // Server-side aggregation: the OLD code reduced over ALL reviews in the
    // window, so 3 rejected 1★ reviews dragged a 5★ product down. The new
    // contract excludes every non-approved row from average AND distribution.
    prisma.reviews.groupBy
      .mockResolvedValueOnce([
        { state: 'pending', _count: { _all: 2 } },
        { state: 'approved', _count: { _all: 5 } },
        { state: 'rejected', _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { rating: 5, _count: { _all: 4 } },
        { rating: 4, _count: { _all: 1 } },
      ]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: 4.8 }, _count: { _all: 5 } }) // avg perfil
      .mockResolvedValueOnce({ _sum: { helpful_count: 12 } }) // helpful votes
      .mockResolvedValueOnce({ _avg: { rating: 4.0 }, _count: { _all: 3 } }); // período anterior
    prisma.reviews.count
      .mockResolvedValueOnce(4) // verified & approved
      .mockResolvedValueOnce(8); // total anterior

    const result = await service.getReviewsSummary(QUERY as any);

    // average only over approved (5 × 5★ + 1 × 4★ = 29 / 5 = 4.8), one decimal
    expect(result.average_rating).toBe(4.8);
    // rejected never leaks into the distribution
    expect(result.rating_distribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 4 });
    // state counts are operational, separate from the score contract
    expect(result.approved_reviews).toBe(5);
    expect(result.pending_reviews).toBe(2);
    expect(result.rejected_reviews).toBe(3);
    expect(result.total_reviews).toBe(10);
    expect(result.total_helpful_votes).toBe(12);
  });

  it('QUI-629: verified_purchase_rate uses approved as denominator', async () => {
    prisma.reviews.groupBy
      .mockResolvedValueOnce([{ state: 'approved', _count: { _all: 10 } }])
      .mockResolvedValueOnce([
        { rating: 5, _count: { _all: 6 } },
        { rating: 4, _count: { _all: 4 } },
      ]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: 4.6 }, _count: { _all: 10 } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 0 } })
      .mockResolvedValueOnce({ _avg: { rating: null }, _count: { _all: 0 } });
    prisma.reviews.count
      .mockResolvedValueOnce(7) // 7 of 10 approved are verified → 70.00
      .mockResolvedValueOnce(0);

    const result = await service.getReviewsSummary(QUERY as any);

    expect(result.verified_purchases).toBe(7);
    expect(result.verified_purchase_rate).toBe(70);
  });

  it('QUI-629: verified_purchase_rate is null (not 0%) when no approved reviews exist', async () => {
    prisma.reviews.groupBy
      .mockResolvedValueOnce([{ state: 'pending', _count: { _all: 1 } }])
      .mockResolvedValueOnce([]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: null }, _count: { _all: 0 } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 0 } })
      .mockResolvedValueOnce({ _avg: { rating: null }, _count: { _all: 0 } });
    prisma.reviews.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const result = await service.getReviewsSummary(QUERY as any);

    expect(result.average_rating).toBe(0);
    expect(result.verified_purchase_rate).toBeNull();
  });

  it('QUI-629: growth is null when the previous period has no base (no fake 0%)', async () => {
    prisma.reviews.groupBy
      .mockResolvedValueOnce([{ state: 'approved', _count: { _all: 4 } }])
      .mockResolvedValueOnce([{ rating: 5, _count: { _all: 4 } }]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: 5 }, _count: { _all: 4 } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 0 } })
      .mockResolvedValueOnce({ _avg: { rating: null }, _count: { _all: 0 } });
    prisma.reviews.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

    const result = await service.getReviewsSummary(QUERY as any);

    expect(result.total_reviews_growth).toBeNull();
    expect(result.average_rating_growth).toBeNull();
  });

  it('QUI-629: growth vs previous period is computed from comparable bases', async () => {
    prisma.reviews.groupBy
      .mockResolvedValueOnce([{ state: 'approved', _count: { _all: 6 } }])
      .mockResolvedValueOnce([{ rating: 5, _count: { _all: 5 } }, { rating: 3, _count: { _all: 1 } }]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: 4.666666666666667 }, _count: { _all: 6 } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 3 } })
      .mockResolvedValueOnce({ _avg: { rating: 3.5 }, _count: { _all: 4 } });
    prisma.reviews.count.mockResolvedValueOnce(3).mockResolvedValueOnce(4);

    const result = await service.getReviewsSummary(QUERY as any);

    // avg 4.6667 → emitted as 4.7 (1 decimal)
    expect(result.average_rating).toBe(4.7);
    // Growth runs on the RAW average, not the rounded display value — rounding
    // first would make the growth depend on display precision. And as every
    // sibling service does, `computeGrowth` is emitted unrounded.
    // (4.666666… - 3.5) / 3.5 * 100 = 33.3333…%
    expect(result.average_rating_growth).toBeCloseTo(33.333333, 4);
    // total 6 vs prev 4 → 50%
    expect(result.total_reviews_growth).toBe(50);
  });

  it.each([
    { current: 0, previous: 0, expected: null },
    { current: 0, previous: 3, expected: null },
    { current: 2, previous: 0, expected: null },
    { current: 2, previous: 3, expected: 25 },
  ])('rating growth requires approved reviews in BOTH periods: $current / $previous', async ({ current, previous, expected }) => {
    prisma.reviews.groupBy
      .mockResolvedValueOnce([
        { state: 'approved', _count: { _all: current } },
        { state: 'pending', _count: { _all: 2 } },
        { state: 'rejected', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce(current ? [{ rating: 5, _count: { _all: current } }] : []);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: current ? 5 : null } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 0 } })
      .mockResolvedValueOnce({ _avg: { rating: previous ? 4 : null }, _count: { _all: previous } });
    prisma.reviews.count.mockResolvedValueOnce(0).mockResolvedValueOnce(6);

    const result = await service.getReviewsSummary(QUERY as any);

    expect(result.average_rating_growth).toBe(expected);
    expect(result.average_rating).toBe(current ? 5 : 0);
    expect(result.total_reviews).toBe(current + 3);
    expect(result.total_reviews_growth).toBe(((current + 3 - 6) / 6) * 100);
  });

  it('keeps -100% count growth when the current period is empty, without inventing rating growth', async () => {
    prisma.reviews.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: null } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 0 } })
      .mockResolvedValueOnce({ _avg: { rating: 4 }, _count: { _all: 3 } });
    prisma.reviews.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);

    const result = await service.getReviewsSummary(QUERY as any);

    expect(result.total_reviews).toBe(0);
    expect(result.total_reviews_growth).toBe(-100);
    expect(result.average_rating_growth).toBeNull();
    expect(result.verified_purchase_rate).toBeNull();
  });

  it.each([
    { timezone: 'America/Bogota', start: '2026-07-08T05:00:00.000Z', end: '2026-07-09T04:59:59.999Z', previousStart: '2026-07-07T05:00:00.000Z', previousEnd: '2026-07-08T04:59:59.999Z' },
    { timezone: 'America/New_York', start: '2026-07-08T04:00:00.000Z', end: '2026-07-09T03:59:59.999Z', previousStart: '2026-07-07T04:00:00.000Z', previousEnd: '2026-07-08T03:59:59.999Z' },
  ])('uses the same store-local window and approved filter in both rating bases: $timezone', async ({ timezone, start, end, previousStart, previousEnd }) => {
    prisma.store_settings.findFirst.mockResolvedValue({ stores: { timezone } });
    prisma.reviews.groupBy
      .mockResolvedValueOnce([{ state: 'approved', _count: { _all: 2 } }])
      .mockResolvedValueOnce([{ rating: 5, _count: { _all: 2 } }]);
    prisma.reviews.aggregate
      .mockResolvedValueOnce({ _avg: { rating: 5 } })
      .mockResolvedValueOnce({ _sum: { helpful_count: 0 } })
      .mockResolvedValueOnce({ _avg: { rating: 4 }, _count: { _all: 2 } });
    prisma.reviews.count.mockResolvedValueOnce(1).mockResolvedValueOnce(4);

    await service.getReviewsSummary(QUERY as any);

    const currentWindow = { gte: new Date(start), lte: new Date(end) };
    const previousWindow = { gte: new Date(previousStart), lte: new Date(previousEnd) };
    expect(prisma.reviews.groupBy.mock.calls[0][0].where).toEqual({ store_id: 10, created_at: currentWindow });
    expect(prisma.reviews.groupBy.mock.calls[1][0].where).toEqual({ store_id: 10, state: 'approved', created_at: currentWindow });
    expect(prisma.reviews.aggregate.mock.calls[0][0].where).toEqual({ store_id: 10, state: 'approved', created_at: currentWindow });
    expect(prisma.reviews.aggregate.mock.calls[2][0].where).toEqual({ store_id: 10, state: 'approved', created_at: previousWindow });
    expect(prisma.reviews.count.mock.calls[0][0].where).toEqual({ store_id: 10, state: 'approved', verified_purchase: true, created_at: currentWindow });
    expect(prisma.reviews.count.mock.calls[1][0].where).toEqual({ store_id: 10, created_at: previousWindow });
  });

  it('rejects summary and trend without store context before accessing Prisma', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(undefined as any);
    await expect(service.getReviewsSummary(QUERY as any)).rejects.toThrow();
    await expect(service.getRatingTrend(QUERY as any)).rejects.toThrow();
    expect(prisma.store_settings.findFirst).not.toHaveBeenCalled();
    expect(prisma.reviews.aggregate).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('QUI-629: rating trend returns periods with average + count from raw aggregation', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([
      { period: '2026-07-06', average_rating: '5.000', review_count: 2n },
      { period: '2026-07-07', average_rating: '4.500', review_count: 4n },
    ]);

    const result = await service.getRatingTrend({
      ...(QUERY as any),
      granularity: 'day',
    });

    expect(result).toEqual([
      { period: '2026-07-06', average_rating: 5, review_count: 2 },
      { period: '2026-07-07', average_rating: 4.5, review_count: 4 },
    ]);
    // `withoutScope()` + explicit `r.store_id` filter: the raw SQL never
    // relies on the scoped client to hide another tenant's reviews.
    expect(prisma.withoutScope).toHaveBeenCalled();
    const [sql, , storeId, startDate, endDate] = prisma.$queryRaw.mock.calls[0];
    expect(sql.join('')).toContain("AND r.state = 'approved'");
    expect(sql.join('')).toContain('WHERE r.store_id =');
    expect(storeId).toBe(10);
    expect(startDate).toEqual(new Date('2026-07-08T05:00:00.000Z'));
    expect(endDate).toEqual(new Date('2026-07-09T04:59:59.999Z'));
  });
});
