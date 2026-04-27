import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';

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
 */
@Injectable()
export class SubscriptionStateEngineJob {
  private readonly logger = new Logger(SubscriptionStateEngineJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly stateService: SubscriptionStateService,
  ) {}

  @Cron('0 3 * * *')
  async handleStateTransitions(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Subscription state engine already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const subscriptions = await this.prisma.store_subscriptions.findMany({
        where: {
          state: { notIn: ['cancelled', 'expired', 'draft'] },
        },
        select: { id: true },
        take: 50,
      });

      if (subscriptions.length === 0) {
        return;
      }

      for (const sub of subscriptions) {
        try {
          await this.stateService.evaluateAndTransitionForSubscription(sub.id);
        } catch (error: any) {
          this.logger.error(
            `Failed to process subscription ${sub.id}: ${error?.message ?? error}`,
          );
        }
      }
    } catch (error: any) {
      this.logger.error(
        `Subscription state engine failed: ${error?.message ?? error}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
