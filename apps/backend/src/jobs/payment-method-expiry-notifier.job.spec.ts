// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models).
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PaymentMethodExpiryNotifierJob } from './payment-method-expiry-notifier.job';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

describe('PaymentMethodExpiryNotifierJob', () => {
  let job: PaymentMethodExpiryNotifierJob;
  let pmFindMany: jest.Mock;
  let eventsFindFirst: jest.Mock;
  let eventsCreate: jest.Mock;
  let queueAdd: jest.Mock;

  /**
   * Picks an MM/YYYY pair whose card-expiry date (last day of month, UTC)
   * lands at most `withinDays` days into the future. We anchor on "this
   * UTC month": its last day is always within the next ~31 days, so it
   * inherently falls inside the 14-day notification window when the test
   * runs in the back half of the month — and even when the test runs at
   * the start of the month, the last day is still ≤ 31 days out, well
   * inside what `computeExpiryDate` accepts. The cron uses ≤14d, so we
   * shift the picker forward when we need a card that is *outside* the
   * window.
   */
  function buildExpiryNearby(within14Days: boolean): {
    expiry_month: string;
    expiry_year: string;
  } {
    const now = new Date();
    if (within14Days) {
      // Current UTC month → last day is between 0 and ~31 days out. To
      // guarantee ≤14, advance Date.now() in tests via fake timers if
      // needed; here we mock now to the 25th of the month so day-31 is
      // ≤6 days away.
      return {
        expiry_month: String(now.getUTCMonth() + 1).padStart(2, '0'),
        expiry_year: String(now.getUTCFullYear()),
      };
    }
    // Far future — 6 months out, definitely outside the 14-day window.
    const future = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 1),
    );
    return {
      expiry_month: String(future.getUTCMonth() + 1).padStart(2, '0'),
      expiry_year: String(future.getUTCFullYear()),
    };
  }

  /** Past-month expiry (already expired). */
  function buildExpiryPast(): {
    expiry_month: string;
    expiry_year: string;
  } {
    const past = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1),
    );
    return {
      expiry_month: String(past.getUTCMonth() + 1).padStart(2, '0'),
      expiry_year: String(past.getUTCFullYear()),
    };
  }

  beforeEach(async () => {
    // Anchor "now" to a fixed UTC instant well inside the 14-day window
    // before the end of the month. With this anchor (2026-01-25), the last
    // day of January 2026 is ~6 days away — comfortably inside ≤14d.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-25T12:00:00Z'));

    pmFindMany = jest.fn();
    eventsFindFirst = jest.fn();
    eventsCreate = jest.fn().mockResolvedValue(undefined);
    queueAdd = jest.fn().mockResolvedValue(undefined);

    const prismaMock = {
      withoutScope: () => ({
        subscription_payment_methods: { findMany: pmFindMany },
        subscription_events: {
          findFirst: eventsFindFirst,
          create: eventsCreate,
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentMethodExpiryNotifierJob,
        { provide: GlobalPrismaService, useValue: prismaMock },
        {
          provide: getQueueToken('email-notifications'),
          useValue: { add: queueAdd },
        },
      ],
    }).compile();

    job = module.get(PaymentMethodExpiryNotifierJob);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing when there are no payment methods', async () => {
    pmFindMany.mockResolvedValue([]);

    const result = await job.runOnce();

    expect(result).toEqual({ enqueued: 0, skipped: 0 });
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });

  it('enqueues payment-method-expiring.email for a card expiring within 14 days', async () => {
    pmFindMany.mockResolvedValue([
      {
        id: 100,
        store_id: 50,
        store_subscription_id: 7,
        last4: '4242',
        brand: 'visa',
        // Last day of "this month" lands ~6 days from the fake "now"
        ...buildExpiryNearby(true),
      },
    ]);
    eventsFindFirst.mockResolvedValue(null);

    const result = await job.runOnce();

    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [jobName, payload] = queueAdd.mock.calls[0];
    expect(jobName).toBe('subscription.payment-method-expiring.email');
    expect(payload).toMatchObject({
      subscriptionId: 7,
      storeId: 50,
      paymentMethodId: 100,
      last_four: '4242',
      brand: 'visa',
    });
    expect(eventsCreate).toHaveBeenCalledTimes(1);
    expect(eventsCreate.mock.calls[0][0].data).toMatchObject({
      store_subscription_id: 7,
      type: 'state_transition',
      triggered_by_job: 'payment-method-expiry-notifier',
    });
    expect(eventsCreate.mock.calls[0][0].data.payload).toMatchObject({
      reason: 'pm_expiry_notice',
      payment_method_id: 100,
      last_four: '4242',
    });
  });

  it('skips a card already expired (last day before today)', async () => {
    pmFindMany.mockResolvedValue([
      {
        id: 101,
        store_id: 51,
        store_subscription_id: 8,
        last4: '0000',
        brand: 'visa',
        // Past month
        ...buildExpiryPast(),
      },
    ]);
    eventsFindFirst.mockResolvedValue(null);

    const result = await job.runOnce();

    expect(result.enqueued).toBe(0);
    // Already-expired cards are filtered silently (not "skipped" in the
    // throttle sense). The cron leaves them for the dunning flow.
    expect(result.skipped).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });

  it('skips a card whose expiry is more than 14 days out', async () => {
    pmFindMany.mockResolvedValue([
      {
        id: 102,
        store_id: 52,
        store_subscription_id: 9,
        last4: '1111',
        brand: 'mastercard',
        ...buildExpiryNearby(false),
      },
    ]);
    eventsFindFirst.mockResolvedValue(null);

    const result = await job.runOnce();

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });

  it('throttles when a pm_expiry_notice event was logged in the last 7 days', async () => {
    pmFindMany.mockResolvedValue([
      {
        id: 103,
        store_id: 53,
        store_subscription_id: 10,
        last4: '4242',
        brand: 'visa',
        ...buildExpiryNearby(true),
      },
    ]);
    eventsFindFirst.mockResolvedValue({ id: 42 });

    const result = await job.runOnce();

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(queueAdd).not.toHaveBeenCalled();
    expect(eventsCreate).not.toHaveBeenCalled();
  });
});
