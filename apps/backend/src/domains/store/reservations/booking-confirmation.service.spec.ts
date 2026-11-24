import { BookingConfirmationService } from './booking-confirmation.service';
import { VendixHttpException } from '../../../common/errors';

describe('BookingConfirmationService.processToken (double-validation)', () => {
  function buildService(opts: { slotAvailable: boolean } = { slotAvailable: true }) {
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
        start_time: '10:00',
        end_time: '11:00',
        date: new Date('2026-07-18T00:00:00Z'),
        customer: { first_name: 'Juan', last_name: 'Pérez' },
        product: { name: 'Corte' },
      },
      ...overrides,
    });

    const updateCalls: any[] = [];
    // QUI-1060: the status change is claimed with a conditional updateMany.
    const bookingState = { status: 'pending' };
    const rawClient: any = {
      booking_confirmation_tokens: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(tokenRecord())),
        update: jest.fn().mockImplementation(({ data }: any) => {
          updateCalls.push({ kind: 'token', data });
          return Promise.resolve({});
        }),
        updateMany: jest.fn().mockImplementation(() => Promise.resolve({ count: 1 })),
      },
      bookings: {
        // QUI-1060: the cancel path reads the booking to give plan seats back.
        findFirst: jest.fn().mockResolvedValue({ store_id: 1, departure_id: null, pax_adults: null, pax_children: null }),
        update: jest.fn().mockImplementation(({ data }: any) => {
          updateCalls.push({ kind: 'booking', data });
          return Promise.resolve({ id: 42 });
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
          if (!where.status.in.includes(bookingState.status)) return Promise.resolve({ count: 0 });
          bookingState.status = data.status;
          updateCalls.push({ kind: 'booking', data });
          return Promise.resolve({ count: 1 });
        }),
      },
      service_allocations: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(rawClient)),
    };
    const prisma: any = {
      withoutScope: () => rawClient,
    };

    const isSlotAvailable = jest.fn().mockResolvedValue(opts.slotAvailable);
    const availabilityService: any = { isSlotAvailable };

    const emits: any[] = [];
    const eventEmitter: any = {
      emit: jest.fn((name: string, payload: any) => {
        emits.push({ name, payload });
      }),
    };

    const service = new BookingConfirmationService(
      prisma,
      eventEmitter,
      availabilityService,
    );

    return { service, isSlotAvailable, emits, updateCalls, rawClient, bookingState };
  }

  it('confirms and emits booking.confirmed when the slot is still free', async () => {
    const { service, isSlotAvailable, emits } = buildService({ slotAvailable: true });
    const result = await service.processToken('tkn');
    expect(result).toEqual({ action: 'confirm', booking_id: 42 });
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
    const { service, emits } = buildService({ slotAvailable: true });
    // Override the inner findUnique to return a cancel token.
    (service as any).prisma.withoutScope().booking_confirmation_tokens.findUnique =
      jest.fn().mockResolvedValue({
        id: 1,
        token: 'tkn',
        booking_id: 42,
        used: false,
        expires_at: new Date(Date.now() + 60_000),
        action: 'cancel',
        booking: {
          id: 42,
          store_id: 1,
          booking_number: 'BKG-42',
          date: new Date('2026-07-18T00:00:00Z'),
          start_time: '10:00',
          end_time: '11:00',
          customer: { first_name: 'Juan', last_name: 'Pérez' },
          product: { name: 'Corte' },
        },
      });

    const result = await service.processToken('tkn');
    expect(result.action).toBe('cancel');
    expect(emits.map((e) => e.name)).toEqual(['booking.cancelled']);
  });

  it('QUI-1060: cancelling a plan booking by token gives its seats back in the same transaction', async () => {
    const { service, rawClient, updateCalls } = buildService({ slotAvailable: true });
    rawClient.bookings.findFirst.mockResolvedValue({ store_id: 1, departure_id: 3, pax_adults: 2, pax_children: 2 });
    rawClient.booking_confirmation_tokens.findUnique = jest.fn().mockResolvedValue({
      id: 1, token: 'tkn', booking_id: 42, used: false, expires_at: new Date(Date.now() + 60_000), action: 'cancel',
      booking: { id: 42, store_id: 1, booking_number: 'BKG-42', date: new Date('2026-07-18T00:00:00Z'), start_time: '10:00', end_time: '11:00', customer: { first_name: 'Juan', last_name: 'Pérez' }, product: { name: 'Plan' } },
    });

    await service.processToken('tkn');
    expect(rawClient.$executeRaw.mock.calls[0].slice(1)).toEqual([4, 3, 1]);
    expect(updateCalls.find((c) => c.kind === 'booking')?.data.status).toBe('cancelled');
  });

  it('QUI-1060: a cancel link opened after the booking was already cancelled gives no seats back', async () => {
    const { service, rawClient, emits, bookingState } = buildService({ slotAvailable: true });
    bookingState.status = 'cancelled'; // staff or the auto-cancel job got there first
    rawClient.bookings.findFirst.mockResolvedValue({ store_id: 1, departure_id: 3, pax_adults: 2, pax_children: 2 });
    rawClient.booking_confirmation_tokens.findUnique = jest.fn().mockResolvedValue({
      id: 1, token: 'tkn', booking_id: 42, used: false, expires_at: new Date(Date.now() + 60_000), action: 'cancel',
      booking: { id: 42, store_id: 1, booking_number: 'BKG-42', date: new Date('2026-07-18T00:00:00Z'), start_time: '10:00', end_time: '11:00', customer: { first_name: 'Juan', last_name: 'Pérez' }, product: { name: 'Plan' } },
    });

    await expect(service.processToken('tkn')).rejects.toMatchObject({ errorCode: 'BOOK_CONFIRM_003' });
    expect(rawClient.$executeRaw).not.toHaveBeenCalled();
    expect(bookingState.status).toBe('cancelled');
    expect(emits).toEqual([]);
  });

  it('QUI-1060: two cancel links on the same booking give its seats back only once', async () => {
    const { service, rawClient, bookingState } = buildService({ slotAvailable: true });
    rawClient.bookings.findFirst.mockResolvedValue({ store_id: 1, departure_id: 3, pax_adults: 2, pax_children: 0 });
    rawClient.booking_confirmation_tokens.findUnique = jest.fn().mockResolvedValue({
      id: 1, token: 'tkn', booking_id: 42, used: false, expires_at: new Date(Date.now() + 60_000), action: 'cancel',
      booking: { id: 42, store_id: 1, booking_number: 'BKG-42', date: new Date('2026-07-18T00:00:00Z'), start_time: '10:00', end_time: '11:00', customer: { first_name: 'Juan', last_name: 'Pérez' }, product: { name: 'Plan' } },
    });

    await service.processToken('tkn');
    await expect(service.processToken('tkn')).rejects.toMatchObject({ errorCode: 'BOOK_CONFIRM_003' });
    expect(rawClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(bookingState.status).toBe('cancelled');
  });

  it('QUI-1060: a confirm link does not revive a cancelled booking', async () => {
    const { service, bookingState, emits } = buildService({ slotAvailable: true });
    bookingState.status = 'cancelled';
    await expect(service.processToken('tkn')).rejects.toMatchObject({ errorCode: 'BOOK_CONFIRM_003' });
    expect(bookingState.status).toBe('cancelled');
    expect(emits).toEqual([]);
  });

  it('throws BOOK_CONFIRM_001 when token is expired', async () => {
    const { service } = buildService({ slotAvailable: true });
    (service as any).prisma.withoutScope().booking_confirmation_tokens.findUnique =
      jest.fn().mockResolvedValue({
        id: 1,
        token: 'tkn',
        booking_id: 42,
        used: false,
        expires_at: new Date(Date.now() - 60_000),
        action: 'confirm',
        booking: { id: 42 },
      });
    await expect(service.processToken('tkn')).rejects.toBeInstanceOf(
      VendixHttpException,
    );
  });

  it('throws BOOK_CONFIRM_002 when token is already used', async () => {
    const { service } = buildService({ slotAvailable: true });
    (service as any).prisma.withoutScope().booking_confirmation_tokens.findUnique =
      jest.fn().mockResolvedValue({
        id: 1,
        token: 'tkn',
        booking_id: 42,
        used: true,
        expires_at: new Date(Date.now() + 60_000),
        action: 'confirm',
        booking: { id: 42 },
      });
    await expect(service.processToken('tkn')).rejects.toBeInstanceOf(
      VendixHttpException,
    );
  });
});