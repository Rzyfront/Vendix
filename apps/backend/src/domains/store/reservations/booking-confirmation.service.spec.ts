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
    const prisma: any = {
      withoutScope: () => ({
        booking_confirmation_tokens: {
          findUnique: jest.fn().mockResolvedValue(tokenRecord()),
          update: jest.fn().mockImplementation(({ data }: any) => {
            updateCalls.push({ kind: 'token', data });
            return Promise.resolve({});
          }),
        },
        bookings: {
          update: jest.fn().mockImplementation(({ data }: any) => {
            updateCalls.push({ kind: 'booking', data });
            return Promise.resolve({ id: 42 });
          }),
        },
      }),
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

    return { service, isSlotAvailable, emits, updateCalls };
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