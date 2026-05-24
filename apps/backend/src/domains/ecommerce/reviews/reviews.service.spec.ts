import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes } from 'src/common/errors';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { EcommerceReviewsService } from './reviews.service';

describe('EcommerceReviewsService', () => {
  let service: EcommerceReviewsService;
  let prisma: {
    store_settings: { findFirst: jest.Mock };
    reviews: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    orders: { findFirst: jest.Mock };
    products: { findFirst: jest.Mock };
    users: { findFirst: jest.Mock };
    review_votes: {
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
    };
    review_reports: {
      findFirst: jest.Mock;
      create: jest.Mock;
    };
  };
  let eventEmitter: { emit: jest.Mock };

  const requestContext = {
    user_id: 7,
    store_id: 11,
    is_super_admin: false,
    is_owner: false,
  };

  const enabledSettings = {
    settings: { ecommerce: { catalog: { allow_reviews: true } } },
  };

  const disabledSettings = {
    settings: { ecommerce: { catalog: { allow_reviews: false } } },
  };

  beforeEach(() => {
    prisma = {
      store_settings: { findFirst: jest.fn().mockResolvedValue(enabledSettings) },
      reviews: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orders: { findFirst: jest.fn() },
      products: { findFirst: jest.fn() },
      users: { findFirst: jest.fn() },
      review_votes: {
        findFirst: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      review_reports: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };
    eventEmitter = { emit: jest.fn() };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(requestContext);

    service = new EcommerceReviewsService(
      prisma as unknown as EcommercePrismaService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns an empty disabled response when public reviews are off', async () => {
    prisma.store_settings.findFirst.mockResolvedValueOnce(disabledSettings);

    const result = await service.getProductReviews({
      product_id: 100,
      page: 2,
      limit: 5,
    });

    expect(result).toEqual({
      enabled: false,
      reviews: [],
      meta: { total: 0, page: 2, limit: 5, totalPages: 0 },
      rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      avg_rating: 0,
      total_count: 0,
    });
    expect(prisma.reviews.findMany).not.toHaveBeenCalled();
    expect(prisma.reviews.count).not.toHaveBeenCalled();
  });

  it('marks canReview as disabled when store settings block reviews', async () => {
    prisma.store_settings.findFirst.mockResolvedValueOnce(disabledSettings);

    await expect(service.canReview(100)).resolves.toEqual({
      can_review: false,
      reason: 'reviews_disabled',
    });
    expect(prisma.orders.findFirst).not.toHaveBeenCalled();
  });

  it('creates verified ecommerce reviews as approved after a delivered purchase', async () => {
    prisma.orders.findFirst.mockResolvedValue({ id: 1 });
    prisma.reviews.findFirst.mockResolvedValue(null);
    prisma.reviews.count.mockResolvedValue(0);
    prisma.products.findFirst.mockResolvedValue({ name: 'Producto' });
    prisma.users.findFirst.mockResolvedValue({
      first_name: 'Ana',
      last_name: 'Diaz',
    });
    prisma.reviews.create.mockResolvedValue({
      id: 55,
      product_id: 100,
      user_id: 7,
      rating: 5,
      state: 'approved',
    });

    const result = await service.create({
      product_id: 100,
      rating: 5,
      comment: 'Excelente producto',
    });

    expect(prisma.reviews.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        product_id: 100,
        user_id: 7,
        rating: 5,
        verified_purchase: true,
        state: 'approved',
      }),
    });
    expect(result.state).toBe('approved');
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'review.created',
      expect.objectContaining({
        store_id: 11,
        review_id: 55,
        product_id: 100,
        rating: 5,
      }),
    );
  });

  it('blocks public vote writes when reviews are disabled', async () => {
    prisma.store_settings.findFirst.mockResolvedValueOnce(disabledSettings);

    await expect(service.vote(55, { is_helpful: true })).rejects.toMatchObject({
      errorCode: ErrorCodes.REV_DISABLED_001.code,
    });
    expect(prisma.review_votes.findFirst).not.toHaveBeenCalled();
  });
});
