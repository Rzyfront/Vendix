import { ServiceDepositHoldExpiryJob } from './service-deposit-hold-expiry.job';

describe('ServiceDepositHoldExpiryJob', () => {
  function build(stores = [{ id: 1 }, { id: 2 }]) {
    const prisma: any = { stores: { findMany: jest.fn().mockResolvedValue(stores) } };
    const deposits: any = { expireOverdueHolds: jest.fn().mockResolvedValue(1) };
    const runner: any = { runInStoreContext: jest.fn((_id: number, fn: () => Promise<unknown>) => fn()) };
    return { job: new ServiceDepositHoldExpiryJob(prisma, deposits, runner), prisma, deposits, runner };
  }

  it('sweeps every active store in its own context', async () => {
    const { job, deposits, runner, prisma } = build();
    await job.expire();
    expect(prisma.stores.findMany).toHaveBeenCalledWith({ where: { is_active: true }, select: { id: true } });
    expect(runner.runInStoreContext.mock.calls.map((c: any[]) => c[0])).toEqual([1, 2]);
    expect(deposits.expireOverdueHolds).toHaveBeenCalledTimes(2);
  });

  it('one failing store does not stop the others', async () => {
    const { job, deposits } = build();
    deposits.expireOverdueHolds.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);
    await job.expire();
    expect(deposits.expireOverdueHolds).toHaveBeenCalledTimes(2);
  });

  it('does not overlap with a run already in progress', async () => {
    const { job, prisma } = build();
    let release: (v: unknown) => void = () => undefined;
    prisma.stores.findMany.mockReturnValue(new Promise((r) => (release = r)));
    const first = job.expire();
    await job.expire();
    expect(prisma.stores.findMany).toHaveBeenCalledTimes(1);
    release([]);
    await first;
  });
});
