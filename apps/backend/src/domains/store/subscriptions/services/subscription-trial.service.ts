import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

@Injectable()
export class SubscriptionTrialService {
  private readonly logger = new Logger(SubscriptionTrialService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  async createTrialForStore(storeId: number): Promise<void> {
    try {
      const plan = await this.prisma.subscription_plans.findUnique({
        where: { code: 'trial-full' },
      });

      if (!plan) {
        this.logger.error(
          `Trial plan with code 'trial-full' not found. Skipping trial creation for store ${storeId}.`,
        );
        return;
      }

      const platformSettings = await this.prisma.platform_settings.findFirst();
      const trialDays = platformSettings?.default_trial_days ?? 14;
      const trialEndsAt = new Date(
        Date.now() + trialDays * 24 * 60 * 60 * 1000,
      );

      const subscription = await this.prisma.store_subscriptions.create({
        data: {
          store_id: storeId,
          plan_id: plan.id,
          state: 'trial',
          trial_ends_at: trialEndsAt,
          resolved_features: plan.ai_feature_flags ?? Prisma.JsonNull,
          effective_price: new Prisma.Decimal(0),
          vendix_base_price: new Prisma.Decimal(0),
          currency: plan.currency,
        },
      });

      await this.prisma.subscription_events.create({
        data: {
          store_subscription_id: subscription.id,
          type: 'trial_started',
          to_state: 'trial',
          payload: {
            trial_days: trialDays,
            trial_ends_at: trialEndsAt.toISOString(),
          },
        },
      });

      this.logger.log(
        `Trial subscription created for store ${storeId} (ends at ${trialEndsAt.toISOString()})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create trial subscription for store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Don't throw — don't break store creation
    }
  }
}
