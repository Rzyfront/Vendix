/**
 * Adversarial QA spec for BookingConfirmationService (email confirm/cancel
 * tokens). Assertions describe the CORRECT business behavior; a failing test
 * is a finding. Uses a STABLE `withoutScope()` client so overrides stick.
 */
import { BookingConfirmationService } from './booking-confirmation.service';
import { VendixHttpException } from '../../../common/errors';

type Row = Record<string, any>;

function build(opts: { bookingStatus?: string } = {}) {
  const booking: Row = {
    id: 42,
    store_id: 1,
    booking_number: 'BKG-42',
    product_id: 10,
    provider_id: 5,
    start_time: '10:00',
    end_time: '11:00',
    date: new Date('2026-11-05T00:00:00Z'),
    status: opts.bookingStatus ?? 'pending',
    customer: { first_name: 'Juan', last_name: 'Pérez' },
    product: { name: 'Corte' },
  };
  const tokens: Row[] = [
    { id: 1, token: 'confirm-tkn', action: 'confirm', used: false, booking_id: 42 },
    { id: 2, token: 'cancel-tkn', action: 'cancel', used: false, booking_id: 42 },
  ].map((t) => ({ ...t, expires_at: new Date(Date.now() + 3_600_000) }));

  const unscoped: any = {
    booking_confirmation_tokens: {
      findUnique: jest.fn(({ where }: any) => {
        const t = tokens.find((x) => x.token === where.token);
        // Return a snapshot, like a real DB read.
        return Promise.resolve(t ? { ...t, booking: { ...booking } } : null);
      }),
      update: jest.fn(({ where, data }: any) => {
        const t = tokens.find((x) => x.id === where.id);
        Object.assign(t!, data);
        return Promise.resolve(t);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        const hit = tokens.filter(
          (x) => x.id === where.id && (where.used === undefined || x.used === where.used),
        );
        hit.forEach((x) => Object.assign(x, data));
        return Promise.resolve({ count: hit.length });
      }),
    },
    bookings: {
      update: jest.fn(({ data }: any) => {
        Object.assign(booking, data);
        return Promise.resolve(booking);
      }),
      updateMany: jest.fn(({ data }: any) => {
        Object.assign(booking, data);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  // Interactive transaction: the callback runs against the same client.
  unscoped.$transaction = jest.fn((cb: (tx: any) => any) => cb(unscoped));
  const prisma: any = {
    withoutScope: () => unscoped,
    bookings: {
      findUnique: jest.fn().mockResolvedValue(booking),
      update: jest.fn().mockResolvedValue(booking),
    },
    booking_confirmation_tokens: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const emits: string[] = [];
  const eventEmitter: any = { emit: jest.fn((n: string) => emits.push(n)) };
  const availabilityService: any = { isSlotAvailable: jest.fn().mockResolvedValue(true) };
  // Cancel-by-link reuses the staff cancel effects (order release + event).
  const reservationsService: any = {
    completeLinkCancellation: jest.fn(() => {
      emits.push('booking.cancelled');
      return Promise.resolve(booking);
    }),
  };
  const storeContextRunner: any = {
    runInStoreContext: jest.fn((_id: number, cb: () => any) => cb()),
  };
  const service = new BookingConfirmationService(
    prisma,
    eventEmitter,
    availabilityService,
    reservationsService,
    storeContextRunner,
  );
  return { service, booking, tokens, emits, unscoped, prisma };
}

describe('BookingConfirmationService (adversarial)', () => {
  it('rejects an expired token without touching the booking', async () => {
    const { service, tokens, booking } = build();
    tokens[0].expires_at = new Date(Date.now() - 1000);
    await expect(service.processToken('confirm-tkn')).rejects.toBeInstanceOf(VendixHttpException);
    expect(booking.status).toBe('pending');
  });

  it('rejects an already used token', async () => {
    const { service, tokens } = build();
    tokens[0].used = true;
    await expect(service.processToken('confirm-tkn')).rejects.toBeInstanceOf(VendixHttpException);
  });

  it('a confirm link clicked AFTER the cancel link must not resurrect the cancelled booking', async () => {
    const { service, booking } = build();
    await service.processToken('cancel-tkn');
    expect(booking.status).toBe('cancelled');
    await service.processToken('confirm-tkn').catch(() => undefined);
    expect(booking.status).toBe('cancelled');
  });

  it.each(['completed', 'no_show', 'cancelled', 'in_progress'])(
    'a confirm token does not overwrite a %s booking',
    async (status) => {
      const { service, booking } = build({ bookingStatus: status });
      await service.processToken('confirm-tkn').catch(() => undefined);
      expect(booking.status).toBe(status);
    },
  );

  it.each(['completed', 'no_show', 'in_progress'])(
    'a cancel token does not cancel a %s booking',
    async (status) => {
      const { service, booking } = build({ bookingStatus: status });
      await service.processToken('cancel-tkn').catch(() => undefined);
      expect(booking.status).toBe(status);
    },
  );

  it('two concurrent clicks on the same confirm link apply the side effects only once', async () => {
    const { service, emits } = build();
    const results = await Promise.allSettled([
      service.processToken('confirm-tkn'),
      service.processToken('confirm-tkn'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(emits.filter((e) => e === 'booking.confirmed')).toHaveLength(1);
  });

  it('does not send a confirmation request for a cancelled booking', async () => {
    const { service, booking, prisma } = build({ bookingStatus: 'cancelled' });
    void booking;
    await service.sendConfirmationRequest(42).catch(() => undefined);
    expect(prisma.booking_confirmation_tokens.createMany).not.toHaveBeenCalled();
  });
});
