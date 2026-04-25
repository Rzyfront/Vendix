import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GlobalPrismaService } from '../prisma/services/global-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PromotionalActivationJob {
  private readonly logger = new Logger(PromotionalActivationJob.name);
  private isRunning = false;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron('0 */6 * * *')
  async handlePromotionalActivation(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Promotional activation already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      await this.processExpiredPromos();
      await this.processActivePromos();
    } catch (error) {
      this.logger.error(
        `Promotional activation failed: ${error.message}`,
      );
    } finally {
      this.isRunning = false;
    }
  }

  private async processExpiredPromos(): Promise<void> {
    const now = new Date();

    const promoPlans = await this.prisma.subscription_plans.findMany({
      where: {
        is_promotional: true,
        state: 'active',
      },
      select: { id: true, promo_rules: true },
    });

    for (const plan of promoPlans) {
      try {
        const rules =
          typeof plan.promo_rules === 'string'
            ? JSON.parse(plan.promo_rules)
            : plan.promo_rules;

        if (!rules || !rules.ends_at) continue;
        if (new Date(rules.ends_at) >= now) continue;

        const affectedSubs = await this.prisma.store_subscriptions.findMany({
          where: { promotional_plan_id: plan.id },
          select: { id: true, store_id: true },
        });

        for (const sub of affectedSubs) {
          await this.prisma.store_subscriptions.update({
            where: { id: sub.id },
            data: {
              promotional_plan_id: null,
              promotional_applied_at: null,
              updated_at: now,
            },
          });

          this.eventEmitter.emit('subscription.promotional.removed', {
            subscriptionId: sub.id,
            storeId: sub.store_id,
            promoPlanId: plan.id,
          });
        }

        if (affectedSubs.length > 0) {
          this.logger.log(
            `Removed expired promo plan ${plan.id} from ${affectedSubs.length} subscriptions`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Failed to process expired promo plan ${plan.id}: ${error.message}`,
        );
      }
    }
  }

  private async processActivePromos(): Promise<void> {
    const now = new Date();

    const promoPlans = await this.prisma.subscription_plans.findMany({
      where: {
        is_promotional: true,
        state: 'active',
      },
      select: { id: true, promo_rules: true, code: true },
    });

    for (const plan of promoPlans) {
      try {
        const rules =
          typeof plan.promo_rules === 'string'
            ? JSON.parse(plan.promo_rules)
            : plan.promo_rules;

        if (!rules) continue;
        if (rules.ends_at && new Date(rules.ends_at) < now) continue;

        const eligibleStoreIds = await this.resolveEligibleStores(plan.id, rules);

        if (eligibleStoreIds.length === 0) continue;

        const storeBatches = this.chunk(eligibleStoreIds, 50);

        for (const batch of storeBatches) {
          for (const storeId of batch) {
            try {
              const existing = await this.prisma.store_subscriptions.findFirst({
                where: {
                  store_id: storeId,
                  promotional_plan_id: plan.id,
                },
              });

              if (existing) continue;

              const sub = await this.prisma.store_subscriptions.findFirst({
                where: { store_id: storeId },
              });

              if (!sub) continue;

              await this.prisma.store_subscriptions.update({
                where: { id: sub.id },
                data: {
                  promotional_plan_id: plan.id,
                  promotional_applied_at: now,
                  updated_at: now,
                },
              });

              await this.prisma.subscription_events.create({
                data: {
                  store_subscription_id: sub.id,
                  type: 'promotional_applied',
                  payload: {
                    promo_plan_id: plan.id,
                    promo_plan_code: plan.code,
                  } as any,
                  triggered_by_job: 'promotional-activation',
                },
              });

              this.eventEmitter.emit('subscription.promotional.applied', {
                subscriptionId: sub.id,
                storeId,
                promoPlanId: plan.id,
              });
            } catch (error) {
              this.logger.error(
                `Failed to apply promo ${plan.id} to store ${storeId}: ${error.message}`,
              );
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to process promo plan ${plan.id}: ${error.message}`,
        );
      }
    }
  }

  private async resolveEligibleStores(
    planId: number,
    rules: any,
  ): Promise<number[]> {
    if (rules.store_ids && Array.isArray(rules.store_ids)) {
      return rules.store_ids;
    }

    if (rules.eligible_plan_codes && Array.isArray(rules.eligible_plan_codes)) {
      const subs = await this.prisma.store_subscriptions.findMany({
        where: {
          plan: { code: { in: rules.eligible_plan_codes } },
          state: { in: ['active', 'trial'] },
        },
        select: { store_id: true },
        take: 500,
      });
      return subs.map((s) => s.store_id);
    }

    return [];
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}
