// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models).
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SubscriptionTrialNotifierJob } from './subscription-trial-notifier.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

describe('SubscriptionTrialNotifierJob', () => {
  let job: SubscriptionTrialNotifierJob;
  let subsFindMany: jest.Mock;
  let eventsFindFirst: jest.Mock;
  let eventsCreate: jest.Mock;
  let queueAdd: jest.Mock;

  beforeEach(async () => {
    subsFindMany = jest.fn();
    eventsFindFirst = jest.fn();
    eventsCreate = jest.fn().mockResolvedValue(undefined);
    queueAdd = jest.fn().mockResolvedValue(undefined);

    const prismaMock = {
      withoutScope: () => ({
        store_subscriptions: { findMany: subsFindMany },
        subscription_events: {
          findFirst: eventsFindFirst,
          create: eventsCreate,
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionTrialNotifierJob,
        { provide: GlobalPrismaService, useValue: prismaMock },
        {
          provide: getQueueToken('email-notifications'),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    job = module.get(SubscriptionTrialNotifierJob);
  });

  it('does nothing when there are no upcoming trials', async () => {
    subsFindMany.mockResolvedValue([]);

    const result = await job.runOnce();

    expect(result).toEqual({ enqueued: 0, skipped: 0 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });

  it('enqueues trial.ending.email with bucket=3d for a trial 2 days out', async () => {
    const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    subsFindMany.mockResolvedValue([
      { id: 1, store_id: 10, trial_ends_at: twoDaysOut },
    ]);
    eventsFindFirst.mockResolvedValue(null);

    const result = await job.runOnce();

    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [jobName, payload] = queueAdd.mock.calls[0];
    expect(jobName).toBe('trial.ending.email');
    expect(payload).toMatchObject({
      subscriptionId: 1,
      storeId: 10,
      bucket: '3d',
    });
    expect(eventsCreate).toHaveBeenCalledTimes(1);
    expect(eventsCreate.mock.calls[0][0].data).toMatchObject({
      store_subscription_id: 1,
      type: 'state_transition',
      from_state: 'trial',
      to_state: 'trial',
      triggered_by_job: 'subscription-trial-notifier',
    });
  });

  it('skips a sub that already has a trial_reminder event in the last 24h', async () => {
    const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    subsFindMany.mockResolvedValue([
      { id: 2, store_id: 11, trial_ends_at: twoDaysOut },
    ]);
    eventsFindFirst.mockResolvedValue({ id: 999 });

    const result = await job.runOnce();

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });
});
