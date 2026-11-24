import { BookingConfirmationJob } from './booking-confirmation.job';

describe('BookingConfirmationJob — auto-cancel of unconfirmed bookings (QUI-1060 seats)', () => {
  function build(currentStatus: string) {
    const row = { status: currentStatus };
    const expired = {
      id: 42,
      store_id: 1,
      booking_number: 'BKG-42',
      status: 'pending',
      store: { store_settings: { settings: { reservations: { confirmation: { auto_cancel_if_unconfirmed: true } } } } },
      customer: { first_name: 'Juan', last_name: 'Pérez' },
      product: { name: 'Tour' },
    };
    const prisma: any = {
      bookings: {
        findMany: jest.fn().mockResolvedValue([expired]),
        findFirst: jest.fn().mockResolvedValue({ store_id: 1, departure_id: 3, pax_adults: 2, pax_children: 1 }),
        updateMany: jest.fn(({ where, data }: any) => {
          if (where.status !== row.status) return Promise.resolve({ count: 0 });
          row.status = data.status;
          return Promise.resolve({ count: 1 });
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const emits: string[] = [];
    const job = new BookingConfirmationJob(prisma, { emit: jest.fn((name: string) => emits.push(name)) } as any);
    return { job, prisma, row, emits };
  }

  it('cancels a still-pending plan booking and gives its seats back once', async () => {
    const { job, prisma, row, emits } = build('pending');
    await job.handleExpiredConfirmations();
    expect(row.status).toBe('cancelled');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual([3, 3, 1]);
    expect(emits).toEqual(['booking.auto_cancelled']);
  });

  it('a booking cancelled (or confirmed) after the query gives no seats back and emits nothing', async () => {
    const { job, prisma, row, emits } = build('cancelled');
    await job.handleExpiredConfirmations();
    expect(row.status).toBe('cancelled');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(emits).toEqual([]);
  });
});
