import { SubscriptionDraftCleanupJob } from './subscription-draft-cleanup.job';
import { VendixHttpException } from '../common/errors/vendix-http.exception';
import { ErrorCodes } from '../common/errors/error-codes';

describe('SubscriptionDraftCleanupJob', () => {
  let findMany: jest.Mock;
  let transition: jest.Mock;
  let job: SubscriptionDraftCleanupJob;

  beforeEach(() => {
    findMany = jest.fn();
    transition = jest.fn().mockResolvedValue(undefined);
    const prismaMock: any = {
      withoutScope: () => ({ store_subscriptions: { findMany } }),
    };
    job = new SubscriptionDraftCleanupJob(prismaMock, { transition } as any);
    jest.spyOn((job as any).logger, 'log').mockImplementation(() => undefined);
    jest
      .spyOn((job as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  it('cancels every draft and returns the count', async () => {
    findMany.mockResolvedValue([
      { id: 1, store_id: 11 },
      { id: 2, store_id: 12 },
    ]);

    await expect(job.runOnce()).resolves.toBe(2);

    expect(transition).toHaveBeenCalledTimes(2);
    expect(transition).toHaveBeenCalledWith(
      11,
      'cancelled',
      expect.objectContaining({ triggeredByJob: 'subscription-draft-cleanup' }),
    );
    expect(transition).toHaveBeenCalledWith(
      12,
      'cancelled',
      expect.objectContaining({ triggeredByJob: 'subscription-draft-cleanup' }),
    );
  });

  it('a generic error on one row does not stop the others', async () => {
    findMany.mockResolvedValue([
      { id: 1, store_id: 11 },
      { id: 2, store_id: 12 },
    ]);
    transition
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce(undefined);

    await expect(job.runOnce()).resolves.toBe(1);
    expect(transition).toHaveBeenCalledTimes(2);
  });

  it('rethrows SUBSCRIPTION_010 (illegal transition) and aborts the batch', async () => {
    findMany.mockResolvedValue([
      { id: 1, store_id: 11 },
      { id: 2, store_id: 12 },
    ]);
    transition.mockRejectedValue(
      new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Illegal transition draft -> cancelled',
      ),
    );

    await expect(job.runOnce()).rejects.toBeInstanceOf(VendixHttpException);
    expect(transition).toHaveBeenCalledTimes(1);
  });
});
