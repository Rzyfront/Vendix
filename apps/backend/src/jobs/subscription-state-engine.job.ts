import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { store_subscription_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';
import { SubscriptionGateConfig } from '../domains/store/subscriptions/config/subscription-gate.config';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dunning rung → BullMQ job name routed by `EmailNotificationsProcessor`.
 *
 * Only the three rungs that HAVE a template are listed. Any other landing
 * state (`cancelled`, `expired`, `active` after a trial auto-convert...) has no
 * dunning email and is deliberately silent here — inventing a job name the
 * processor does not route would only produce `EMAIL_UNKNOWN_JOB` noise.
 */
export const DUNNING_EMAIL_JOBS: Partial<
  Record<store_subscription_state_enum, string>
> = {
  grace_soft: 'dunning.soft.email',
  grace_hard: 'dunning.hard.email',
  suspended: 'subscription.suspended.email',
};

/**
 * Daily cron that evaluates dunning windows for every non-terminal
 * subscription and applies the appropriate state transition.
 *
 * The per-subscription evaluation logic lives in
 * `SubscriptionStateService.evaluateAndTransitionForSubscription` so that
 * the same code path is exercised by:
 *  - this cron (canonical, runs at 03:00 UTC every day)
 *  - event-driven hooks on `subscription.payment.failed` /
 *    `subscription.payment.retry.failed` (immediate, gated by
 *    `SUBSCRIPTION_EVENT_DRIVEN_STATE`).
 *
 * If the event-driven path is disabled or fails, this cron remains the
 * source of truth and will eventually reconcile any subscription that
 * crossed a dunning deadline.
 *
 * Customer notification (step 7)
 * ------------------------------
 * A store must learn it is being degraded BEFORE it discovers it while
 * operating, so every escalation this cron applies also enqueues the matching
 * email on the `email-notifications` queue:
 *
 *   → grace_soft  : `dunning.soft.email`
 *   → grace_hard  : `dunning.hard.email`
 *   → suspended   : `subscription.suspended.email`
 *
 * The escalation is detected by comparing the state BEFORE the evaluation with
 * the state re-read AFTER it. That is deliberate: it keeps the state machine's
 * signature untouched, and it makes the notification a strict consequence of a
 * committed transition — no transition, no email, ever.
 *
 * Ordering invariant: the transition is the truth of the system, the email is
 * only a notification. The enqueue therefore happens AFTER the transition
 * commits and its failures are swallowed (logged): a Redis outage must not
 * freeze dunning, which would leave stores running on unpaid periods.
 *
 * Coverage note: escalations applied by the event-driven listener
 * (`SUBSCRIPTION_EVENT_DRIVEN_STATE=true`) do not pass through here, so they do
 * not notify. With the flag at its default (`false`) the cron IS the canonical
 * path and coverage is complete; wiring the listener is a follow-up.
 */
@Injectable()
export class SubscriptionStateEngineJob {
  private readonly logger = new Logger(SubscriptionStateEngineJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
    private readonly gateConfig: SubscriptionGateConfig,
    @InjectQueue('email-notifications')
    private readonly emailQueue: Queue,
  ) {}

  @Cron('*/2 * * * *')
  async handleStateTransitions(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Subscription state engine already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const subscriptions = await this.prisma.store_subscriptions.findMany({
        where: {
          // RNC-39: also exclude no_plan rows (no period/plan to evaluate).
          state: { notIn: ['cancelled', 'expired', 'draft', 'no_plan'] },
          // FIX membership 500: only pick subscriptions past their period.
          // Without this filter, `take: 50` is meaningless: every run pays
          // for healthy subs that will never transition, and stores
          // beyond the first 50 (e.g. `multimarcas ever`) never reach
          // evaluateAndTransitionForSubscription.
          current_period_end: { lt: new Date() },
        },
        select: { id: true, state: true },
        take: 500,
      });

      if (subscriptions.length === 0) {
        return;
      }

      for (const sub of subscriptions) {
        if (this.gateConfig.isCronDryRun()) {
          this.logger.log({
            msg: 'DRY_RUN_SKIP',
            job: 'subscription-state-engine',
            wouldProcess: { subscriptionId: sub.id, fromState: sub.state },
            // No transition is applied in dry-run, so no dunning email is
            // enqueued either: the email always follows a committed
            // escalation, it never precedes it.
            wouldEnqueueDunningEmail: false,
          });
          continue;
        }

        try {
          await this.stateService.evaluateAndTransitionForSubscription(sub.id);
        } catch (error: any) {
          this.logger.error(
            `Failed to process subscription ${sub.id}: ${error?.message ?? error}`,
          );
        }

        // Deliberately OUTSIDE the catch above: an evaluation that degraded the
        // store and only then failed on a later rule still degraded it, and the
        // customer must still be told. `notifyEscalation` compares the re-read
        // state against `sub.state`, so "nothing changed" simply sends nothing.
        await this.notifyEscalation(sub.id, sub.state);
      }
    } catch (error: any) {
      this.logger.error(
        `Subscription state engine failed: ${error?.message ?? error}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Enqueue the dunning email for a committed escalation, if any.
   *
   * Idempotency has two layers:
   *  1. The escalation itself. A second cron run finds the subscription already
   *     on the rung it evaluated to, `evaluateAndTransitionForSubscription` is
   *     a no-op, the re-read state equals `fromState` and nothing is enqueued.
   *  2. A deterministic BullMQ `jobId`
   *     `dunning:{subscriptionId}:{state}:{period-end day}`, which drops a
   *     duplicate add while the job is still retained (`removeOn*.count`).
   *     This covers two workers racing on the same rung, and keying on the
   *     period end lets a genuinely NEW billing period notify again.
   *
   * Never throws: the caller's transition is already committed and must stay
   * committed even if the queue is unreachable.
   */
  private async notifyEscalation(
    subscriptionId: number,
    fromState: store_subscription_state_enum,
  ): Promise<void> {
    try {
      const after = await this.prisma.store_subscriptions.findUnique({
        where: { id: subscriptionId },
        select: {
          store_id: true,
          state: true,
          lock_reason: true,
          current_period_end: true,
          plan: { select: { id: true, name: true } },
        },
      });

      if (!after || after.state === fromState) {
        return;
      }

      const jobName = DUNNING_EMAIL_JOBS[after.state];
      if (!jobName) {
        return;
      }

      const periodEnd = after.current_period_end;
      const periodEndIso = periodEnd ? periodEnd.toISOString() : null;
      const daysOverdue = periodEnd
        ? Math.max(0, Math.floor((Date.now() - periodEnd.getTime()) / DAY_MS))
        : null;
      const cycleKey = periodEndIso ? periodEndIso.slice(0, 10) : 'no-period';

      await this.emailQueue.add(
        jobName,
        {
          subscriptionId,
          storeId: after.store_id,
          fromState,
          toState: after.state,
          // The truthful motive stamped on the row: lets the template avoid
          // claiming a debt when the plan was simply retired.
          lockReason: after.lock_reason ?? null,
          planId: after.plan?.id ?? null,
          planName: after.plan?.name ?? null,
          periodEndsAt: periodEndIso,
          daysOverdue,
        },
        {
          jobId: `dunning:${subscriptionId}:${after.state}:${cycleKey}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 50 },
        },
      );

      this.logger.log(
        `DUNNING_EMAIL_ENQUEUED sub=${subscriptionId} store=${after.store_id} ` +
          `job=${jobName} from=${fromState} to=${after.state} ` +
          `lock_reason=${after.lock_reason ?? 'none'} period_end=${periodEndIso ?? 'none'}`,
      );
    } catch (err: any) {
      // Swallow on purpose. The escalation already committed; re-throwing
      // would only mark the state engine's run as failed and, on a Redis
      // outage, stall dunning for every remaining subscription.
      this.logger.error(
        `DUNNING_EMAIL_ENQUEUE_FAILED sub=${subscriptionId} from=${fromState}: ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }
}
