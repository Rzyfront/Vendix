import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/** BullMQ job name routed by `EmailNotificationsProcessor`. */
export const ARCHIVED_PLAN_EMAIL_JOB =
  'subscription.archived-plan-ending.email';

/**
 * `subscription_events.payload.reason` marker used both to write and to look up
 * the audit/dedup row. Kept as a named export so the spec and any future
 * reporting query cannot drift from the writer.
 */
export const ARCHIVED_PLAN_REMINDER_REASON = 'archived_plan_reminder';

/**
 * Daily cron (09:00 UTC) that warns a store BEFORE its period ends when the
 * plan it sits on was retired from the catalog
 * (`subscription_plans.state='archived'`).
 *
 * Why this job exists
 * -------------------
 * When the period of such a store ends, `SubscriptionRenewalBillingJob` cannot
 * re-bill an unavailable plan and pushes the subscription into `grace_soft`.
 * Some archived plans carry `grace_period_soft_days = 1`, so notifying when the
 * store ENTERS grace arrives too late — by then it is already discovering the
 * block while operating. Product decision: plan grace days are intentional
 * configuration and are NOT altered; the margin is created by warning BEFORE
 * the period expires. This job is that warning.
 *
 * Detection rule
 * --------------
 * A plan is "retired" when `subscription_plans.state === 'archived'`.
 * `archived_at` is deliberately NOT part of the predicate: production has
 * archived plans whose `archived_at` is still NULL (plan id=2), so filtering on
 * the timestamp silently misses exactly the stores this job exists for.
 *
 * Idempotency
 * -----------
 * Mirrors `SubscriptionTrialNotifierJob`: an audit row is written to
 * `subscription_events` with `type='state_transition'` (the
 * `subscription_event_type_enum` has no dedicated reminder value, and adding
 * one would need an enum migration) plus
 * `payload.reason='archived_plan_reminder'`.
 *
 * Unlike the trial notifier, the dedup key is
 * `(subscription, bucket, current_period_end)` instead of a rolling 24h window.
 * A time window would either re-send the same bucket on consecutive days (the
 * `3d` bucket spans two calendar days) or suppress the escalation to `1d` /
 * `today`. Keying on the bucket sends each rung of the ladder exactly once per
 * period, no matter how many times the cron runs — which is strictly stronger
 * than per-day idempotency. Including `current_period_end` scopes the dedup to
 * the current period so a genuinely new period can be warned again.
 *
 * A deterministic BullMQ `jobId` is a second, cheaper layer: two runs racing
 * before the audit row commits still produce a single queued email.
 */
@Injectable()
export class SubscriptionArchivedPlanNotifierJob {
  private readonly logger = new Logger(
    SubscriptionArchivedPlanNotifierJob.name,
  );
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly gateConfig: SubscriptionGateConfig,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  @Cron('0 9 * * *')
  async handleArchivedPlanNotifications(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Subscription archived-plan notifier already running, skipping',
      );
      return;
    }
    this.isRunning = true;

    try {
      await this.runOnce();
    } catch (err: any) {
      this.logger.error(
        `Subscription archived-plan notifier batch failed: ${err?.message ?? err}`,
        err?.stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Visible for tests. `now` is injectable so the bucket ladder can be asserted
   * deterministically without faking global timers.
   */
  async runOnce(
    now: Date = new Date(),
  ): Promise<{ enqueued: number; skipped: number }> {
    const threeDaysFromNow = new Date(now.getTime() + 3 * DAY_MS);

    const subs = await this.prisma.withoutScope().store_subscriptions.findMany({
      where: {
        // `trial` is included on purpose: a trial sitting on a retired plan
        // cannot convert onto that plan either. Trials without a
        // `current_period_end` are excluded for free by the range filter below.
        state: { in: ['active', 'trial'] },
        current_period_end: { gte: now, lte: threeDaysFromNow },
        // Filter by `state`, never by `archived_at` — see class docblock.
        plan: { state: 'archived' },
      },
      select: {
        id: true,
        store_id: true,
        state: true,
        current_period_end: true,
        plan: { select: { id: true, name: true } },
      },
      take: 200,
    });

    if (subs.length === 0) {
      return { enqueued: 0, skipped: 0 };
    }

    let enqueued = 0;
    let skipped = 0;

    for (const sub of subs) {
      try {
        if (!sub.current_period_end) continue;

        const bucket = this.classifyBucket(sub.current_period_end, now);
        if (!bucket) continue;

        const periodEndIso = sub.current_period_end.toISOString();

        if (this.gateConfig.isCronDryRun()) {
          this.logger.log({
            msg: 'DRY_RUN_SKIP',
            job: 'subscription-archived-plan-notifier',
            wouldProcess: {
              subscriptionId: sub.id,
              storeId: sub.store_id,
              planId: sub.plan?.id ?? null,
              bucket,
              currentPeriodEnd: periodEndIso,
            },
          });
          skipped++;
          continue;
        }

        // Dedup: one reminder per (subscription, bucket, period). Three
        // separate JSON path predicates because Prisma allows a single `path`
        // per filter object.
        const alreadySent = await this.prisma
          .withoutScope()
          .subscription_events.findFirst({
            where: {
              store_subscription_id: sub.id,
              type: 'state_transition',
              AND: [
                {
                  payload: {
                    path: ['reason'],
                    equals: ARCHIVED_PLAN_REMINDER_REASON,
                  },
                },
                { payload: { path: ['bucket'], equals: bucket } },
                {
                  payload: {
                    path: ['current_period_end'],
                    equals: periodEndIso,
                  },
                },
              ],
            },
            select: { id: true },
          });

        if (alreadySent) {
          skipped++;
          continue;
        }

        await this.emailQueue.add(
          ARCHIVED_PLAN_EMAIL_JOB,
          {
            subscriptionId: sub.id,
            storeId: sub.store_id,
            bucket,
            planName: sub.plan?.name ?? null,
            periodEndsAt: periodEndIso,
          },
          {
            // Deterministic id — BullMQ drops a duplicate add while the job is
            // still retained, covering the window before the audit row commits.
            jobId: `archived-plan:${sub.id}:${bucket}:${periodEndIso.slice(0, 10)}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { count: 50 },
            removeOnFail: { count: 50 },
          },
        );

        // Audit row: reuse `state_transition` (no state change — from and to
        // are the subscription's current state), same shape as the trial
        // notifier so both reminders are queryable the same way.
        await this.prisma.withoutScope().subscription_events.create({
          data: {
            store_subscription_id: sub.id,
            type: 'state_transition',
            from_state: sub.state,
            to_state: sub.state,
            payload: {
              reason: ARCHIVED_PLAN_REMINDER_REASON,
              bucket,
              plan_id: sub.plan?.id ?? null,
              plan_name: sub.plan?.name ?? null,
              current_period_end: periodEndIso,
            } as Prisma.InputJsonValue,
            triggered_by_job: 'subscription-archived-plan-notifier',
          },
        });

        enqueued++;
        this.logger.log(
          `ARCHIVED_PLAN_REMINDER_ENQUEUED sub=${sub.id} store=${sub.store_id} plan=${sub.plan?.id ?? 'none'} bucket=${bucket} period_end=${periodEndIso}`,
        );
      } catch (perSubErr: any) {
        this.logger.error(
          `Archived-plan notifier failed for sub ${sub.id}: ${perSubErr?.message ?? perSubErr}`,
          perSubErr?.stack,
        );
      }
    }

    this.logger.log(
      `ARCHIVED_PLAN_NOTIFIER_BATCH candidates=${subs.length} enqueued=${enqueued} skipped=${skipped}`,
    );

    return { enqueued, skipped };
  }

  /**
   * Pick the deepest applicable bucket for a period end. Identical ladder to
   * `SubscriptionTrialNotifierJob.classifyBucket` (kept duplicated rather than
   * extracted: the trial notifier is out of scope for this change).
   *
   *  - `today`: ends within the current calendar UTC day
   *  - `1d`:    ends within ~24h
   *  - `3d`:    ends within ~3 days
   *
   * Returns null outside the 3-day window (defensive — the query already
   * filters it).
   */
  private classifyBucket(
    periodEnd: Date,
    now: Date,
  ): '3d' | '1d' | 'today' | null {
    const diffMs = periodEnd.getTime() - now.getTime();
    if (diffMs < 0) return null;

    const sameUtcDay =
      periodEnd.getUTCFullYear() === now.getUTCFullYear() &&
      periodEnd.getUTCMonth() === now.getUTCMonth() &&
      periodEnd.getUTCDate() === now.getUTCDate();

    if (sameUtcDay) return 'today';
    if (diffMs <= DAY_MS) return '1d';
    if (diffMs <= 3 * DAY_MS) return '3d';

    return null;
  }
}
