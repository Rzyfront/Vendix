import { ServiceAllocationExpiryJob } from './service-allocation-expiry.job';

describe('ServiceAllocationExpiryJob', () => {
  let job: ServiceAllocationExpiryJob;
  let tx: { $queryRaw: jest.Mock; service_allocations: { updateMany: jest.Mock } };
  let globalPrisma: { $transaction: jest.Mock };

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      service_allocations: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
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
