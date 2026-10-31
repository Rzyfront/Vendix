import { SplitEffectsSweepJob } from './split-effects-sweep.job';

describe('SplitEffectsSweepJob', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  let tx: any;
  let globalPrisma: any;
  let runner: any;
  let accountPayments: any;
  let job: SplitEffectsSweepJob;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(async () => [{ locked: true }]),
      payments: {
        findMany: jest.fn(async () => [
          { id: 7, orders: { store_id: 10 } },
          { id: 8, orders: { store_id: 11 } },
        ]),
      },
    };
    globalPrisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    runner = {
      runInStoreContext: jest.fn(async (_store: number, cb: () => any) => cb()),
    };
    accountPayments = { reconcilePayment: jest.fn(async () => true) };
    job = new SplitEffectsSweepJob(globalPrisma, runner, accountPayments);
  });

  it('retries succeeded split payments without recorded effects older than 2 minutes, each in its own store context', async () => {
    await expect(job.sweep(now)).resolves.toBe(2);
    expect(tx.payments.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          financial_account_id: { not: null },
          state: { in: ['succeeded', 'captured'] },
          financial_effects_recorded_at: null,
          updated_at: { lt: new Date('2026-10-31T11:58:00.000Z') },
        },
      }),
    );
    expect(runner.runInStoreContext).toHaveBeenNthCalledWith(
      1,
      10,
      expect.any(Function),
    );
    expect(runner.runInStoreContext).toHaveBeenNthCalledWith(
      2,
      11,
      expect.any(Function),
    );
    expect(accountPayments.reconcilePayment).toHaveBeenCalledWith(7);
    expect(accountPayments.reconcilePayment).toHaveBeenCalledWith(8);
  });

  it('one failing payment does not stop the batch', async () => {
    accountPayments.reconcilePayment.mockRejectedValueOnce(new Error('boom'));
    jest.spyOn((job as any).logger, 'error').mockImplementation(() => undefined);
    await expect(job.sweep(now)).resolves.toBe(1);
    expect(accountPayments.reconcilePayment).toHaveBeenCalledTimes(2);
  });

  it('skips the tick when another instance holds the advisory lock', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    await expect(job.sweep(now)).resolves.toBe(0);
    expect(tx.payments.findMany).not.toHaveBeenCalled();
  });
});
