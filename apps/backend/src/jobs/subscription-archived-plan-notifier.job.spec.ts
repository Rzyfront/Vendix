// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models). Mirrors
// subscription-trial-notifier.job.spec.ts.
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import {
  SubscriptionArchivedPlanNotifierJob,
  ARCHIVED_PLAN_EMAIL_JOB,
  ARCHIVED_PLAN_REMINDER_REASON,
} from './subscription-archived-plan-notifier.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';

// Fixed clock so the 3d/1d/today ladder is deterministic. Matches the real
// production window that motivated the job (periods expiring 29-jul → 1-ago).
const NOW = new Date('2026-07-29T09:00:00.000Z');

const ARCHIVED_PLAN = { id: 2, name: 'Early Access', state: 'archived' };
const ACTIVE_PLAN = { id: 5, name: 'Pro', state: 'active' };

/**
 * Minimal in-memory evaluator for the subset of the `where` clause the job
 * builds. Seeding rows and letting the mock apply the real predicate is what
 * makes the "active plan" and "outside the window" cases meaningful — a dumb
 * mock that echoes rows back would pass those tests vacuously.
 */
function applyWhere(rows: any[], where: any): any[] {
  return rows.filter((row) => {
    if (where.state?.in && !where.state.in.includes(row.state)) return false;

    const range = where.current_period_end;
    if (range) {
      if (!row.current_period_end) return false;
      const t = row.current_period_end.getTime();
      if (range.gte && t < range.gte.getTime()) return false;
      if (range.lte && t > range.lte.getTime()) return false;
    }

    // Relation filter on an optional to-one relation: the plan must exist AND
    // match. NOTE the predicate is on `state`, never on `archived_at`.
    if (where.plan?.state && row.plan?.state !== where.plan.state) return false;

    return true;
  });
}

describe('SubscriptionArchivedPlanNotifierJob', () => {
  let job: SubscriptionArchivedPlanNotifierJob;
  let seeded: any[];
  let subsFindMany: jest.Mock;
  let eventsFindFirst: jest.Mock;
  let eventsCreate: jest.Mock;
  let queueAdd: jest.Mock;
  let isCronDryRun: jest.Mock;

  beforeEach(async () => {
    seeded = [];
    subsFindMany = jest.fn(async (args: any) => applyWhere(seeded, args.where));
    eventsFindFirst = jest.fn().mockResolvedValue(null);
    eventsCreate = jest.fn().mockResolvedValue(undefined);
    queueAdd = jest.fn().mockResolvedValue(undefined);
    isCronDryRun = jest.fn().mockReturnValue(false);

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
        SubscriptionArchivedPlanNotifierJob,
        { provide: GlobalPrismaService, useValue: prismaMock },
        {
          provide: SubscriptionGateConfig,
          useValue: { isCronDryRun },
        },
        {
          provide: getQueueToken('email-notifications'),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    job = module.get(SubscriptionArchivedPlanNotifierJob);
  });

  it('does nothing when no subscription is expiring on an archived plan', async () => {
    const result = await job.runOnce(NOW);

    expect(result).toEqual({ enqueued: 0, skipped: 0 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });

  it('enqueues one email per bucket for archived-plan subs expiring in 3d / 1d / today', async () => {
    seeded = [
      {
        id: 101,
        store_id: 11,
        state: 'active',
        // +71h → inside the 3-day window, not the same UTC day, > 24h
        current_period_end: new Date('2026-08-01T08:00:00.000Z'),
        plan: ARCHIVED_PLAN,
      },
      {
        id: 102,
        store_id: 12,
        state: 'active',
        // +23h → not the same UTC day, <= 24h
        current_period_end: new Date('2026-07-30T08:00:00.000Z'),
        plan: ARCHIVED_PLAN,
      },
      {
        id: 103,
        store_id: 13,
        state: 'active',
        // same UTC calendar day as NOW
        current_period_end: new Date('2026-07-29T23:00:00.000Z'),
        plan: ARCHIVED_PLAN,
      },
    ];

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ enqueued: 3, skipped: 0 });
    expect(queueAdd).toHaveBeenCalledTimes(3);

    const byBucket: Record<string, any> = {};
    for (const [jobName, payload] of queueAdd.mock.calls) {
      expect(jobName).toBe(ARCHIVED_PLAN_EMAIL_JOB);
      byBucket[payload.bucket] = payload;
    }

    expect(Object.keys(byBucket).sort()).toEqual(['1d', '3d', 'today']);
    expect(byBucket['3d']).toMatchObject({ subscriptionId: 101, storeId: 11 });
    expect(byBucket['1d']).toMatchObject({ subscriptionId: 102, storeId: 12 });
    expect(byBucket['today']).toMatchObject({
      subscriptionId: 103,
      storeId: 13,
    });
    expect(byBucket['3d'].planName).toBe(ARCHIVED_PLAN.name);

    // One audit row per enqueue, carrying the dedup key.
    expect(eventsCreate).toHaveBeenCalledTimes(3);
    expect(eventsCreate.mock.calls[0][0].data).toMatchObject({
      store_subscription_id: 101,
      type: 'state_transition',
      from_state: 'active',
      to_state: 'active',
      triggered_by_job: 'subscription-archived-plan-notifier',
    });
    expect(eventsCreate.mock.calls[0][0].data.payload).toMatchObject({
      reason: ARCHIVED_PLAN_REMINDER_REASON,
      bucket: '3d',
      plan_id: ARCHIVED_PLAN.id,
    });
  });

  it('enqueues nothing when the plan is still active in the catalog', async () => {
    seeded = [
      {
        id: 201,
        store_id: 21,
        state: 'active',
        current_period_end: new Date('2026-07-30T08:00:00.000Z'),
        plan: ACTIVE_PLAN,
      },
    ];

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ enqueued: 0, skipped: 0 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
    // The archived filter must be expressed on `state`, not on `archived_at`
    // (production has archived plans with archived_at = NULL).
    expect(subsFindMany.mock.calls[0][0].where.plan).toEqual({
      state: 'archived',
    });
  });

  it('enqueues nothing for an archived plan expiring outside the 3-day window', async () => {
    seeded = [
      {
        id: 301,
        store_id: 31,
        state: 'active',
        // +10 days
        current_period_end: new Date('2026-08-08T09:00:00.000Z'),
        plan: ARCHIVED_PLAN,
      },
    ];

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ enqueued: 0, skipped: 0 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });

  it('is idempotent: skips a bucket already recorded for the same period', async () => {
    seeded = [
      {
        id: 401,
        store_id: 41,
        state: 'active',
        current_period_end: new Date('2026-07-30T08:00:00.000Z'),
        plan: ARCHIVED_PLAN,
      },
    ];
    eventsFindFirst.mockResolvedValue({ id: 9001 });

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ enqueued: 0, skipped: 1 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();

    // Dedup key = reason + bucket + current_period_end.
    const where = eventsFindFirst.mock.calls[0][0].where;
    expect(where.store_subscription_id).toBe(401);
    expect(where.AND).toEqual([
      {
        payload: {
          path: ['reason'],
          equals: ARCHIVED_PLAN_REMINDER_REASON,
        },
      },
      { payload: { path: ['bucket'], equals: '1d' } },
      {
        payload: {
          path: ['current_period_end'],
          equals: '2026-07-30T08:00:00.000Z',
        },
      },
    ]);
  });

  it('respects the cron dry-run flag: logs candidates without writing or enqueuing', async () => {
    isCronDryRun.mockReturnValue(true);
    seeded = [
      {
        id: 501,
        store_id: 51,
        state: 'trial',
        current_period_end: new Date('2026-07-29T23:00:00.000Z'),
        plan: ARCHIVED_PLAN,
      },
    ];

    const result = await job.runOnce(NOW);

    expect(result).toEqual({ enqueued: 0, skipped: 1 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
    expect(eventsFindFirst).not.toHaveBeenCalled();
  });
});
