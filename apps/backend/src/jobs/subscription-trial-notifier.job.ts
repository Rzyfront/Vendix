import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';

/**
 * Daily cron (09:00 UTC) that proactively notifies stores when their trial is
 * about to end. Buckets trials by remaining days (3d / 1d / today) and
 * enqueues a `trial.ending.email` job with the appropriate bucket label.
 *
 * Throttling: we record an audit row in `subscription_events` with
 * `type='state_transition'` and `payload.reason='trial_reminder'`. The
 * existing `subscription_event_type_enum` does NOT have a dedicated
 * trial_reminder_sent value, so we reuse `state_transition` (no enum
 * migration needed for this sprint). We skip a sub if any reminder row
 * exists in the last 24h.
 *
 * TODO: when subscription_event_type_enum gains a `trial_reminder_sent`
 * value, switch to that and drop the `payload.reason` filter.
 */
@Injectable()
export class SubscriptionTrialNotifierJob {
  private readonly logger = new Logger(SubscriptionTrialNotifierJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  @Cron('0 9 * * *')
  async handleTrialNotifications(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Subscription trial notifier already running, skipping');
      return;
    }
    this.isRunning = true;

    try {
      await this.runOnce();
    } catch (err: any) {
      this.logger.error(
        `Subscription trial notifier batch failed: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /** Visible for tests. */
  async runOnce(): Promise<{ enqueued: number; skipped: number }> {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const subs = await this.prisma.withoutScope().store_subscriptions.findMany({
      where: {
        state: 'trial',
        trial_ends_at: { gte: now, lte: threeDaysFromNow },
      },
      select: { id: true, store_id: true, trial_ends_at: true },
      take: 200,
    });

    if (subs.length === 0) {
      return { enqueued: 0, skipped: 0 };
    }

    let enqueued = 0;
    let skipped = 0;

    for (const sub of subs) {
      try {
        if (!sub.trial_ends_at) continue;

        const bucket = this.classifyBucket(sub.trial_ends_at, now);
        if (!bucket) continue;

        // Throttle: skip if a trial_reminder audit row was written in the
        // last 24h. Mirrors the pattern used in
        // SubscriptionReminderDispatchJob (state_transition + payload.reason).
        const lastReminder = await this.prisma
          .withoutScope()
          .subscription_events.findFirst({
            where: {
              store_subscription_id: sub.id,
              type: 'state_transition',
              payload: {
                path: ['reason'],
                equals: 'trial_reminder',
              },
              created_at: { gte: oneDayAgo },
            },
            select: { id: true },
          });

        if (lastReminder) {
          skipped++;
          continue;
        }

        await this.emailQueue.add(
          'trial.ending.email',
          {
            subscriptionId: sub.id,
            storeId: sub.store_id,
            bucket,
            trialEndsAt: sub.trial_ends_at.toISOString(),
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );

        // Audit row: reuse `state_transition` type (no state change — from
        // and to are the same `trial`), with payload.reason='trial_reminder'.
        await this.prisma.withoutScope().subscription_events.create({
          data: {
            store_subscription_id: sub.id,
            type: 'state_transition',
            from_state: 'trial',
            to_state: 'trial',
            payload: {
              reason: 'trial_reminder',
              bucket,
              trial_ends_at: sub.trial_ends_at.toISOString(),
            } as Prisma.InputJsonValue,
            triggered_by_job: 'subscription-trial-notifier',
          },
        });

        enqueued++;
        this.logger.log(
          `TRIAL_REMINDER_ENQUEUED sub=${sub.id} store=${sub.store_id} bucket=${bucket}`,
        );
      } catch (perSubErr: any) {
        this.logger.error(
          `Trial notifier failed for sub ${sub.id}: ${perSubErr?.message ?? perSubErr}`,
          perSubErr?.stack,
        );
      }
    }

    return { enqueued, skipped };
  }

  /**
   * Pick the deepest applicable bucket label given the trial end date.
   *  - `today`: ends within the current calendar UTC day
   *  - `1d`:   ends within ~24h
   *  - `3d`:   ends within ~3 days
   *
   * Returns null if outside the 3-day window (defensive — query already
   * filters this).
   */
  private classifyBucket(
    trialEndsAt: Date,
    now: Date,
  ): '3d' | '1d' | 'today' | null {
    const endsAt = trialEndsAt.getTime();
    const nowMs = now.getTime();
    const diffMs = endsAt - nowMs;
    if (diffMs < 0) return null;

    const sameUtcDay =
      trialEndsAt.getUTCFullYear() === now.getUTCFullYear() &&
      trialEndsAt.getUTCMonth() === now.getUTCMonth() &&
      trialEndsAt.getUTCDate() === now.getUTCDate();

    if (sameUtcDay) return 'today';

    const oneDayMs = 24 * 60 * 60 * 1000;
    if (diffMs <= oneDayMs) return '1d';

    const threeDaysMs = 3 * oneDayMs;
    if (diffMs <= threeDaysMs) return '3d';

    return null;
  }
}
