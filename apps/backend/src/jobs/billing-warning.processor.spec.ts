// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models). Mirrors the
// pattern used by email-notifications.processor.spec.ts.
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import {
  BillingWarningProcessor,
  BILLING_WARNING_RENEWAL_FAILED,
} from './billing-warning.processor';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { NotificationsService } from '../domains/store/notifications/notifications.service';

describe('BillingWarningProcessor', () => {
  let processor: BillingWarningProcessor;
  let billingWarningLogsCreate: jest.Mock;
  let subsFindFirst: jest.Mock;
  let subscriptionEventsCreate: jest.Mock;
  let createAndBroadcast: jest.Mock;
  let emailQueueAdd: jest.Mock;
  let billingWarningQueueAdd: jest.Mock;

  const storeSub = { id: 999, store_id: 10 };

  beforeEach(async () => {
    billingWarningLogsCreate = jest.fn().mockResolvedValue({ id: 1 });
    subsFindFirst = jest.fn().mockResolvedValue(storeSub);
    subscriptionEventsCreate = jest.fn().mockResolvedValue({ id: 1 });
    createAndBroadcast = jest.fn().mockResolvedValue({
      id: 1,
      type: 'auto_renew_charge_failed',
    });
    emailQueueAdd = jest.fn().mockResolvedValue({ id: 'email-job-1' });
    billingWarningQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });

    const prismaMock = {
      withoutScope: () => ({
        billing_warning_logs: { create: billingWarningLogsCreate },
        store_subscriptions: { findFirst: subsFindFirst },
        subscription_events: { create: subscriptionEventsCreate },
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingWarningProcessor,
        { provide: GlobalPrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: { createAndBroadcast } },
        {
          provide: getQueueToken('email-notifications'),
          useValue: { add: emailQueueAdd },
        },
        {
          provide: getQueueToken('billing-warning'),
          useValue: { add: billingWarningQueueAdd },
        },
      ],
    }).compile();

    processor = module.get(BillingWarningProcessor);
  });

  function makeJob(name: string, data: any): Job<any> {
    return {
      id: 'job-1',
      name,
      data,
      attemptsMade: 0,
    } as unknown as Job<any>;
  }

  describe('billing-warning-renewal-failed handler', () => {
    it('inserts the dedupe row, fans out bell + email, and writes the audit row', async () => {
      const job = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
        storeSubscriptionId: 999,
      });

      const result = await processor.process(job);

      expect(result.inserted).toBe(true);
      expect(result.notificationDispatched).toBe(true);
      expect(result.emailEnqueued).toBe(true);

      // Dedupe row (UNIQUE anchor — the idempotency primitive).
      expect(billingWarningLogsCreate).toHaveBeenCalledWith({
        data: {
          store_id: 10,
          type: 'renewal_failed',
          source_event_id: 5555,
        },
      });

      // Audit row in subscription_events with the new enum value
      // `renewal_failed` and a monotonic event_id payload field.
      expect(subscriptionEventsCreate).toHaveBeenCalledTimes(1);
      const evtArg = subscriptionEventsCreate.mock.calls[0][0];
      expect(evtArg.data.type).toBe('renewal_failed');
      expect(evtArg.data.store_subscription_id).toBe(999);
      expect(evtArg.data.triggered_by_job).toBe('billing-warning');
      expect(evtArg.data.payload).toMatchObject({
        source_event_id: 5555,
        payment_id: 5555,
        store_subscription_id: 999,
        source: 'auto_renewal_failed',
      });
      expect(typeof evtArg.data.payload.event_id).toBe('number');

      // Bell with the canonical title + body copy (must match email so the
      // bell badge and the inbox tell the same story).
      expect(createAndBroadcast).toHaveBeenCalledTimes(1);
      const [storeId, type, title, body, data] = createAndBroadcast.mock.calls[0];
      expect(storeId).toBe(10);
      expect(type).toBe('auto_renew_charge_failed');
      expect(title).toBe('Tu renovación automática falló');
      expect(body).toContain('cobro automático');
      expect(data).toMatchObject({ route: '/admin/subscription/payment' });

      // Email enqueue.
      expect(emailQueueAdd).toHaveBeenCalledTimes(1);
      const [jobName, jobData, opts] = emailQueueAdd.mock.calls[0];
      expect(jobName).toBe('subscription.billing.renewal-failed.email');
      expect(jobData).toEqual({ storeId: 10, subscriptionId: 999 });
      expect(opts.attempts).toBe(3);
      expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
    });

    it('on P2002 dedupe-hit: skips the audit row, bell, and email fan-out (and does NOT throw)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'unique violation',
        { code: 'P2002', clientVersion: 'test' },
      );
      billingWarningLogsCreate.mockRejectedValueOnce(p2002);

      const job = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
      });

      const result = await processor.process(job);

      expect(result.inserted).toBe(false);
      expect(result.notificationDispatched).toBe(false);
      expect(result.emailEnqueued).toBe(false);

      expect(subscriptionEventsCreate).not.toHaveBeenCalled();
      expect(createAndBroadcast).not.toHaveBeenCalled();
      expect(emailQueueAdd).not.toHaveBeenCalled();
    });

    it('still enqueues the email when the bell broadcast throws', async () => {
      createAndBroadcast.mockRejectedValueOnce(new Error('sse exploded'));

      const job = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
        storeSubscriptionId: 999,
      });

      const result = await processor.process(job);

      expect(result.notificationDispatched).toBe(false);
      expect(result.emailEnqueued).toBe(true);
      expect(emailQueueAdd).toHaveBeenCalledTimes(1);
    });

    it('still writes the dedupe row when subscription_events.create throws (audit is best-effort)', async () => {
      subscriptionEventsCreate.mockRejectedValueOnce(new Error('db down'));

      const job = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
        storeSubscriptionId: 999,
      });

      const result = await processor.process(job);

      expect(result.inserted).toBe(true);
      expect(result.emailEnqueued).toBe(true);
      expect(billingWarningLogsCreate).toHaveBeenCalledTimes(1);
    });

    it('resolves the canonical subscription when storeSubscriptionId is omitted', async () => {
      const job = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
      });

      await processor.process(job);

      expect(subsFindFirst).toHaveBeenCalledWith({
        where: { store_id: 10 },
        select: { id: true },
      });
      expect(subscriptionEventsCreate.mock.calls[0][0].data.store_subscription_id).toBe(
        999,
      );
    });

    it('skips the audit row when no subscription can be resolved', async () => {
      subsFindFirst.mockResolvedValueOnce(null);

      const job = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
      });

      const result = await processor.process(job);

      expect(result.inserted).toBe(true);
      expect(result.notificationDispatched).toBe(true);
      expect(result.emailEnqueued).toBe(true);
      expect(subscriptionEventsCreate).not.toHaveBeenCalled();
    });

    it('returns noop for invalid storeId or sourceEventId without calling the DB', async () => {
      const jobBadStore = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 0,
        sourceEventId: 5555,
        paymentId: 5555,
      });
      const jobBadEvent = makeJob(BILLING_WARNING_RENEWAL_FAILED, {
        storeId: 10,
        sourceEventId: 0,
        paymentId: 5555,
      });

      const r1 = await processor.process(jobBadStore);
      const r2 = await processor.process(jobBadEvent);

      expect(r1.inserted).toBe(false);
      expect(r2.inserted).toBe(false);
      expect(billingWarningLogsCreate).not.toHaveBeenCalled();
    });
  });

  describe('@OnEvent(subscription.payment.retry.failed) listener', () => {
    it('enqueues a billing-warning-renewal-failed job for valid payloads', async () => {
      await processor.handleRetryFailedEvent({
        invoiceId: 1,
        subscriptionId: 999,
        storeId: 10,
        attempt: 4,
        paymentId: 5555,
      });

      expect(billingWarningQueueAdd).toHaveBeenCalledTimes(1);
      const [jobName, jobData] = billingWarningQueueAdd.mock.calls[0];
      expect(jobName).toBe(BILLING_WARNING_RENEWAL_FAILED);
      expect(jobData).toMatchObject({
        storeId: 10,
        sourceEventId: 5555,
        paymentId: 5555,
        storeSubscriptionId: 999,
      });
    });

    it('drops events with missing fields without throwing', async () => {
      await processor.handleRetryFailedEvent({
        invoiceId: 1,
        subscriptionId: 999,
        attempt: 1,
      } as any);

      expect(billingWarningQueueAdd).not.toHaveBeenCalled();
    });

    it('swallows queue enqueue errors so the listener never tears down', async () => {
      billingWarningQueueAdd.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        processor.handleRetryFailedEvent({
          invoiceId: 1,
          subscriptionId: 999,
          storeId: 10,
          attempt: 4,
          paymentId: 5555,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
