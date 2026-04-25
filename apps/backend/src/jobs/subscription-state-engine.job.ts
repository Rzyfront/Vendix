import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { SubscriptionStateService } from '../domains/store/subscriptions/services/subscription-state.service';
import { store_subscription_state_enum } from '@prisma/client';

type State = store_subscription_state_enum;

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
        include: {
          plan: {
            select: {
              grace_period_soft_days: true,
              grace_period_hard_days: true,
              suspension_day: true,
              cancellation_day: true,
            },
          },
          promotional_plan: {
            select: {
              id: true,
              promo_rules: true,
            },
          },
        },
        take: 50,
      });

      if (subscriptions.length === 0) {
        return;
      }

      for (const sub of subscriptions) {
        try {
          await this.processSubscription(sub);
        } catch (error) {
          this.logger.error(
            `Failed to process subscription ${sub.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Subscription state engine failed: ${error.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processSubscription(sub: any): Promise<void> {
    const now = new Date();
    const currentState = sub.state as State;
    const plan = sub.plan;

    if (
      sub.promotional_plan_id &&
      sub.promotional_plan &&
      sub.promotional_plan.promo_rules
    ) {
      const rules =
        typeof sub.promotional_plan.promo_rules === 'string'
          ? JSON.parse(sub.promotional_plan.promo_rules)
          : sub.promotional_plan.promo_rules;
      if (rules.ends_at && new Date(rules.ends_at) < now) {
        await this.prisma.store_subscriptions.update({
          where: { id: sub.id },
          data: {
            promotional_plan_id: null,
            promotional_applied_at: null,
            updated_at: now,
          },
        });
      }
    }

    if (
      sub.trial_ends_at &&
      new Date(sub.trial_ends_at) < now &&
      currentState === 'trial'
    ) {
      const hasPayment = await this.prisma.subscription_payments.findFirst({
        where: {
          invoice: { store_subscription_id: sub.id },
          state: 'succeeded',
        },
      });

      const targetState: State = hasPayment ? 'grace_soft' : 'blocked';
      await this.stateService.transition(sub.store_id, targetState, {
        reason: 'Trial period ended',
        triggeredByJob: 'subscription-state-engine',
        payload: { trial_ends_at: sub.trial_ends_at },
      });
      return;
    }

    if (sub.current_period_end && new Date(sub.current_period_end) < now) {
      const periodEnd = new Date(sub.current_period_end);
      const softDays = plan.grace_period_soft_days;
      const hardDays = plan.grace_period_hard_days;
      const suspensionDay = plan.suspension_day;
      const cancellationDay = plan.cancellation_day;

      const softDeadline = new Date(
        periodEnd.getTime() + softDays * 24 * 60 * 60 * 1000,
      );
      const hardDeadline = new Date(
        periodEnd.getTime() + hardDays * 24 * 60 * 60 * 1000,
      );
      const suspendDeadline = new Date(
        periodEnd.getTime() + suspensionDay * 24 * 60 * 60 * 1000,
      );
      const cancelDeadline = new Date(
        periodEnd.getTime() + cancellationDay * 24 * 60 * 60 * 1000,
      );

      let targetState: State | null = null;
      let reason = '';

      if (now >= cancelDeadline) {
        targetState = 'cancelled';
        reason = 'Past cancellation day';
      } else if (now >= suspendDeadline) {
        targetState = 'suspended';
        reason = 'Past suspension day';
      } else if (now >= hardDeadline) {
        targetState = 'grace_hard';
        reason = 'Past hard grace period';
      } else if (now >= softDeadline) {
        targetState = 'grace_soft';
        reason = 'Past soft grace period';
      }

      if (targetState && targetState !== currentState) {
        await this.stateService.transition(sub.store_id, targetState, {
          reason,
          triggeredByJob: 'subscription-state-engine',
          payload: {
            current_period_end: sub.current_period_end,
            soft_deadline: softDeadline.toISOString(),
            hard_deadline: hardDeadline.toISOString(),
            suspend_deadline: suspendDeadline.toISOString(),
            cancel_deadline: cancelDeadline.toISOString(),
          },
        });
      }
    }
  }
}
