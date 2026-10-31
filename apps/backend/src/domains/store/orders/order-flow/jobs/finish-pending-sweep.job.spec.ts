import { FinishPendingSweepJob } from './finish-pending-sweep.job';

describe('FinishPendingSweepJob', () => {
  const now = new Date('2026-10-31T12:00:00.000Z');
  let tx: any;
  let globalPrisma: any;
  let runner: any;
  let orderFlow: any;
  let job: FinishPendingSweepJob;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn(async () => [{ locked: true }]),
      orders: {
        findMany: jest.fn(async () => [
          { id: 7, store_id: 10 },
          { id: 8, store_id: 11 },
        ]),
      },
    };
    globalPrisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) };
    runner = {
      runInStoreContext: jest.fn(async (_store: number, cb: () => any) => cb()),
    };
    orderFlow = {
      resumeFinishPendingAfterPayment: jest.fn(async () => 'resolved'),
    };
    job = new FinishPendingSweepJob(globalPrisma, runner, orderFlow);
  });

  it('retries orders with an open finish_pending_after_payment marker older than 2 minutes, each in its own store context', async () => {
    await expect(job.sweep(now)).resolves.toBe(2);
    expect(tx.orders.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          state: { in: ['draft', 'created', 'processing', 'finished', 'delivered'] },
          internal_notes: { contains: '"finish_pending_after_payment":{' },
          updated_at: { lt: new Date('2026-10-31T11:58:00.000Z') },
        },
      }),
    );
    expect(runner.runInStoreContext).toHaveBeenCalledWith(10, expect.any(Function));
    expect(runner.runInStoreContext).toHaveBeenCalledWith(11, expect.any(Function));
    expect(orderFlow.resumeFinishPendingAfterPayment).toHaveBeenCalledWith(7);
    expect(orderFlow.resumeFinishPendingAfterPayment).toHaveBeenCalledWith(8);
  });

  it('one failing order does not stop the rest of the batch', async () => {
    orderFlow.resumeFinishPendingAfterPayment
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce('resolved');
    await expect(job.sweep(now)).resolves.toBe(1);
    expect(orderFlow.resumeFinishPendingAfterPayment).toHaveBeenCalledTimes(2);
  });

  it('skips the tick when another pod holds the advisory lock', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    await expect(job.sweep(now)).resolves.toBe(0);
    expect(tx.orders.findMany).not.toHaveBeenCalled();
  });
});
