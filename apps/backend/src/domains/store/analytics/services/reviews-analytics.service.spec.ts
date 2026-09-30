import { ReviewsAnalyticsService } from './reviews-analytics.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Mock shape for StorePrismaService. Only the delegates touched by
 * ReviewsAnalyticsService are declared; everything else is `any` so the
 * service constructor accepts it. `reviews` is mocked with the raw delegation
 * methods; `$queryRaw` is shared between the scoped client and `withoutScope()`.
 */
type MockStorePrismaService = {
  store_settings: { findFirst: jest.Mock };
  reviews: {
    groupBy: jest.Mock;
    aggregate: jest.Mock;
    count: jest.Mock;
  };
  $queryRaw: jest.Mock;
  withoutScope: jest.Mock;
} & Partial<StorePrismaService>;

describe('ReviewsAnalyticsService (QUI-629)', () => {
  let service: ReviewsAnalyticsService;
  let prisma: MockStorePrismaService;

  const QUERY = { date_from: '2026-07-08', date_to: '2026-07-08' };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      store_settings: { findFirst: jest.fn() },
      reviews: {
        groupBy: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      $queryRaw: jest.fn(),
      withoutScope: jest.fn(),
    } as MockStorePrismaService;

    prisma.store_settings.findFirst.mockResolvedValue(null);

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

    // avg 4.67 → 1 decimal 4.7; prev avg 3.5 → growth (4.7-3.5)/3.5 = 34.29%
    expect(result.average_rating).toBe(4.7);
    expect(result.average_rating_growth).toBeCloseTo(34.285714, 3);
    // total 6 vs prev 4 → 50%
    expect(result.total_reviews_growth).toBe(50);
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
  });
});