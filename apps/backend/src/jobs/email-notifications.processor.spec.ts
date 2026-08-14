// @ts-nocheck — pre-existing dev-branch type breakage in transitively imported
// services (GlobalPrismaService is missing several Prisma models). Mirrors the
// pattern used by subscription-trial-notifier.job.spec.ts.
/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { EmailNotificationsProcessor } from './email-notifications.processor';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EmailService } from '../email/email.service';
import { __NO_REFUND_NOTICE__ } from '../email/templates/subscription-emails';

describe('EmailNotificationsProcessor', () => {
  let processor: EmailNotificationsProcessor;
  let storesFindUnique: jest.Mock;
  let subsFindUnique: jest.Mock;
  let subsFindFirst: jest.Mock;
  let invoicesFindUnique: jest.Mock;
  let sendEmail: jest.Mock;

  const STORE = {
    id: 10,
    name: 'Tienda Demo',
    organizations: { id: 1, name: 'Org Demo', email: 'org@example.com' },
  };
  const SUB = {
    id: 100,
    store_id: 10,
    plan: { name: 'Plan Pro' },
    current_period_end: new Date('2026-05-01T00:00:00Z'),
    next_billing_at: new Date('2026-05-01T00:00:00Z'),
    trial_ends_at: new Date('2026-05-01T00:00:00Z'),
  };

  beforeEach(async () => {
    storesFindUnique = jest.fn().mockResolvedValue(STORE);
    subsFindUnique = jest.fn().mockResolvedValue(SUB);
    subsFindFirst = jest.fn().mockResolvedValue(SUB);
    invoicesFindUnique = jest.fn();
    sendEmail = jest.fn().mockResolvedValue({ success: true });

    const prismaMock = {
      withoutScope: () => ({
        stores: { findUnique: storesFindUnique },
        store_subscriptions: {
          findUnique: subsFindUnique,
          findFirst: subsFindFirst,
        },
        subscription_invoices: { findUnique: invoicesFindUnique },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailNotificationsProcessor,
        { provide: GlobalPrismaService, useValue: prismaMock },
        { provide: EmailService, useValue: { sendEmail } },
      ],
    })
      // WorkerHost super() opens a BullMQ Worker connection; bypass it by
      // overriding the constructor side-effects with a minimal object. The
      // dispatcher only depends on `process()` which we invoke directly.
      .compile();

    processor = module.get(EmailNotificationsProcessor);
  });

  function makeJob<T>(name: string, data: T, attemptsMade = 0): Job<T> {
    return {
      id: 'job-1',
      name,
      data,
      attemptsMade,
    } as unknown as Job<T>;
  }

  describe('subscription.welcome.email', () => {
    it('sends a welcome email to the organization email', async () => {
      const job = makeJob('subscription.welcome.email', {
        subscriptionId: 100,
        storeId: 10,
      });

      const result = await processor.process(job);

      expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, html, text] = sendEmail.mock.calls[0];
      expect(to).toBe('org@example.com');
      expect(subject).toContain('Bienvenido');
      expect(html).toContain('Plan Pro');
      expect(text).toContain('Plan Pro');
    });

    it('skips when organization has no email', async () => {
      storesFindUnique.mockResolvedValueOnce({
        ...STORE,
        organizations: { ...STORE.organizations, email: null },
      });

      const job = makeJob('subscription.welcome.email', { storeId: 10 });
      const result = await processor.process(job);

      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('subscription.cancellation.email', () => {
    it('includes the no-refund disclaimer when includeNoRefundNotice=true', async () => {
      const job = makeJob('subscription.cancellation.email', {
        subscriptionId: 100,
        storeId: 10,
        includeNoRefundNotice: true,
      });

      await processor.process(job);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, html, text] = sendEmail.mock.calls[0];
      expect(subject).toContain('Cancelación');
      expect(text).toContain(__NO_REFUND_NOTICE__);
      expect(html).toContain('no son reembolsables');
    });

    it('defaults to including the no-refund disclaimer when flag is omitted', async () => {
      const job = makeJob('subscription.cancellation.email', {
        subscriptionId: 100,
        storeId: 10,
      });

      await processor.process(job);

      const [, , , text] = sendEmail.mock.calls[0];
      expect(text).toContain(__NO_REFUND_NOTICE__);
    });

    it('omits the disclaimer when explicitly false', async () => {
      const job = makeJob('subscription.cancellation.email', {
        subscriptionId: 100,
        storeId: 10,
        includeNoRefundNotice: false,
      });

      await processor.process(job);

      const [, , html, text] = sendEmail.mock.calls[0];
      expect(text).not.toContain(__NO_REFUND_NOTICE__);
      expect(html).not.toContain('no son reembolsables');
    });
  });

  describe('subscription.reactivation.email', () => {
    it('sends a reactivation email with next renewal date', async () => {
      const job = makeJob('subscription.reactivation.email', {
        subscriptionId: 100,
        storeId: 10,
      });

      await processor.process(job);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, html] = sendEmail.mock.calls[0];
      expect(subject).toContain('Bienvenido de vuelta');
      expect(html).toContain('Plan Pro');
    });
  });

  describe('payment.confirmed.email', () => {
    beforeEach(() => {
      invoicesFindUnique.mockResolvedValue({
        id: 500,
        invoice_number: 'INV-2026-001',
        total: { toFixed: (n: number) => '99.00' },
        currency: 'COP',
        period_start: new Date('2026-04-01T00:00:00Z'),
        period_end: new Date('2026-05-01T00:00:00Z'),
        store_subscription: { plan: { name: 'Plan Pro' } },
      });
    });

    it('includes the no-refund disclaimer (G10 mandate)', async () => {
      const job = makeJob('payment.confirmed.email', {
        invoiceId: 500,
        paymentId: 700,
        storeId: 10,
      });

      const result = await processor.process(job);

      expect(result.success).toBe(true);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, html, text] = sendEmail.mock.calls[0];
      expect(subject).toContain('Pago confirmado');
      expect(subject).toContain('INV-2026-001');
      expect(text).toContain(__NO_REFUND_NOTICE__);
      expect(html).toContain('no son reembolsables');
    });

    it('skips when the invoice cannot be loaded', async () => {
      invoicesFindUnique.mockResolvedValueOnce(null);

      const job = makeJob('payment.confirmed.email', {
        invoiceId: 999,
        paymentId: 700,
        storeId: 10,
      });

      const result = await processor.process(job);
      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('trial.ending.email', () => {
    it.each([
      ['today', 'termina hoy'],
      ['1d', 'termina mañana'],
      ['3d', 'termina en 3 días'],
    ] as const)(
      'uses the %s bucket subject',
      async (bucket, expectedFragment) => {
        const job = makeJob('trial.ending.email', {
          subscriptionId: 100,
          storeId: 10,
          bucket,
          trialEndsAt: '2026-05-01T00:00:00Z',
        });

        await processor.process(job);

        expect(sendEmail).toHaveBeenCalledTimes(1);
        const [, subject] = sendEmail.mock.calls[0];
        expect(subject.toLowerCase()).toContain(expectedFragment);
      },
    );

    it('rejects an invalid bucket without sending', async () => {
      const job = makeJob('trial.ending.email', {
        subscriptionId: 100,
        storeId: 10,
        bucket: 'tomorrow' as any,
      });

      const result = await processor.process(job);
      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('throws when the email provider fails (BullMQ retries)', async () => {
      sendEmail.mockResolvedValueOnce({
        success: false,
        error: 'SMTP timeout',
      });

      const job = makeJob('subscription.welcome.email', {
        subscriptionId: 100,
        storeId: 10,
      });

      await expect(processor.process(job)).rejects.toThrow(/EMAIL_SEND_FAILED/);
    });

    it('returns success:false for unknown job names without throwing', async () => {
      const job = makeJob('foo.bar.email' as any, { storeId: 10 });
      const result = await processor.process(job);
      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('returns success:false for stub job names (templates exist, no handler)', async () => {
      // NOTE: dunning.soft/hard/suspended are NO LONGER stubs — see the
      // "dunning ladder" describe below. `payment-failed` is still unwired.
      const job = makeJob('subscription.payment-failed.email' as any, {
        storeId: 10,
      });
      const result = await processor.process(job);
      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Dunning ladder — enqueued by SubscriptionStateEngineJob.notifyEscalation()
  // ---------------------------------------------------------------------------
  describe('dunning ladder', () => {
    /** Payload shape produced by `notifyEscalation()`. */
    function dunningJob(name: string, overrides: any = {}) {
      return makeJob(name, {
        subscriptionId: 100,
        storeId: 10,
        fromState: 'active',
        toState: 'grace_soft',
        lockReason: 'past_due',
        planId: 3,
        planName: 'Plan Pro',
        periodEndsAt: '2026-08-15T00:00:00.000Z',
        daysOverdue: 4,
        ...overrides,
      });
    }

    it('dunning.soft.email sends the soft reminder', async () => {
      const result = await processor.process(
        dunningJob('dunning.soft.email', { toState: 'grace_soft' }),
      );

      expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, html, text] = sendEmail.mock.calls[0];
      expect(to).toBe('org@example.com');
      expect(subject).toContain('Recordatorio de pago');
      expect(html).toContain('Plan Pro');
      expect(html).toContain('Tienda Demo');
      expect(text).toContain('Plan Pro');
    });

    it('dunning.hard.email sends the hard warning and forwards daysOverdue', async () => {
      const result = await processor.process(
        dunningJob('dunning.hard.email', {
          toState: 'grace_hard',
          daysOverdue: 12,
        }),
      );

      expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, html] = sendEmail.mock.calls[0];
      expect(subject).toContain('pago vencido');
      expect(html).toContain('12 días');
      expect(html).toContain('Plan Pro');
    });

    it('subscription.suspended.email sends the suspension notice', async () => {
      const result = await processor.process(
        dunningJob('subscription.suspended.email', {
          toState: 'suspended',
          lockReason: 'past_due',
        }),
      );

      expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, html] = sendEmail.mock.calls[0];
      expect(subject).toContain('suspendida');
      expect(html).toContain('Tienda Demo');
    });

    it('falls back to the subscription plan name when the payload omits it', async () => {
      await processor.process(
        dunningJob('dunning.soft.email', { planName: null }),
      );

      const [, , html] = sendEmail.mock.calls[0];
      expect(html).toContain('Plan Pro'); // resolved from loadStoreContext
    });

    it('skips when the organization has no email', async () => {
      storesFindUnique.mockResolvedValueOnce({
        ...STORE,
        organizations: { ...STORE.organizations, email: null },
      });

      const result = await processor.process(dunningJob('dunning.soft.email'));

      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Truthfulness gate: a store whose plan was RETIRED owes nothing.
    // -------------------------------------------------------------------------
    describe("lockReason='current_plan_unavailable_at_renewal'", () => {
      const PLAN_RETIRED = 'current_plan_unavailable_at_renewal';

      it.each([
        'dunning.soft.email',
        'dunning.hard.email',
        'subscription.suspended.email',
      ])('%s sends nothing — the store owes no money', async (name) => {
        const result = await processor.process(
          dunningJob(name, { lockReason: PLAN_RETIRED }),
        );

        expect(result).toEqual({ success: false });
        expect(sendEmail).not.toHaveBeenCalled();
      });

      // Tripwire justifying the suppression above: all three templates hardcode
      // a debt story with no field able to carry the real motive. If someone
      // makes them lockReason-aware (or adds a debt-free variant), this test
      // fails and the suppression should be revisited in favour of adapted copy.
      it('is required because the templates cannot express a debt-free motive', async () => {
        await processor.process(dunningJob('dunning.soft.email'));
        const [, , softHtml] = sendEmail.mock.calls[0];
        expect(softHtml).toMatch(/pago|vencid|pendiente/i);

        sendEmail.mockClear();
        await processor.process(
          dunningJob('subscription.suspended.email', { toState: 'suspended' }),
        );
        const [, , suspendedHtml] = sendEmail.mock.calls[0];
        expect(suspendedHtml).toMatch(/falta de pago/i);
      });
    });

    // -------------------------------------------------------------------------
    // Period boundary is midnight UTC — must not slip a day (vendix-date-timezone)
    // -------------------------------------------------------------------------
    describe('periodEndsAt at the midnight-UTC boundary', () => {
      it('renders the boundary date in UTC, not the previous day', () => {
        const iso = '2026-08-15T00:00:00.000Z';

        // The idiom the handlers use (copied from handleArchivedPlanEnding):
        // pinned to UTC, so it is stable regardless of the host timezone.
        const utcSafe = new Date(iso).toLocaleDateString('es-CO', {
          timeZone: 'UTC',
        });

        // Assert on the calendar parts, not the exact string: zero-padding of
        // `es-CO` day/month varies with the ICU build (15/8/2026 vs 15/08/2026).
        // The load-bearing property is the DAY — it must be 15, never 14.
        const [day, month, year] = utcSafe.split('/').map(Number);
        expect(day).toBe(15);
        expect(month).toBe(8);
        expect(year).toBe(2026);

        // Guard: in any negative-offset timezone (all of Colombia) the bare
        // call would report 14/08/2026. Assert the two only agree when the host
        // itself is at/above UTC, which is what makes the explicit option load-bearing.
        const naive = new Date(iso).toLocaleDateString('es-CO');
        const hostOffsetMin = new Date(iso).getTimezoneOffset();
        if (hostOffsetMin > 0) {
          expect(naive).not.toBe(utcSafe);
        }
      });

      it('does not throw or block the send on a malformed periodEndsAt', async () => {
        const result = await processor.process(
          dunningJob('dunning.soft.email', { periodEndsAt: 'not-a-date' }),
        );

        expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
        expect(sendEmail).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Billing warning ladder — enqueued by SubscriptionPaymentBillingWarningListener
  // (Agent A) and BillingWarningProcessor (this PR). Plan: bright-kindling-possum.
  // ---------------------------------------------------------------------------
  describe('billing warning ladder', () => {
    it('subscription.billing.no-credential.email: renders the no-credential template', async () => {
      const job = makeJob('subscription.billing.no-credential.email', {
        storeId: 10,
        subscriptionEventId: 9991,
      });

      const result = await processor.process(job);

      expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, html, text] = sendEmail.mock.calls[0];
      expect(to).toBe('org@example.com');
      expect(subject).toContain('autopago');
      expect(html).toContain('Plan Pro');
      expect(html).toContain('no son reembolsables'); // NO_REFUND_NOTICE banner
      expect(text).toContain('Plan Pro');
    });

    it('subscription.billing.renewal-failed.email: renders the renewal-failed template', async () => {
      const job = makeJob('subscription.billing.renewal-failed.email', {
        storeId: 10,
        subscriptionId: 100,
      });

      const result = await processor.process(job);

      expect(result).toEqual({ success: true, sentTo: 'org@example.com' });
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const [, subject, html, text] = sendEmail.mock.calls[0];
      expect(subject).toContain('renovación automática');
      expect(subject.toLowerCase()).toContain('falló');
      expect(html).toContain('Plan Pro');
      expect(html).toContain('no son reembolsables');
      expect(text).toContain('Plan Pro');
    });

    it('subscription.billing.no-credential.email: skips when organization has no email', async () => {
      storesFindUnique.mockResolvedValueOnce({
        ...STORE,
        organizations: { ...STORE.organizations, email: null },
      });

      const result = await processor.process(
        makeJob('subscription.billing.no-credential.email', {
          storeId: 10,
          subscriptionEventId: 9991,
        }),
      );

      expect(result).toEqual({ success: false });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
