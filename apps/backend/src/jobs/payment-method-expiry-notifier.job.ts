import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, subscription_payment_method_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

/**
 * G11 — Daily cron (05:00 UTC, RNC-26) that runs TWO complementary passes:
 *
 *  1. **Pre-expiry notice** (existing): warn stores whose tokenized card on an
 *     active/trial subscription will expire within the next 14 days. Throttled
 *     7 days via a `subscription_events` row with `payload.reason=
 *     'pm_expiry_notice'`. The actual email rendering happens in
 *     `EmailNotificationsProcessor` under job name
 *     `subscription.payment-method-expiring.email`.
 *
 *  2. **Post-expiry invalidation** (Sprint 2 — `S2.2`): close the loop. Cards
 *     that are still in `state='active'` past their MM/YY expiration are
 *     transitioned to `state='invalid'`. If the invalidated card was the
 *     `is_default`, the most recently created remaining `active` card on the
 *     same store is promoted to default. A structured log
 *     `PAYMENT_METHOD_INVALIDATED` is emitted, an audit row is written to
 *     `subscription_events` with `payload.reason='payment_method_invalidated'`,
 *     and the dedicated email job
 *     `subscription.payment-method-expired.email` (template
 *     `SubscriptionEmailTemplates.paymentMethodExpired`) is enqueued.
 *
 * Idempotency: the post-expiry pass is naturally idempotent because the
 * `WHERE state='active'` filter excludes already-invalidated rows. The
 * notification email is one-shot per invalidation transition (the next run
 * will not re-enqueue because state is no longer `active`).
 *
 * TODO(G11-event-enum): when `subscription_event_type_enum` gains dedicated
 *   `payment_method_expiring_notice` and `payment_method_invalidated` values,
 *   switch to those and drop the `payload.reason` filter.
 */
@Injectable()
export class PaymentMethodExpiryNotifierJob {
  private readonly logger = new Logger(PaymentMethodExpiryNotifierJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  @Cron('0 5 * * *')
  async handleExpiryNotifications(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'PaymentMethodExpiryNotifierJob already running, skipping',
      );
      return;
    }
    this.isRunning = true;
    try {
      await this.runOnce();
      await this.runPostExpiryInvalidation();
    } catch (err: any) {
      this.logger.error(
        `PM expiry notifier batch failed: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /** Visible for tests. */
  async runOnce(): Promise<{ enqueued: number; skipped: number }> {
    const now = new Date();
    const fourteenDaysFromNow = new Date(
      now.getTime() + 14 * 24 * 60 * 60 * 1000,
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Pull every active payment method whose subscription is in a billing-
    // relevant state. The expiry filter happens in JS because expiry_month /
    // expiry_year are stored as strings (VarChar) — see schema.
    const candidates = await this.prisma
      .withoutScope()
      .subscription_payment_methods.findMany({
        where: {
          state: subscription_payment_method_state_enum.active,
          store_subscription: {
            state: { in: ['active', 'trial'] },
          },
          NOT: [{ expiry_month: null }, { expiry_year: null }],
        },
        select: {
          id: true,
          store_id: true,
          store_subscription_id: true,
          last4: true,
          brand: true,
          expiry_month: true,
          expiry_year: true,
        },
        take: 500,
      });

    if (candidates.length === 0) {
      return { enqueued: 0, skipped: 0 };
    }

    let enqueued = 0;
    let skipped = 0;

    for (const pm of candidates) {
      try {
        if (!pm.expiry_month || !pm.expiry_year) continue;

        const expiresOn = this.computeExpiryDate(
          pm.expiry_month,
          pm.expiry_year,
        );
        if (!expiresOn) continue;

        // Window: still in the future AND within 14 days.
        if (expiresOn.getTime() < now.getTime()) {
          // Already expired — not the responsibility of this job. The
          // payment-failed flow / consecutive_failures path will invalidate
          // the PM after the next charge attempt.
          continue;
        }
        if (expiresOn.getTime() > fourteenDaysFromNow.getTime()) {
          continue;
        }

        // Throttle: skip if a notice row was written in the last 7 days for
        // this same payment method.
        const lastReminder = await this.prisma
          .withoutScope()
          .subscription_events.findFirst({
            where: {
              store_subscription_id: pm.store_subscription_id,
              type: 'state_transition',
              created_at: { gte: sevenDaysAgo },
              payload: {
                path: ['reason'],
                equals: 'pm_expiry_notice',
              },
              AND: [
                {
                  payload: {
                    path: ['payment_method_id'],
                    equals: pm.id,
                  },
                },
              ],
            },
            select: { id: true },
          });

        if (lastReminder) {
          skipped++;
          continue;
        }

        await this.emailQueue.add(
          'subscription.payment-method-expiring.email',
          {
            subscriptionId: pm.store_subscription_id,
            storeId: pm.store_id,
            paymentMethodId: pm.id,
            last_four: pm.last4 ?? null,
            brand: pm.brand ?? null,
            expiry_month: pm.expiry_month,
            expiry_year: pm.expiry_year,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );

        await this.prisma.withoutScope().subscription_events.create({
          data: {
            store_subscription_id: pm.store_subscription_id,
            type: 'state_transition',
            payload: {
              reason: 'pm_expiry_notice',
              payment_method_id: pm.id,
              expires_on: expiresOn.toISOString(),
              last_four: pm.last4 ?? null,
            } as Prisma.InputJsonValue,
            triggered_by_job: 'payment-method-expiry-notifier',
          },
        });

        enqueued++;
        this.logger.log(
          `PM_EXPIRY_NOTICE_ENQUEUED pm=${pm.id} sub=${pm.store_subscription_id} store=${pm.store_id} expires=${expiresOn.toISOString().slice(0, 10)}`,
        );
      } catch (perPmErr: any) {
        this.logger.error(
          `PM expiry notifier failed for pm ${pm.id}: ${perPmErr?.message ?? perPmErr}`,
          perPmErr?.stack,
        );
      }
    }

    return { enqueued, skipped };
  }

  /**
   * Card expiry is "end of the expiry month". Returns the last
   * millisecond of the UTC month for the provided MM/YYYY pair, or null
   * if the values are not parseable. Two-digit years are treated as 20YY.
   */
  private computeExpiryDate(month: string, year: string): Date | null {
    const m = parseInt(month, 10);
    let y = parseInt(year, 10);
    if (isNaN(m) || isNaN(y) || m < 1 || m > 12) return null;
    if (y < 100) y += 2000;
    // Day 0 of the next month = last day of the requested month (UTC).
    return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  }

  // ---------------------------------------------------------------------------
  // Post-expiry invalidation pass (S2.2)
  // ---------------------------------------------------------------------------

  /**
   * Sweeps payment methods still flagged `state='active'` past their MM/YY
   * expiration and:
   *  - transitions them to `state='invalid'`,
   *  - if the invalidated card was `is_default`, promotes the next remaining
   *    `state='active'` card on the same store (ORDER BY created_at DESC) to
   *    `is_default=true`,
   *  - emits structured log `PAYMENT_METHOD_INVALIDATED`,
   *  - writes an audit row in `subscription_events`
   *    (`payload.reason='payment_method_invalidated'`),
   *  - enqueues `subscription.payment-method-expired.email`.
   *
   * Returns counters useful for tests and observability.
   *
   * Visible for tests.
   */
  async runPostExpiryInvalidation(): Promise<{
    invalidated: number;
    promoted: number;
  }> {
    const now = new Date();

    // Pull every still-active PM whose subscription is in a billing-relevant
    // state. Expiry filtering happens in JS (expiry_month/year are VarChar,
    // so we cannot trivially express the comparison in Prisma).
    const candidates = await this.prisma
      .withoutScope()
      .subscription_payment_methods.findMany({
        where: {
          state: subscription_payment_method_state_enum.active,
          store_subscription: {
            state: { in: ['active', 'trial', 'grace_soft', 'grace_hard'] },
          },
          NOT: [{ expiry_month: null }, { expiry_year: null }],
        },
        select: {
          id: true,
          store_id: true,
          store_subscription_id: true,
          last4: true,
          brand: true,
          expiry_month: true,
          expiry_year: true,
          is_default: true,
        },
        take: 1000,
      });

    if (candidates.length === 0) return { invalidated: 0, promoted: 0 };

    let invalidated = 0;
    let promoted = 0;

    for (const pm of candidates) {
      try {
        if (!pm.expiry_month || !pm.expiry_year) continue;
        const expiresOn = this.computeExpiryDate(
          pm.expiry_month,
          pm.expiry_year,
        );
        if (!expiresOn) continue;

        // Only invalidate if expiry is strictly in the past.
        if (expiresOn.getTime() >= now.getTime()) continue;

        const wasDefault = pm.is_default === true;

        // Use a transaction so the invalidate + promote-default mutations are
        // atomic per PM. If the promote step fails the invalidate rolls back
        // and the next cron run will retry.
        const txResult = await this.prisma
          .withoutScope()
          .$transaction(async (tx) => {
            await tx.subscription_payment_methods.update({
              where: { id: pm.id },
              data: {
                state: subscription_payment_method_state_enum.invalid,
                is_default: false,
                updated_at: now,
              },
            });

            let promotedId: number | null = null;
            if (wasDefault) {
              const next = await tx.subscription_payment_methods.findFirst({
                where: {
                  store_id: pm.store_id,
                  state: subscription_payment_method_state_enum.active,
                  id: { not: pm.id },
                },
                orderBy: { created_at: 'desc' },
                select: { id: true },
              });

              if (next) {
                // Clear any other defaults defensively (should already be 0).
                await tx.subscription_payment_methods.updateMany({
                  where: {
                    store_id: pm.store_id,
                    is_default: true,
                  },
                  data: { is_default: false, updated_at: now },
                });
                await tx.subscription_payment_methods.update({
                  where: { id: next.id },
                  data: { is_default: true, updated_at: now },
                });
                promotedId = next.id;
              }
            }

            await tx.subscription_events.create({
              data: {
                store_subscription_id: pm.store_subscription_id,
                type: 'state_transition',
                payload: {
                  reason: 'payment_method_invalidated',
                  payment_method_id: pm.id,
                  store_id: pm.store_id,
                  was_default: wasDefault,
                  promoted_default_id: promotedId,
                  expiry_date: expiresOn.toISOString(),
                  last_four: pm.last4 ?? null,
                  brand: pm.brand ?? null,
                } as Prisma.InputJsonValue,
                triggered_by_job: 'payment-method-expiry-notifier',
              },
            });

            return { promotedId };
          });

        invalidated++;
        if (txResult.promotedId) promoted++;

        this.logger.log(
          `PAYMENT_METHOD_INVALIDATED payment_method_id=${pm.id} ` +
            `store_id=${pm.store_id} ` +
            `store_subscription_id=${pm.store_subscription_id} ` +
            `expiry_date=${expiresOn.toISOString().slice(0, 10)} ` +
            `was_default=${wasDefault} ` +
            `promoted_default_id=${txResult.promotedId ?? 'none'}`,
        );

        await this.emailQueue.add(
          'subscription.payment-method-expired.email',
          {
            subscriptionId: pm.store_subscription_id,
            storeId: pm.store_id,
            paymentMethodId: pm.id,
            last_four: pm.last4 ?? null,
            brand: pm.brand ?? null,
            expiry_month: pm.expiry_month,
            expiry_year: pm.expiry_year,
            expired_on: expiresOn.toISOString(),
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );
      } catch (perPmErr: any) {
        this.logger.error(
          `PM post-expiry invalidate failed for pm ${pm.id}: ${perPmErr?.message ?? perPmErr}`,
          perPmErr?.stack,
        );
      }
    }

    return { invalidated, promoted };
  }
}
