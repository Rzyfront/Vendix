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
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    globalPrisma = {
      $transaction: jest.fn(async (cb: any) => cb(tx)),
      orders: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    runner = {
      runInStoreContext: jest.fn(async (_store: number, cb: () => any) => cb()),
    };
    orderFlow = {
      resumeFinishPendingAfterPayment: jest.fn(async () => 'resolved'),
      recordFinishPendingFailure: jest.fn(async () => 'retry'),
    };
    job = new FinishPendingSweepJob(globalPrisma, runner, orderFlow);
  });

  it('claims by the indexed finish_pending_at (no LIKE over internal_notes), leases the batch and resumes outside the lock transaction', async () => {
    let inTx = false;
    globalPrisma.$transaction.mockImplementation(async (cb: any, opts: any) => {
      expect(opts.timeout).toBeLessThanOrEqual(10_000);
      inTx = true;
      try {
        return await cb(tx);
      } finally {
        inTx = false;
      }
    });
    orderFlow.resumeFinishPendingAfterPayment.mockImplementation(async () => {
      expect(inTx).toBe(false);
      return 'resolved';
    });

    await expect(job.sweep(now)).resolves.toBe(2);

    const query = tx.orders.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      finish_pending_at: { lt: new Date('2026-10-31T11:58:00.000Z') },
    });
    expect(JSON.stringify(query)).not.toContain('internal_notes');
    expect(tx.orders.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 8] } },
      data: { finish_pending_at: now },
    });
    expect(runner.runInStoreContext).toHaveBeenCalledWith(10, expect.any(Function));
    expect(runner.runInStoreContext).toHaveBeenCalledWith(11, expect.any(Function));
    expect(orderFlow.resumeFinishPendingAfterPayment).toHaveBeenCalledWith(7);
    expect(orderFlow.resumeFinishPendingAfterPayment).toHaveBeenCalledWith(8);
  });

  it('a stamp without an open marker (skipped) is cleared so it stops being leased', async () => {
    orderFlow.resumeFinishPendingAfterPayment
      .mockResolvedValueOnce('skipped')
      .mockResolvedValueOnce('resolved');

    await expect(job.sweep(now)).resolves.toBe(1);

    expect(globalPrisma.orders.updateMany).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { finish_pending_at: null },
    });
  });

  it('one failing order does not stop the rest of the batch', async () => {
    orderFlow.resumeFinishPendingAfterPayment
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce('resolved');
    await expect(job.sweep(now)).resolves.toBe(1);
    expect(orderFlow.resumeFinishPendingAfterPayment).toHaveBeenCalledTimes(2);
  });

  it('R3 #2: a failed retry is counted on the order (in its store context) so it can escalate to review', async () => {
    const failure = new Error('still down');
    orderFlow.resumeFinishPendingAfterPayment
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce('resolved');

    await job.sweep(now);

    expect(orderFlow.recordFinishPendingFailure).toHaveBeenCalledTimes(1);
    expect(orderFlow.recordFinishPendingFailure).toHaveBeenCalledWith(7, failure);
    expect(runner.runInStoreContext).toHaveBeenCalledTimes(3);
  });

  it('skips the tick when another pod holds the advisory lock', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ locked: false }]);
    await expect(job.sweep(now)).resolves.toBe(0);
    expect(tx.orders.findMany).not.toHaveBeenCalled();
  });
});
