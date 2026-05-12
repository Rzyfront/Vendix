import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EmailService } from '../email/email.service';
import { SubscriptionEmailTemplates } from '../email/templates/subscription-emails';

/**
 * G10 — Single dispatcher worker for the `email-notifications` BullMQ queue.
 *
 * Job names handled (canonical list):
 *   - subscription.welcome.email             (G3)
 *   - subscription.cancellation.email        (G3, with includeNoRefundNotice)
 *   - subscription.reactivation.email        (G3)
 *   - payment.confirmed.email                (post-payment listener)
 *   - trial.ending.email                     (G2 trial notifier — buckets 3d/1d/today)
 *
 * Future job names (templates exist as stubs, no caller yet — see
 * SubscriptionEmailTemplates):
 *   - dunning.soft.email
 *   - dunning.hard.email
 *   - subscription.suspended.email
 *   - subscription.payment-failed.email
 *   - subscription.cancellation-immediate.email
 *   - subscription.payment-method-expiring.email
 *   - subscription.retention-offer.email
 *
 * Architecture notes:
 *   - All copy is in Spanish (es-CO). No i18n keys.
 *   - Each handler resolves whatever extra Prisma data it needs (subscription,
 *     store, organization, plan) using `withoutScope()` since this worker has
 *     no tenant context.
 *   - Recipient is the parent organization email — Vendix bills the org, not
 *     individual store users.
 *   - On unrecoverable error we throw so BullMQ honours the per-job retry
 *     policy (`attempts: 3`, exponential backoff) configured by the enqueuers.
 *   - Idempotency: there is no `notification_log` table in the schema yet. If
 *     BullMQ retries a job, the customer may receive the email twice. We log
 *     a clear warning when `job.attemptsMade > 0` so this is observable.
 *     TODO(G10-followup): introduce `notification_log` for true dedup by
 *     `(job_id, template)`.
 *   - This processor REPLACES the old `PaymentConfirmedEmailJob` (also a
 *     `@Processor('email-notifications')`). Two WorkerHosts on the same queue
 *     would race for jobs and one would log "Unknown email job" for half the
 *     traffic. `PaymentConfirmedEmailJob` is unregistered in `JobsModule`.
 */
@Processor('email-notifications')
export class EmailNotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailNotificationsProcessor.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(job: Job): Promise<{ success: boolean; sentTo?: string }> {
    if (job.attemptsMade > 0) {
      this.logger.warn(
        `EMAIL_RETRY name=${job.name} jobId=${job.id} attempt=${job.attemptsMade + 1} (no notification_log table — duplicate delivery possible)`,
      );
    }

    this.logger.log(
      `EMAIL_DISPATCH name=${job.name} jobId=${job.id} payloadKeys=${Object.keys(job.data || {}).join(',')}`,
    );

    try {
      switch (job.name) {
        case 'subscription.welcome.email':
          return await this.handleWelcome(job);
        case 'subscription.cancellation.email':
          return await this.handleCancellation(job);
        case 'subscription.reactivation.email':
          return await this.handleReactivation(job);
        case 'payment.confirmed.email':
          return await this.handlePaymentConfirmed(job);
        case 'trial.ending.email':
          return await this.handleTrialEnding(job);
        case 'subscription.payment-method-expiring.email':
          return await this.handlePaymentMethodExpiring(job);
        case 'subscription.payment-method-expired.email':
          return await this.handlePaymentMethodExpired(job);
        case 'subscription.payment-method-invalidated-failures.email':
          return await this.handlePaymentMethodInvalidatedFailures(job);
        // Future: when the corresponding gaps land, switch the stubs to
        // real handlers backed by SubscriptionEmailTemplates.
        case 'dunning.soft.email':
        case 'dunning.hard.email':
        case 'subscription.suspended.email':
        case 'subscription.payment-failed.email':
        case 'subscription.cancellation-immediate.email':
        case 'subscription.retention-offer.email':
          this.logger.warn(
            `EMAIL_NOT_IMPLEMENTED name=${job.name} jobId=${job.id} — template exists as stub but no handler wired yet (see SubscriptionEmailTemplates)`,
          );
          return { success: false };
        default:
          this.logger.warn(
            `EMAIL_UNKNOWN_JOB name=${job.name} jobId=${job.id} — no handler for this job name`,
          );
          return { success: false };
      }
    } catch (err: any) {
      // Re-throw so BullMQ honours retry policy. Logged with structured
      // context for observability.
      this.logger.error(
        `EMAIL_FAIL name=${job.name} jobId=${job.id} error=${err?.message ?? err}`,
        err?.stack,
      );
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  private async handleWelcome(
    job: Job<{ subscriptionId?: number | null; storeId: number }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId } = job.data;
    const ctx = await this.loadStoreContext(storeId, subscriptionId ?? null);
    if (!ctx) return { success: false };

    const tpl = SubscriptionEmailTemplates.welcome({
      storeName: ctx.storeName,
      organizationName: ctx.organizationName,
      planName: ctx.planName,
      // TODO(G10-email-adapter): replace with real panel URL once a
      // domain-aware URL helper exists for SaaS notifications.
      panelUrl: undefined,
    });
    return this.dispatch(ctx.recipient, tpl, job);
  }

  private async handleCancellation(
    job: Job<{
      subscriptionId?: number | null;
      storeId: number;
      includeNoRefundNotice?: boolean;
      reason?: string;
    }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId, includeNoRefundNotice } = job.data;
    const ctx = await this.loadStoreContext(storeId, subscriptionId ?? null);
    if (!ctx) return { success: false };

    const tpl = SubscriptionEmailTemplates.cancellation({
      storeName: ctx.storeName,
      organizationName: ctx.organizationName,
      planName: ctx.planName,
      endsAt: ctx.currentPeriodEnd,
      includeNoRefundNotice: includeNoRefundNotice !== false, // default true
      reactivateUrl: undefined,
    });
    return this.dispatch(ctx.recipient, tpl, job);
  }

  private async handleReactivation(
    job: Job<{ subscriptionId?: number | null; storeId: number }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId } = job.data;
    const ctx = await this.loadStoreContext(storeId, subscriptionId ?? null);
    if (!ctx) return { success: false };

    const tpl = SubscriptionEmailTemplates.reactivation({
      storeName: ctx.storeName,
      organizationName: ctx.organizationName,
      planName: ctx.planName,
      nextRenewalDate: ctx.nextBillingAt,
    });
    return this.dispatch(ctx.recipient, tpl, job);
  }

  private async handlePaymentConfirmed(
    job: Job<{ invoiceId: number; paymentId: number; storeId: number }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { invoiceId, storeId } = job.data;

    const invoice = await this.prisma
      .withoutScope()
      .subscription_invoices.findUnique({
        where: { id: invoiceId },
        include: { store_subscription: { include: { plan: true } } },
      });

    if (!invoice) {
      this.logger.warn(
        `EMAIL_SKIP name=payment.confirmed.email jobId=${job.id} reason=invoice_not_found invoiceId=${invoiceId}`,
      );
      return { success: false };
    }

    const store = await this.prisma.withoutScope().stores.findUnique({
      where: { id: storeId },
      include: { organizations: true },
    });

    const recipient = store?.organizations?.email;
    if (!recipient) {
      this.logger.warn(
        `EMAIL_SKIP name=payment.confirmed.email jobId=${job.id} reason=no_org_email storeId=${storeId}`,
      );
      return { success: false };
    }

    const tpl = SubscriptionEmailTemplates.paymentConfirmed({
      invoiceNumber: invoice.invoice_number,
      amount: invoice.total.toFixed(2),
      currency: invoice.currency,
      planName: invoice.store_subscription?.plan?.name || 'Suscripción Vendix',
      periodStart: invoice.period_start
        ? new Date(invoice.period_start).toLocaleDateString('es-CO')
        : 'N/A',
      periodEnd: invoice.period_end
        ? new Date(invoice.period_end).toLocaleDateString('es-CO')
        : 'N/A',
      storeName: store?.name,
      organizationName: store?.organizations?.name,
      paymentMethod: 'Wompi',
    });

    return this.dispatch(recipient, tpl, job);
  }

  private async handleTrialEnding(
    job: Job<{
      subscriptionId: number;
      storeId: number;
      bucket: 'today' | '1d' | '3d';
      trialEndsAt?: string;
    }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId, bucket, trialEndsAt } = job.data;

    if (!['today', '1d', '3d'].includes(bucket)) {
      this.logger.warn(
        `EMAIL_SKIP name=trial.ending.email jobId=${job.id} reason=invalid_bucket bucket=${bucket}`,
      );
      return { success: false };
    }

    const ctx = await this.loadStoreContext(storeId, subscriptionId);
    if (!ctx) return { success: false };

    const tpl = SubscriptionEmailTemplates.trialEnding({
      storeName: ctx.storeName,
      organizationName: ctx.organizationName,
      planName: ctx.planName,
      bucket,
      trialEndsAt: trialEndsAt
        ? new Date(trialEndsAt).toLocaleDateString('es-CO')
        : ctx.trialEndsAt,
      upgradeUrl: undefined,
    });
    return this.dispatch(ctx.recipient, tpl, job);
  }

  /**
   * G11 — `subscription.payment-method-expiring.email` handler.
   *
   * Triggered by `PaymentMethodExpiryNotifierJob` (daily 10:00 UTC) when a
   * tokenized card on an active/trial subscription is within 14 days of
   * expiry. The reminder is throttled at the cron level (7-day window) so
   * we trust the payload here.
   */
  private async handlePaymentMethodExpiring(
    job: Job<{
      subscriptionId: number;
      storeId: number;
      paymentMethodId: number;
      last_four?: string | null;
      brand?: string | null;
      expiry_month?: string | null;
      expiry_year?: string | null;
    }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId, expiry_month, expiry_year, last_four } =
      job.data;

    const ctx = await this.loadStoreContext(storeId, subscriptionId ?? null);
    if (!ctx) return { success: false };

    const expiresOn =
      expiry_month && expiry_year
        ? `${String(expiry_month).padStart(2, '0')}/${String(expiry_year).slice(-2)}`
        : undefined;

    const tpl = SubscriptionEmailTemplates.paymentMethodExpiring({
      storeName: ctx.storeName,
      cardLast4: last_four ?? undefined,
      expiresOn,
      // TODO(G10-email-adapter): real domain-aware URL helper.
      updateUrl: undefined,
    });
    return this.dispatch(ctx.recipient, tpl, job);
  }

  /**
   * S2.2 — `subscription.payment-method-expired.email` handler.
   *
   * Triggered by `PaymentMethodExpiryNotifierJob` post-expiry pass when a
   * tokenized card transitions to `state='invalid'`. The reminder is one-shot
   * per invalidation transition (the cron filters on `state='active'` so the
   * next run cannot re-enqueue).
   */
  private async handlePaymentMethodExpired(
    job: Job<{
      subscriptionId: number;
      storeId: number;
      paymentMethodId: number;
      last_four?: string | null;
      brand?: string | null;
      expiry_month?: string | null;
      expiry_year?: string | null;
      expired_on?: string | null;
    }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId, last_four, brand, expired_on } = job.data;

    const ctx = await this.loadStoreContext(storeId, subscriptionId ?? null);
    if (!ctx) return { success: false };

    const expiredOnFmt = expired_on
      ? new Date(expired_on).toLocaleDateString('es-CO')
      : undefined;

    const tpl = SubscriptionEmailTemplates.paymentMethodExpired({
      storeName: ctx.storeName,
      cardLast4: last_four ?? undefined,
      cardBrand: brand ?? undefined,
      expiredOn: expiredOnFmt,
      // TODO(G10-email-adapter): real domain-aware URL helper.
      updateUrl: undefined,
    });
    return this.dispatch(ctx.recipient, tpl, job);
  }

  /**
   * S3.5 — `subscription.payment-method-invalidated-failures.email` handler.
   *
   * Triggered by `SubscriptionPaymentService.bumpPaymentMethodFailure` when
   * a saved payment method reaches `MAX_CONSECUTIVE_FAILURES` consecutive
   * failed automatic charges and is auto-marked `state='invalid'`. The
   * notification is one-shot per invalidation transition (the bump only
   * crosses the threshold once before the PM leaves `state='active'`).
   */
  private async handlePaymentMethodInvalidatedFailures(
    job: Job<{
      subscriptionId: number;
      storeId: number;
      paymentMethodId: number;
      last_four?: string | null;
      brand?: string | null;
      consecutive_failures: number;
    }>,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const { subscriptionId, storeId, last_four, brand, consecutive_failures } =
      job.data;

    const ctx = await this.loadStoreContext(storeId, subscriptionId ?? null);
    if (!ctx) return { success: false };

    const tpl =
      SubscriptionEmailTemplates.subscriptionPaymentMethodInvalidatedDueToFailures(
        {
          storeName: ctx.storeName,
          cardLast4: last_four ?? undefined,
          cardBrand: brand ?? undefined,
          consecutiveFailures: consecutive_failures,
          // TODO(G10-email-adapter): real domain-aware URL helper.
          updateUrl: undefined,
        },
      );
    return this.dispatch(ctx.recipient, tpl, job);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the store + org + plan + subscription bag in a single pass. Used
   * by every handler that does not already load its own (e.g. payment
   * confirmation handler loads from invoice).
   */
  private async loadStoreContext(
    storeId: number,
    subscriptionId: number | null,
  ): Promise<{
    recipient: string;
    storeName: string;
    organizationName?: string;
    planName: string;
    currentPeriodEnd?: string;
    nextBillingAt?: string;
    trialEndsAt?: string;
  } | null> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      this.logger.warn(`EMAIL_SKIP reason=invalid_store_id storeId=${storeId}`);
      return null;
    }

    const store = await this.prisma.withoutScope().stores.findUnique({
      where: { id: storeId },
      include: { organizations: true },
    });

    if (!store) {
      this.logger.warn(`EMAIL_SKIP reason=store_not_found storeId=${storeId}`);
      return null;
    }

    const recipient = store.organizations?.email;
    if (!recipient) {
      this.logger.warn(`EMAIL_SKIP reason=no_org_email storeId=${storeId}`);
      return null;
    }

    // Resolve the subscription. Prefer the explicit subscriptionId; fall back
    // to the canonical 1:1 store_subscription for the store.
    const sub = subscriptionId
      ? await this.prisma.withoutScope().store_subscriptions.findUnique({
          where: { id: subscriptionId },
          include: { plan: true },
        })
      : await this.prisma.withoutScope().store_subscriptions.findFirst({
          where: { store_id: storeId },
          include: { plan: true },
        });

    if (!sub) {
      this.logger.warn(
        `EMAIL_SKIP reason=subscription_not_found storeId=${storeId} subscriptionId=${subscriptionId ?? 'auto'}`,
      );
      return null;
    }

    return {
      recipient,
      storeName: store.name,
      organizationName: store.organizations?.name,
      planName: sub.plan?.name || 'Suscripción Vendix',
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end).toLocaleDateString('es-CO')
        : undefined,
      nextBillingAt: sub.next_billing_at
        ? new Date(sub.next_billing_at).toLocaleDateString('es-CO')
        : undefined,
      trialEndsAt: sub.trial_ends_at
        ? new Date(sub.trial_ends_at).toLocaleDateString('es-CO')
        : undefined,
    };
  }

  private async dispatch(
    recipient: string,
    tpl: { subject: string; html: string; text: string },
    job: Job,
  ): Promise<{ success: boolean; sentTo?: string }> {
    const result = await this.emailService.sendEmail(
      recipient,
      tpl.subject,
      tpl.html,
      tpl.text,
    );

    if (result.success) {
      this.logger.log(
        `EMAIL_SENT name=${job.name} jobId=${job.id} to=${recipient} subject="${tpl.subject}"`,
      );
      return { success: true, sentTo: recipient };
    }

    // Throw to trigger BullMQ retry. The provider already logs the underlying
    // error; we add the job context here.
    throw new Error(
      `EMAIL_SEND_FAILED name=${job.name} jobId=${job.id} to=${recipient}: ${result.error ?? 'unknown'}`,
    );
  }
}
