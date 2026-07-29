import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  SubscriptionStateEngineJob,
  DUNNING_EMAIL_JOBS,
} from './subscription-state-engine.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';

/**
 * Step 7 — the dunning escalations applied by this cron must notify the store,
 * exactly once per rung, without ever putting the notification ahead of (or in
 * the way of) the state transition that justifies it.
 */
describe('SubscriptionStateEngineJob', () => {
  const SUB_ID = 10;
  const STORE_ID = 5;
  const PERIOD_END = new Date('2026-06-01T00:00:00Z');

  let job: SubscriptionStateEngineJob;
  let prisma: {
    store_subscriptions: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let stateService: { evaluateAndTransitionForSubscription: jest.Mock };
  let gateConfig: { isCronDryRun: jest.Mock };
  let emailQueue: { add: jest.Mock };

  /** Row shape returned by the batch query (state BEFORE the evaluation). */
  function candidate(state: string) {
    return { id: SUB_ID, state };
  }

  /** Row shape returned by the post-evaluation re-read. */
  function afterRow(state: string, lockReason: string | null = null) {
    return {
      store_id: STORE_ID,
      state,
      lock_reason: lockReason,
      current_period_end: PERIOD_END,
      plan: { id: 7, name: 'Plan Pro' },
    };
  }

  beforeEach(async () => {
    prisma = {
      store_subscriptions: {
        findMany: jest.fn().mockResolvedValue([candidate('active')]),
        findUnique: jest.fn().mockResolvedValue(afterRow('grace_soft')),
      },
    };
    stateService = {
      evaluateAndTransitionForSubscription: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    gateConfig = { isCronDryRun: jest.fn().mockReturnValue(false) };
    emailQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionStateEngineJob,
        { provide: GlobalPrismaService, useValue: prisma },
        { provide: SubscriptionStateService, useValue: stateService },
        { provide: SubscriptionGateConfig, useValue: gateConfig },
        {
          provide: getQueueToken('email-notifications'),
          useValue: emailQueue,
        },
      ],
    }).compile();

    job = module.get(SubscriptionStateEngineJob);
  });

  // ----------------------------------------------------------------------
  // One enqueue per escalation, with the right job name
  // ----------------------------------------------------------------------

  it.each([
    ['active', 'grace_soft', 'dunning.soft.email'],
    ['grace_soft', 'grace_hard', 'dunning.hard.email'],
    ['grace_hard', 'suspended', 'subscription.suspended.email'],
  ])(
    'escalation %s → %s enqueues %s exactly once',
    async (from, to, expectedJobName) => {
      prisma.store_subscriptions.findMany.mockResolvedValue([candidate(from)]);
      prisma.store_subscriptions.findUnique.mockResolvedValue(afterRow(to));

      await job.handleStateTransitions();

      expect(
        stateService.evaluateAndTransitionForSubscription,
      ).toHaveBeenCalledWith(SUB_ID);
      expect(emailQueue.add).toHaveBeenCalledTimes(1);

      const [name, data] = emailQueue.add.mock.calls[0];
      expect(name).toBe(expectedJobName);
      expect(name).toBe(
        DUNNING_EMAIL_JOBS[to as keyof typeof DUNNING_EMAIL_JOBS],
      );
      expect(data).toMatchObject({
        subscriptionId: SUB_ID,
        storeId: STORE_ID,
        fromState: from,
        toState: to,
        planName: 'Plan Pro',
        periodEndsAt: PERIOD_END.toISOString(),
      });
    },
  );

  it('uses the same queue options as the neighbouring enqueuers', async () => {
    await job.handleStateTransitions();

    const [, , opts] = emailQueue.add.mock.calls[0];
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(opts.removeOnComplete).toEqual({ count: 50 });
    expect(opts.removeOnFail).toEqual({ count: 50 });
    // Deterministic id keyed on (subscription, rung, period) — BullMQ drops a
    // duplicate add while the job is retained.
    expect(opts.jobId).toBe(`dunning:${SUB_ID}:grace_soft:2026-06-01`);
  });

  it('forwards the truthful lock_reason so the template cannot invent a debt', async () => {
    prisma.store_subscriptions.findUnique.mockResolvedValue(
      afterRow('suspended', 'current_plan_unavailable_at_renewal'),
    );
    prisma.store_subscriptions.findMany.mockResolvedValue([
      candidate('grace_hard'),
    ]);

    await job.handleStateTransitions();

    const [name, data] = emailQueue.add.mock.calls[0];
    expect(name).toBe('subscription.suspended.email');
    expect(data.lockReason).toBe('current_plan_unavailable_at_renewal');
  });

  // ----------------------------------------------------------------------
  // No transition → no email
  // ----------------------------------------------------------------------

  it('does not enqueue when the evaluation applied no transition', async () => {
    prisma.store_subscriptions.findMany.mockResolvedValue([
      candidate('grace_soft'),
    ]);
    prisma.store_subscriptions.findUnique.mockResolvedValue(
      afterRow('grace_soft'),
    );

    await job.handleStateTransitions();

    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).toHaveBeenCalledTimes(1);
    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue for landing states without a dunning template', async () => {
    prisma.store_subscriptions.findMany.mockResolvedValue([
      candidate('grace_hard'),
    ]);
    prisma.store_subscriptions.findUnique.mockResolvedValue(
      afterRow('cancelled'),
    );

    await job.handleStateTransitions();

    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue when the subscription row vanished after the evaluation', async () => {
    prisma.store_subscriptions.findUnique.mockResolvedValue(null);

    await job.handleStateTransitions();

    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------
  // Idempotency: two cron runs, one email per escalation
  // ----------------------------------------------------------------------

  it('two cron runs over the same escalation send ONE email', async () => {
    // Run 1: the subscription is still `active` and the evaluation degrades it.
    prisma.store_subscriptions.findMany.mockResolvedValueOnce([
      candidate('active'),
    ]);
    // Run 2: the batch query now sees it already on the rung, so the
    // evaluation is a no-op and the re-read matches the starting state.
    prisma.store_subscriptions.findMany.mockResolvedValueOnce([
      candidate('grace_soft'),
    ]);
    prisma.store_subscriptions.findUnique.mockResolvedValue(
      afterRow('grace_soft'),
    );

    await job.handleStateTransitions();
    await job.handleStateTransitions();

    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).toHaveBeenCalledTimes(2);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------------
  // Dry-run
  // ----------------------------------------------------------------------

  it('dry-run: logs what it would do and enqueues nothing', async () => {
    gateConfig.isCronDryRun.mockReturnValue(true);
    const logSpy = jest.spyOn((job as any).logger, 'log');

    await job.handleStateTransitions();

    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'DRY_RUN_SKIP',
        job: 'subscription-state-engine',
        wouldEnqueueDunningEmail: false,
      }),
    );
  });

  // ----------------------------------------------------------------------
  // The transition is the truth; the email is only a notification
  // ----------------------------------------------------------------------

  it('a failing enqueue does NOT abort the escalation nor the batch', async () => {
    prisma.store_subscriptions.findMany.mockResolvedValue([
      candidate('active'),
      { id: 11, state: 'active' },
    ]);
    emailQueue.add.mockRejectedValue(new Error('redis down'));

    await expect(job.handleStateTransitions()).resolves.toBeUndefined();

    // Both transitions were applied even though every enqueue blew up.
    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).toHaveBeenCalledTimes(2);
    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).toHaveBeenNthCalledWith(1, SUB_ID);
    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).toHaveBeenNthCalledWith(2, 11);
    expect(emailQueue.add).toHaveBeenCalledTimes(2);
  });

  it('notifies an escalation that committed before the evaluation errored out', async () => {
    // The evaluation degraded the store and only then threw on a later rule.
    // The degradation is real, so the customer must still be told.
    stateService.evaluateAndTransitionForSubscription.mockRejectedValue(
      new Error('later rule blew up'),
    );

    await expect(job.handleStateTransitions()).resolves.toBeUndefined();

    expect(emailQueue.add).toHaveBeenCalledTimes(1);
    expect(emailQueue.add.mock.calls[0][0]).toBe('dunning.soft.email');
  });

  it('a failing re-read does not break the batch', async () => {
    prisma.store_subscriptions.findUnique.mockRejectedValue(
      new Error('db hiccup'),
    );

    await expect(job.handleStateTransitions()).resolves.toBeUndefined();

    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).toHaveBeenCalledTimes(1);
    expect(emailQueue.add).not.toHaveBeenCalled();
  });

  it('no candidates: no evaluation, no email', async () => {
    prisma.store_subscriptions.findMany.mockResolvedValue([]);

    await job.handleStateTransitions();

    expect(
      stateService.evaluateAndTransitionForSubscription,
    ).not.toHaveBeenCalled();
    expect(emailQueue.add).not.toHaveBeenCalled();
  });
});
