import { ServiceAllocationExpiryJob } from './service-allocation-expiry.job';

describe('ServiceAllocationExpiryJob', () => {
  let job: ServiceAllocationExpiryJob;
  let tx: {
    $queryRaw: jest.Mock;
    service_allocations: { updateMany: jest.Mock };
    service_deposits: { findMany: jest.Mock };
    payment_requests: { findMany: jest.Mock };
  };
  let globalPrisma: { $transaction: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      service_allocations: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      service_deposits: { findMany: jest.fn().mockResolvedValue([]) },
      payment_requests: { findMany: jest.fn().mockResolvedValue([]) },
    };
    globalPrisma = { $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(tx)) };
    job = new ServiceAllocationExpiryJob(globalPrisma as any);
  });

  it('expira con un único updateMany global dentro del lock (sin barrer tiendas)', async () => {
    await job.expire();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.service_allocations.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.service_allocations.updateMany).toHaveBeenCalledWith({
      where: {
        state: { in: ['held', 'payment_pending'] },
        expires_at: { lte: expect.any(Date) },
      },
      data: { state: 'expired', updated_at: expect.any(Date) },
    });
  });

  it('A9: no vence el apartado de una reserva con comprobante en revisión (anticipo o cobro para reservar)', async () => {
    tx.service_deposits.findMany.mockResolvedValueOnce([{ booking_id: 41 }]);
    tx.payment_requests.findMany.mockResolvedValueOnce([
      { purpose: 'service_rental:52' },
      { purpose: 'otro' },
    ]);

    await job.expire();

    expect(tx.service_deposits.findMany).toHaveBeenCalledWith({
      where: { booking_id: { not: null }, payment_request: { status: 'awaiting_confirmation' } },
      select: { booking_id: true },
    });
    expect(tx.payment_requests.findMany).toHaveBeenCalledWith({
      where: { purpose: { startsWith: 'service_rental:' }, status: 'awaiting_confirmation' },
      select: { purpose: true },
    });
    // Session holds (booking_id null) still expire; only the bookings in review are spared.
    expect(tx.service_allocations.updateMany).toHaveBeenCalledWith({
      where: {
        state: { in: ['held', 'payment_pending'] },
        expires_at: { lte: expect.any(Date) },
        OR: [{ booking_id: null }, { booking_id: { notIn: [41, 52] } }],
      },
      data: { state: 'expired', updated_at: expect.any(Date) },
    });
  });

  it('omite el tick si otro pod tiene el lock', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);

    await job.expire();

    expect(tx.service_allocations.updateMany).not.toHaveBeenCalled();
  });

  it('no corre ticks concurrentes en el mismo pod', async () => {
    await Promise.all([job.expire(), job.expire()]);

    expect(tx.service_allocations.updateMany).toHaveBeenCalledTimes(1);
  });

  it('libera el candado aunque el tick falle', async () => {
    tx.service_allocations.updateMany.mockRejectedValueOnce(new Error('boom'));

    await job.expire();
    await job.expire();

    expect(tx.service_allocations.updateMany).toHaveBeenCalledTimes(2);
  });
});
