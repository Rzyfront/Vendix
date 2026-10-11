import { ReviewsService } from './reviews.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OrderReviewsQueryDto } from './dto';

describe('ReviewsService.findAllOrderReviews', () => {
  let findMany: jest.Mock;
  let count: jest.Mock;
  let service: ReviewsService;

  beforeEach(() => {
    findMany = jest.fn();
    count = jest.fn().mockResolvedValue(1);
    const prisma: any = {
      order_reviews: { findMany, count },
      store_settings: {
        findFirst: jest
          .fn()
          .mockResolvedValue({
            settings: { general: { timezone: 'America/Bogota' } },
          }),
      },
    };
    service = new ReviewsService(prisma, { emit: jest.fn() } as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 1 } as any);
  });

  it('aplica filtros, rango en TZ tienda y orden created_at desc', async () => {
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);
    await service.findAllOrderReviews({
      page: 2,
      limit: 5,
      rating: 4,
      quick_tag: 'normal',
      date_from: '2026-10-01',
      date_to: '2026-10-02',
    } as any);
    const args = findMany.mock.calls[0][0];
    expect(args.skip).toBe(5);
    expect(args.take).toBe(5);
    expect(args.where.rating).toBe(4);
    expect(args.where.quick_tag).toBe('normal');
    expect(args.orderBy[0]).toEqual({ created_at: 'desc' });
    // Bogotá UTC-5: 2026-10-01 00:00 local = 05:00Z; 2026-10-02 23:59:59.999 = 04:59:59.999Z del 3
    expect(args.where.created_at.gte.toISOString()).toBe(
      '2026-10-01T05:00:00.000Z',
    );
    expect(args.where.created_at.lte.toISOString()).toBe(
      '2026-10-03T04:59:59.999Z',
    );
  });

  it('proyecta AdminOrderReview con nombre de customer o alias', async () => {
    const base = {
      order_id: 1,
      rating: 5,
      quick_tag: null,
      comment: null,
      source: 'order_detail',
      created_at: new Date('2026-10-01T10:00:00Z'),
    };
    findMany.mockResolvedValue([
      {
        ...base,
        id: 1,
        customer: { first_name: 'Ana', last_name: 'Gómez' },
        orders: { order_number: 'A-1', customer_alias: null },
      },
      {
        ...base,
        id: 2,
        customer: null,
        orders: { order_number: 'A-2', customer_alias: 'Mesa 4' },
      },
      {
        ...base,
        id: 3,
        customer: null,
        orders: { order_number: 'A-3', customer_alias: null },
      },
    ]);
    count.mockResolvedValue(3);
    const res = await service.findAllOrderReviews({} as OrderReviewsQueryDto);
    expect(res.data.map((d: any) => d.customer_name)).toEqual([
      'Ana Gómez',
      'Mesa 4',
      null,
    ]);
    expect(res.data[0]).toEqual({
      ...base,
      id: 1,
      order_number: 'A-1',
      customer_name: 'Ana Gómez',
    });
    expect(res.meta).toEqual({ total: 3, page: 1, limit: 10, totalPages: 1 });
  });
});
