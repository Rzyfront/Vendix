import { BookingConfirmationService } from './booking-confirmation.service';
import { VendixHttpException } from '../../../common/errors';

describe('BookingConfirmationService.processToken (double-validation)', () => {
  function buildService(
    opts: { slotAvailable?: boolean; bookingStatus?: string } = {},
  ) {
    const tokenRecord = (overrides: any = {}) => ({
      id: 1,
      token: 'tkn',
      booking_id: 42,
      used: false,
      expires_at: new Date(Date.now() + 60_000),
      action: 'confirm',
      booking: {
        id: 42,
        store_id: 1,
        booking_number: 'BKG-42',
        product_id: 10,
        product_variant_id: null,
        provider_id: 5,
        customer_id: 7,
        status: opts.bookingStatus ?? 'pending',
        start_time: '10:00',
        end_time: '11:00',
        date: new Date('2026-07-18T00:00:00Z'),
        customer: { first_name: 'Juan', last_name: 'Pérez' },
        product: { name: 'Corte' },
      },
      ...overrides,
    });

    // Stable client: `withoutScope()` must return the same object so the
    // per-test overrides below actually apply.
    const unscoped: any = {
      booking_confirmation_tokens: {
        findUnique: jest.fn().mockResolvedValue(tokenRecord()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      bookings: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    unscoped.$transaction = jest.fn((cb: (tx: any) => any) => cb(unscoped));
    const prisma: any = { withoutScope: () => unscoped };

    const isSlotAvailable = jest
      .fn()
      .mockResolvedValue(opts.slotAvailable ?? true);
    const availabilityService: any = { isSlotAvailable };

    const emits: any[] = [];
    const eventEmitter: any = {
      emit: jest.fn((name: string, payload: any) => {
        emits.push({ name, payload });
      }),
    };

    // Cancel-by-link reuses the staff cancel effects, which emit the event.
    const reservationsService: any = {
      completeLinkCancellation: jest.fn().mockImplementation(() => {
        emits.push({ name: 'booking.cancelled', payload: { booking_id: 42 } });
        return Promise.resolve({ id: 42 });
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

    return { service, isSlotAvailable, emits, unscoped, tokenRecord };
  }

  it('confirms and emits booking.confirmed when the slot is still free', async () => {
    const { service, isSlotAvailable, emits } = buildService({ slotAvailable: true });
    const result = await service.processToken('tkn');
    expect(result).toMatchObject({ action: 'confirm', booking_id: 42 });
    expect(isSlotAvailable).toHaveBeenCalled();
    expect(emits.map((e) => e.name)).toEqual(['booking.confirmed']);
  });

  it('still confirms and emits booking.double_booking when the slot is taken (decision: alert staff)', async () => {
    const { service, emits } = buildService({ slotAvailable: false });
    const result = await service.processToken('tkn');
    expect(result.action).toBe('confirm');
    // Both events fired — staff gets a heads-up.
    expect(emits.map((e) => e.name).sort()).toEqual([
      'booking.confirmed',
      'booking.double_booking',
    ]);
    expect(emits.find((e) => e.name === 'booking.double_booking')?.payload).toMatchObject({
      booking_id: 42,
      booking_number: 'BKG-42',
    });
  });

  it('emits booking.cancelled when token is cancel', async () => {
    const { service, emits, unscoped, tokenRecord } = buildService();
    unscoped.booking_confirmation_tokens.findUnique.mockResolvedValue(
      tokenRecord({ action: 'cancel' }),
    );

    const result = await service.processToken('tkn');
    expect(result.action).toBe('cancel');
    expect(emits.map((e) => e.name)).toEqual(['booking.cancelled']);
  });

  it('throws BOOK_CONFIRM_001 when token is expired', async () => {
    const { service, unscoped, tokenRecord } = buildService();
    unscoped.booking_confirmation_tokens.findUnique.mockResolvedValue(
      tokenRecord({ expires_at: new Date(Date.now() - 60_000) }),
    );
    await expect(service.processToken('tkn')).rejects.toMatchObject({
      errorCode: 'BOOK_CONFIRM_001',
    });
  });

  it('throws BOOK_CONFIRM_002 when token is already used', async () => {
    const { service, unscoped, tokenRecord } = buildService();
    unscoped.booking_confirmation_tokens.findUnique.mockResolvedValue(
      tokenRecord({ used: true }),
    );
    await expect(service.processToken('tkn')).rejects.toMatchObject({
      errorCode: 'BOOK_CONFIRM_002',
    });
  });
});

describe('BookingConfirmationService email links (QUI-966 S9)', () => {
  function build(opts: { bookingStatus?: string } = {}) {
    const booking = {
      id: 42,
      store_id: 3,
      booking_number: 'BKG-42',
      product_id: 10,
      provider_id: 5,
      customer_id: 7,
      status: opts.bookingStatus ?? 'pending',
      start_time: '10:00',
      end_time: '11:00',
      date: new Date('2026-07-18T00:00:00Z'),
      customer: { first_name: 'Juan', last_name: 'Pérez' },
      product: { name: 'Corte' },
    };
    const token = (action: string) => ({
      id: action === 'confirm' ? 1 : 2,
      token: `${action}-tkn`,
      booking_id: 42,
      used: false,
      expires_at: new Date(Date.now() + 60_000),
      action,
      booking,
    });
    const tokenUpdates: any[] = [];
    const bookingUpdates: any[] = [];
    const claimCount = { value: 1 };
    const bookingCount = { value: 1 };
    const unscoped: any = {
      booking_confirmation_tokens: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(token(where.token.split('-')[0])),
        ),
        updateMany: jest.fn(({ where, data }: any) => {
          tokenUpdates.push({ where, data });
          // The first update is the claim; the second burns the siblings.
          return Promise.resolve({
            count: tokenUpdates.length === 1 ? claimCount.value : 1,
          });
        }),
      },
      bookings: {
        updateMany: jest.fn(({ where, data }: any) => {
          bookingUpdates.push({ where, data });
          return Promise.resolve({ count: bookingCount.value });
        }),
      },
    };
    unscoped.$transaction = jest.fn((cb: (tx: any) => any) => cb(unscoped));
    const prisma: any = {
      withoutScope: () => unscoped,
      bookings: {
        findUnique: jest.fn().mockResolvedValue(booking),
        update: jest.fn().mockResolvedValue(booking),
      },
      booking_confirmation_tokens: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const emits: string[] = [];
    const eventEmitter: any = { emit: jest.fn((n: string) => emits.push(n)) };
    const availabilityService: any = {
      isSlotAvailable: jest.fn().mockResolvedValue(true),
    };
    const reservationsService: any = {
      completeLinkCancellation: jest.fn().mockResolvedValue(booking),
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
    return {
      service,
      prisma,
      unscoped,
      emits,
      tokenUpdates,
      bookingUpdates,
      claimCount,
      bookingCount,
      reservationsService,
      storeContextRunner,
    };
  }

  it('confirm link: claims the token, burns its sibling and confirms a pending booking in one transaction', async () => {
    const { service, unscoped, tokenUpdates, bookingUpdates, emits } = build();
    const result = await service.processToken('confirm-tkn');

    expect(result).toMatchObject({
      action: 'confirm',
      booking_id: 42,
      status: 'confirmed',
    });
    expect(result.message).toMatch(/confirmada/);
    expect(unscoped.$transaction).toHaveBeenCalledTimes(1);
    expect(tokenUpdates[0].where).toMatchObject({ id: 1, used: false });
    expect(tokenUpdates[1].where).toEqual({ booking_id: 42, used: false });
    expect(bookingUpdates).toHaveLength(1);
    expect(bookingUpdates[0].where).toEqual({
      id: 42,
      status: { in: ['pending'] },
    });
    expect(bookingUpdates[0].data.status).toBe('confirmed');
    expect(emits).toEqual(['booking.confirmed']);
  });

  it.each(['pending', 'confirmed'])(
    'cancel link: cancels a %s booking and runs the staff cancel effects in its store context',
    async (status) => {
      const {
        service,
        bookingUpdates,
        tokenUpdates,
        reservationsService,
        storeContextRunner,
      } = build({ bookingStatus: status });
      const result = await service.processToken('cancel-tkn');

      expect(result).toMatchObject({
        action: 'cancel',
        booking_id: 42,
        status: 'cancelled',
      });
      expect(tokenUpdates[0].where).toMatchObject({ id: 2, used: false });
      expect(tokenUpdates[1].where).toEqual({ booking_id: 42, used: false });
      expect(bookingUpdates[0].where).toEqual({
        id: 42,
        status: { in: ['pending', 'confirmed'] },
      });
      expect(bookingUpdates[0].data.status).toBe('cancelled');
      expect(storeContextRunner.runInStoreContext).toHaveBeenCalledWith(
        3,
        expect.any(Function),
      );
      expect(reservationsService.completeLinkCancellation).toHaveBeenCalledWith(42);
    },
  );

  it('confirm link on an already confirmed booking is an idempotent success without changes or events', async () => {
    const { service, bookingUpdates, tokenUpdates, emits } = build({
      bookingStatus: 'confirmed',
    });
    const result = await service.processToken('confirm-tkn');

    expect(result).toMatchObject({
      action: 'confirm',
      status: 'confirmed',
      already_confirmed: true,
    });
    expect(bookingUpdates).toHaveLength(0);
    expect(tokenUpdates).toHaveLength(2);
    expect(emits).toEqual([]);
  });

  it('a non-changeable booking is rejected with BOOK_CONFIRM_003 and the token is left untouched', async () => {
    const { service, tokenUpdates, bookingUpdates } = build({
      bookingStatus: 'completed',
    });
    await expect(service.processToken('cancel-tkn')).rejects.toMatchObject({
      errorCode: 'BOOK_CONFIRM_003',
    });
    expect(tokenUpdates).toHaveLength(0);
    expect(bookingUpdates).toHaveLength(0);
  });

  it('a losing concurrent click (claim count 0) gets BOOK_CONFIRM_002 and changes nothing', async () => {
    const { service, claimCount, bookingUpdates, emits, reservationsService } =
      build();
    claimCount.value = 0;
    await expect(service.processToken('cancel-tkn')).rejects.toMatchObject({
      errorCode: 'BOOK_CONFIRM_002',
    });
    expect(bookingUpdates).toHaveLength(0);
    expect(emits).toEqual([]);
    expect(reservationsService.completeLinkCancellation).not.toHaveBeenCalled();
  });

  it('a booking changed meanwhile (conditional update count 0) is rejected with BOOK_CONFIRM_003 and no event', async () => {
    const { service, bookingCount, emits } = build();
    bookingCount.value = 0;
    await expect(service.processToken('confirm-tkn')).rejects.toMatchObject({
      errorCode: 'BOOK_CONFIRM_003',
    });
    expect(emits).toEqual([]);
  });

  // QUI-966 T8 (T5 advisory A1): confirm + cancel links of the same booking
  // clicked at once can deadlock (each claims its token and burns the other).
  // The loser gets the "link already used" 400, never a 500.
  it.each([
    ['Prisma P2034', { code: 'P2034', message: 'Transaction failed due to a write conflict or a deadlock' }],
    ['Postgres 40P01', { meta: { driverAdapterError: { cause: { originalCode: '40P01' } } }, message: 'deadlock detected' }],
    ['Postgres 40001', { meta: { code: '40001' }, message: 'could not serialize access' }],
  ])(
    'a deadlocked/serialization-failed link transaction (%s) maps to BOOK_CONFIRM_002 with no effects',
    async (_label, dbError) => {
      const { service, unscoped, emits, reservationsService } = build();
      unscoped.$transaction = jest.fn(() => Promise.reject(dbError));
      for (const tkn of ['confirm-tkn', 'cancel-tkn']) {
        await expect(service.processToken(tkn)).rejects.toMatchObject({
          errorCode: 'BOOK_CONFIRM_002',
        });
      }
      expect(emits).toEqual([]);
      expect(reservationsService.completeLinkCancellation).not.toHaveBeenCalled();
    },
  );

  it('a deadlock while consuming an already-confirmed link maps to BOOK_CONFIRM_002', async () => {
    const { service, unscoped } = build({ bookingStatus: 'confirmed' });
    unscoped.$transaction = jest.fn(() => Promise.reject({ code: 'P2034' }));
    await expect(service.processToken('confirm-tkn')).rejects.toMatchObject({
      errorCode: 'BOOK_CONFIRM_002',
    });
  });

  it('a non-concurrency transaction error is not masked as BOOK_CONFIRM_002', async () => {
    const { service, unscoped } = build();
    unscoped.$transaction = jest.fn(() => Promise.reject(new Error('connection lost')));
    await expect(service.processToken('confirm-tkn')).rejects.toThrow('connection lost');
  });

  it('sendConfirmationRequest still issues the confirm/cancel pair for a pending booking', async () => {
    const { service, prisma } = build();
    const result = await service.sendConfirmationRequest(42);
    expect(prisma.booking_confirmation_tokens.createMany).toHaveBeenCalledTimes(1);
    expect(result.confirm_token).not.toEqual(result.cancel_token);
  });

  it('sendConfirmationRequest refuses a completed booking with BOOK_CONFIRM_003', async () => {
    const { service, prisma } = build({ bookingStatus: 'completed' });
    await expect(service.sendConfirmationRequest(42)).rejects.toBeInstanceOf(
      VendixHttpException,
    );
    expect(prisma.booking_confirmation_tokens.createMany).not.toHaveBeenCalled();
  });
});
