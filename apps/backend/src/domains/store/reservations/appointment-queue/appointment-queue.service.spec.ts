import { AppointmentQueueService } from './appointment-queue.service';

describe('AppointmentQueueService', () => {
  function buildService(
    candidates: any[],
    options: { transactions?: boolean } = {},
  ) {
    const findMany = jest.fn().mockResolvedValue(candidates);
    const update = jest.fn().mockResolvedValue({});
    const transaction = jest.fn(async (ops: any[]) => {
      for (const op of ops) await op;
      return [];
    });
    const prisma = {
      bookings: {
        findMany,
        update,
      },
      $transaction: options.transactions === false ? jest.fn() : transaction,
    } as any;
    const notifications = {
      createAndBroadcast: jest.fn().mockResolvedValue({}),
    } as any;
    return {
      service: new AppointmentQueueService(prisma, notifications),
      findMany,
      update,
      transaction,
      notifications,
    };
  }

  it('returns empty array when no candidates arrive', async () => {
    const { service, findMany } = buildService([]);
    const result = await service.computeQueueForStore(1, '2026-07-18');
    expect(result).toEqual([]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          store_id: 1,
          status: { in: ['arriving', 'attending'] },
          arrival_at: { not: null },
        }),
      }),
    );
  });

  it('ranks bookings by ABS(starts_at - arrival_at) with priority and created_at tiebreakers', async () => {
    const candidates = [
      {
        id: 10,
        booking_number: 'BKG-1',
        customer_id: 100,
        provider_id: 1,
        starts_at: new Date('2026-07-18T10:00:00Z'),
        arrival_at: new Date('2026-07-18T09:55:00Z'),
        priority: 0,
      },
      {
        id: 11,
        booking_number: 'BKG-2',
        customer_id: 101,
        provider_id: 1,
        starts_at: new Date('2026-07-18T10:00:00Z'),
        arrival_at: new Date('2026-07-18T09:30:00Z'),
        priority: 0,
      },
    ];
    const { service } = buildService(candidates);
    const ranked = await service.computeQueueForStore(1, '2026-07-18');
    // BKG-2 arrived 30 min early vs BKG-1 arrived 5 min early → BKG-1 ranked first.
    expect(ranked[0].booking_id).toBe(10);
    expect(ranked[1].booking_id).toBe(11);
    // Score for BKG-1: |10:00 - 09:55| = 5 min.
    expect(ranked[0].score).toBe(5 * 60_000);
  });

  it('persists queue_position in a transaction and notifies the top of the queue', async () => {
    const candidates = [
      {
        id: 10,
        booking_number: 'BKG-1',
        customer_id: 100,
        provider_id: null,
        starts_at: new Date('2026-07-18T10:00:00Z'),
        arrival_at: new Date('2026-07-18T09:55:00Z'),
        priority: 0,
      },
      {
        id: 11,
        booking_number: 'BKG-2',
        customer_id: 101,
        provider_id: null,
        starts_at: new Date('2026-07-18T10:00:00Z'),
        arrival_at: new Date('2026-07-18T09:30:00Z'),
        priority: 0,
      },
    ];
    const { service, update, transaction, notifications } = buildService(
      candidates,
      { transactions: true },
    );

    const result = await service.refreshAndBroadcastQueue(1, '2026-07-18');

    expect(transaction).toHaveBeenCalledTimes(1);
    // Two update calls (one per booking).
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: { queue_position: 0 },
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: { queue_position: 1 },
      }),
    );
    // Top of queue notified with appointment_queued.
    expect(notifications.createAndBroadcast).toHaveBeenCalledWith(
      1,
      'appointment_queued',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ booking_id: 10, queue_position: 0 }),
    );
    expect(result).toEqual({ updated: 2, promoted: 10 });
  });

  it('swallows notification errors so the queue refresh never crashes the listener', async () => {
    const candidates = [
      {
        id: 10,
        booking_number: 'BKG-1',
        customer_id: 100,
        provider_id: null,
        starts_at: new Date('2026-07-18T10:00:00Z'),
        arrival_at: new Date('2026-07-18T09:55:00Z'),
        priority: 0,
      },
    ];
    const { service, notifications } = buildService(candidates);
    notifications.createAndBroadcast.mockRejectedValue(new Error('boom'));
    await expect(service.refreshAndBroadcastQueue(1, '2026-07-18')).resolves.toEqual({
      updated: 1,
      promoted: 10,
    });
  });
});