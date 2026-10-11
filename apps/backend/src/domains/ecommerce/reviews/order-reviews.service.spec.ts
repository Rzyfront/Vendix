import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { OrderReviewsService } from './order-reviews.service';

describe('OrderReviewsService', () => {
  let service: OrderReviewsService;
  let base: {
    invoice_data_requests: { findFirst: jest.Mock };
    orders: { findFirst: jest.Mock };
  };
  let prisma: any;
  let reviews_service: any;
  let s3: { signUrl: jest.Mock };

  const baseOrder = (over: Record<string, unknown> = {}) => ({
    id: 50,
    store_id: 11,
    order_number: 'ORD-50',
    state: 'pending_payment',
    customer_id: 7,
    order_items: [
      {
        product_id: 1,
        product_name: 'Cafe',
        products: { name: 'Cafe', product_images: [{ image_url: 'k/a.png' }] },
      },
      { product_id: 1, product_name: 'Cafe', products: null },
    ],
    ...over,
  });

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    await expect(promise).rejects.toMatchObject({ errorCode: code });
  };

  beforeEach(() => {
    base = {
      invoice_data_requests: {
        findFirst: jest.fn().mockResolvedValue({ order_id: 50 }),
      },
      orders: { findFirst: jest.fn().mockResolvedValue(baseOrder()) },
    };
    prisma = {
      withoutScope: jest.fn().mockReturnValue(base),
      orders: { findFirst: jest.fn().mockResolvedValue(baseOrder()) },
      order_reviews: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 1,
          created_at: new Date('2026-01-01T00:00:00Z'),
          ...data,
        })),
      },
      reviews: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 9,
          ...data,
        })),
      },
    };
    reviews_service = {
      areReviewsEnabled: jest.fn().mockResolvedValue(true),
      assertDailyLimit: jest.fn().mockResolvedValue(undefined),
      emitReviewCreated: jest.fn().mockResolvedValue(undefined),
    };
    s3 = { signUrl: jest.fn().mockResolvedValue('https://signed/a.png') };
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 11, user_id: 7 } as any);
    service = new OrderReviewsService(prisma, reviews_service, s3 as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('status con orden pending: experiencia si, productos not_delivered', async () => {
    const status = await service.getStatus({ token: 'tok' });
    expect(base.invoice_data_requests.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'tok', store_id: 11 } }),
    );
    expect(status.can_review_experience).toBe(true);
    expect(status.order_review).toBeNull();
    expect(status.items).toHaveLength(1);
    expect(status.items[0]).toMatchObject({
      product_id: 1,
      can_review: false,
      reason: 'not_delivered',
      image_url: 'https://signed/a.png',
    });
  });

  it('token inexistente -> 404 ORD_REVIEW_NOT_FOUND', async () => {
    base.invoice_data_requests.findFirst.mockResolvedValue(null);
    await expectCode(
      service.getStatus({ token: 'nope' }),
      'ORD_REVIEW_NOT_FOUND',
    );
  });

  it('orden de otro cliente por id -> 404 ORD_REVIEW_NOT_FOUND', async () => {
    prisma.orders.findFirst.mockResolvedValue(null);
    await expectCode(
      service.getStatus({ order_id: 999 }),
      'ORD_REVIEW_NOT_FOUND',
    );
  });

  it('crear experiencia OK guarda customer_id de la orden y source default', async () => {
    const result = await service.createExperience(
      { token: 'tok' },
      { rating: 5, quick_tag: 'very_easy' as any },
    );
    expect(prisma.order_reviews.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 11,
        order_id: 50,
        customer_id: 7,
        rating: 5,
        source: 'order_detail',
      }),
    });
    expect(result).toMatchObject({ order_id: 50, rating: 5 });
  });

  it('experiencia duplicada -> 409 ORD_REVIEW_ALREADY_EXISTS', async () => {
    prisma.order_reviews.findFirst.mockResolvedValue({ id: 3 });
    await expectCode(
      service.createExperience({ token: 'tok' }, { rating: 4 }),
      'ORD_REVIEW_ALREADY_EXISTS',
    );
  });

  it('P2002 por carrera -> 409 ORD_REVIEW_ALREADY_EXISTS', async () => {
    prisma.order_reviews.create.mockRejectedValue({ code: 'P2002' });
    await expectCode(
      service.createExperience({ token: 'tok' }, { rating: 4 }),
      'ORD_REVIEW_ALREADY_EXISTS',
    );
  });

  it('orden cancelada -> 400 ORD_REVIEW_ORDER_INVALID_STATE', async () => {
    base.orders.findFirst.mockResolvedValue(baseOrder({ state: 'cancelled' }));
    await expectCode(
      service.createExperience({ token: 'tok' }, { rating: 4 }),
      'ORD_REVIEW_ORDER_INVALID_STATE',
    );
    expect(prisma.order_reviews.create).not.toHaveBeenCalled();
  });

  it('producto fuera de la orden -> 400 ORD_REVIEW_PRODUCT_NOT_IN_ORDER', async () => {
    base.orders.findFirst.mockResolvedValue(baseOrder({ state: 'delivered' }));
    await expectCode(
      service.createProductReview(
        { token: 'tok' },
        { product_id: 77, rating: 5, comment: 'comentario largo ok' },
      ),
      'ORD_REVIEW_PRODUCT_NOT_IN_ORDER',
    );
  });

  it('producto en orden no entregada -> 400 ORD_REVIEW_PRODUCT_NOT_ALLOWED', async () => {
    await expectCode(
      service.createProductReview(
        { token: 'tok' },
        { product_id: 1, rating: 5, comment: 'comentario largo ok' },
      ),
      'ORD_REVIEW_PRODUCT_NOT_ALLOWED',
    );
  });

  it('producto con orden delivered -> crea pending con order_id y emite evento', async () => {
    base.orders.findFirst.mockResolvedValue(baseOrder({ state: 'delivered' }));
    const review = await service.createProductReview(
      { token: 'tok' },
      { product_id: 1, rating: 5, comment: 'comentario largo ok' },
    );
    expect(prisma.reviews.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        product_id: 1,
        user_id: 7,
        order_id: 50,
        state: 'pending',
        verified_purchase: true,
      }),
    });
    expect(reviews_service.assertDailyLimit).toHaveBeenCalledWith(7);
    expect(reviews_service.emitReviewCreated).toHaveBeenCalledWith(
      expect.objectContaining({ review_id: 9, product_id: 1, user_id: 7 }),
    );
    expect(review).toMatchObject({ id: 9, order_id: 50 });
  });
});
