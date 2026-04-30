import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Injectable()
export class SubscriptionRedemptionService {
  private readonly logger = new Logger(SubscriptionRedemptionService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  async redeemCode(
    code: string,
    organizationId: number,
    storeId: number,
  ): Promise<{ planId: number }> {
    const plan = await this.prisma.subscription_plans.findFirst({
      where: {
        redemption_code: code,
        state: 'active',
        archived_at: null,
      },
    });

    if (!plan) {
      throw new VendixHttpException(
        ErrorCodes.PROMO_001,
        'Invalid redemption code',
      );
    }

    if (plan.plan_type !== 'promotional' && !plan.is_promotional) {
      throw new VendixHttpException(
        ErrorCodes.PROMO_NOT_ELIGIBLE,
        'Code is not a promotional plan',
      );
    }

    // Check if already consumed by this org (RNC-19)
    const existing = await this.prisma.redemption_consumptions.findUnique({
      where: {
        organization_id_plan_id: {
          organization_id: organizationId,
          plan_id: plan.id,
        },
      },
    });
    if (existing) {
      throw new VendixHttpException(
        ErrorCodes.PROMO_001,
        'Promotional code already redeemed by this organization',
      );
    }

    // Check global max_redemptions if set
    const promoRules = plan.promo_rules as Record<string, unknown> | null;
    if (
      promoRules?.max_redemptions &&
      typeof promoRules.max_redemptions === 'number'
    ) {
      const count = await this.prisma.redemption_consumptions.count({
        where: { plan_id: plan.id },
      });
      if (count >= promoRules.max_redemptions) {
        throw new VendixHttpException(
          ErrorCodes.PROMO_NOT_ELIGIBLE,
          'Promotional code has reached maximum redemptions',
        );
      }
    }

    await this.prisma.redemption_consumptions.create({
      data: {
        organization_id: organizationId,
        plan_id: plan.id,
        store_id: storeId,
        consumed_at: new Date(),
      },
    });

    this.logger.log(
      `Redemption code ${code} consumed by org ${organizationId} for plan ${plan.code}`,
    );

    return { planId: plan.id };
  }

  async getPlanByRedemptionCode(code: string): Promise<any> {
    const plan = await this.prisma.subscription_plans.findFirst({
      where: {
        redemption_code: code,
        state: 'active',
        archived_at: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        plan_type: true,
        base_price: true,
        trial_days: true,
        billing_cycle: true,
        promo_rules: true,
      },
    });
    if (!plan) return null;
    return {
      ...plan,
      base_price: plan.base_price.toFixed(2),
      promo_rules: plan.promo_rules as Record<string, unknown> | null,
    };
  }
}
