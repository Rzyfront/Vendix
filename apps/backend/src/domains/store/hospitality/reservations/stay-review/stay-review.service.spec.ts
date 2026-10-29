import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from 'src/common/errors';
import { LodgingGuestsService } from '../guests/guests.service';
import { LodgingPrecheckinService } from '../precheckin/precheckin.service';
import { LodgingStayReviewService } from './stay-review.service';
import { stayReviewOpen } from './stay-review';

const TOKEN = 'tok_abc';

/** Reservation H-0007 of store 5 with its folio order 300 (store today 2026-11-20). */
function build(
  options: {
    status?: string;
    departure?: string;
    folio?: boolean;
    reviewed?: boolean;
    domain?: string | null;
    raceDuplicate?: boolean;
  } = {},
) {
  const review = options.reviewed
    ? { id: 40, rating: 4, comment: 'Todo bien', created_at: new Date('2026-11-16T12:00:00.000Z') }
    : null;
  const reservation = {
    id: 1,
    status: options.status ?? 'checked_out',
    reservation_number: 'H-0007',
    arrival_date: new Date('2026-11-12T00:00:00.000Z'),
    departure_date: new Date(`${options.departure ?? '2026-11-14'}T00:00:00.000Z`),
    precheckin_token: TOKEN,
    folio:
      options.folio === false ? null : { order: { id: 300, customer_id: 90, order_review: review } },
  };
  const prisma = {
    lodging_reservations: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.id === 1) return reservation;
        if (where.precheckin_token && where.precheckin_token === reservation.precheckin_token) {
          return reservation;
        }
        return null;
      }),
      update: jest.fn(),
    },
    order_reviews: {
      create: jest.fn(async ({ data }: any) => {
        if (options.raceDuplicate) {
          throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
        }
        return { rating: data.rating, comment: data.comment, created_at: new Date() };
      }),
    },
    domain_settings: {
      findFirst: jest.fn(async () =>
        options.domain === null ? null : { hostname: options.domain ?? 'roku.vendix.com' },
      ),
    },
    stores: { findFirst: jest.fn(async () => ({ name: 'Hotel Roku' })) },
    store_settings: {
      findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })),
    },
  };
  const precheckin = new LodgingPrecheckinService(prisma as any, new LodgingGuestsService(prisma as any));
  const service = new LodgingStayReviewService(prisma as any, precheckin);
  return { service, prisma };
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as VendixHttpException;
  }
  throw new Error('expected an error');
}

describe('Stay rating link window (H8.5)', () => {
  const departure = new Date('2026-11-14T00:00:00.000Z');

  it('opens only after check-out', () => {
    expect(stayReviewOpen({ status: 'checked_out', departure_date: departure }, '2026-11-14')).toBe(true);
    expect(stayReviewOpen({ status: 'checked_in', departure_date: departure }, '2026-11-14')).toBe(false);
    expect(stayReviewOpen({ status: 'cancelled', departure_date: departure }, '2026-11-14')).toBe(false);
  });

  it('closes 30 days after the departure day', () => {
    expect(stayReviewOpen({ status: 'checked_out', departure_date: departure }, '2026-12-14')).toBe(true);
    expect(stayReviewOpen({ status: 'checked_out', departure_date: departure }, '2026-12-15')).toBe(false);
  });
});

describe('LodgingStayReviewService (H8.5)', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-20T15:00:00.000Z'), doNotFake: ['nextTick'] });
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 5 } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('gives the thank-you email the rating link on the storefront, with the guest token', async () => {
    const { service } = build();
    await expect(service.linkFor(1)).resolves.toBe(`https://roku.vendix.com/calificar-estadia/${TOKEN}`);
  });

  it('gives no link while the guest is in-house, without a folio or once rated', async () => {
    await expect(build({ status: 'checked_in' }).service.linkFor(1)).resolves.toBeNull();
    await expect(build({ folio: false }).service.linkFor(1)).resolves.toBeNull();
    await expect(build({ reviewed: true }).service.linkFor(1)).resolves.toBeNull();
  });

  it('opens the page without login and without personal data', async () => {
    const data = await build().service.findByToken(TOKEN);
    expect(data).toEqual({
      store_name: 'Hotel Roku',
      reservation_number: 'H-0007',
      arrival_date: '2026-11-12',
      departure_date: '2026-11-14',
      review: null,
    });
  });

  it('saves the private rating on the folio order, once', async () => {
    const { service, prisma } = build();
    const saved = await service.submit(TOKEN, { rating: 2, comment: 'La ducha no calentaba' });
    expect(prisma.order_reviews.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          store_id: 5,
          order_id: 300,
          customer_id: 90,
          rating: 2,
          comment: 'La ducha no calentaba',
          source: 'stay_review',
        },
      }),
    );
    expect(saved).toMatchObject({ rating: 2, comment: 'La ducha no calentaba' });
  });

  it('refuses a second rating of the same stay', async () => {
    const { service, prisma } = build({ reviewed: true });
    expect((await errorOf(service.submit(TOKEN, { rating: 5 }))).errorCode).toBe('LODGING_STAY_REVIEW_DUP_001');
    expect(prisma.order_reviews.create).not.toHaveBeenCalled();
    // Two tabs sending at once: the unique order_id turns the second into the same refusal.
    const race = build({ raceDuplicate: true });
    expect((await errorOf(race.service.submit(TOKEN, { rating: 5 }))).errorCode).toBe('LODGING_STAY_REVIEW_DUP_001');
  });

  it('an unknown token, an in-house stay or an old stay cannot be rated', async () => {
    const { service } = build();
    expect((await errorOf(service.findByToken('other'))).errorCode).toBe('LODGING_STAY_REVIEW_FIND_001');
    expect((await errorOf(build({ status: 'checked_in' }).service.submit(TOKEN, { rating: 5 }))).errorCode).toBe(
      'LODGING_STAY_REVIEW_CLOSED_001',
    );
    expect((await errorOf(build({ departure: '2026-10-01' }).service.findByToken(TOKEN))).errorCode).toBe(
      'LODGING_STAY_REVIEW_CLOSED_001',
    );
  });
});
