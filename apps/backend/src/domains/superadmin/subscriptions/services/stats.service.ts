import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

export interface SubscriptionStatsResult {
  totalPlans: number;
  activePlans: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  graceSubscriptions: number;
  suspendedSubscriptions: number;
  totalPartners: number;
  totalMonthlyRevenue: number;
  currencyCode: string;
}

@Injectable()
export class SubscriptionsStatsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async getGlobalStats(): Promise<SubscriptionStatsResult> {
    const [
      totalPlans,
      activePlans,
      totalSubscriptions,
      activeSubscriptions,
      graceSoft,
      graceHard,
      suspended,
      blocked,
      totalPartners,
      revenueAgg,
    ] = await Promise.all([
      this.prisma.subscription_plans.count(),
      this.prisma.subscription_plans.count({ where: { state: 'active' } }),
      this.prisma.store_subscriptions.count(),
      this.prisma.store_subscriptions.count({
        where: { state: { in: ['active', 'trial'] } },
      }),
      this.prisma.store_subscriptions.count({ where: { state: 'grace_soft' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'grace_hard' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'suspended' } }),
      this.prisma.store_subscriptions.count({ where: { state: 'blocked' } }),
      this.prisma.organizations.count({ where: { is_partner: true } }),
      this.prisma.store_subscriptions.aggregate({
        where: { state: { in: ['active', 'trial', 'grace_soft'] } },
        _sum: { effective_price: true },
      }),
    ]);

    const monthlyRevenue = revenueAgg._sum.effective_price ?? new Prisma.Decimal(0);

    return {
      totalPlans,
      activePlans,
      totalSubscriptions,
      activeSubscriptions,
      graceSubscriptions: graceSoft + graceHard,
      suspendedSubscriptions: suspended + blocked,
      totalPartners,
      totalMonthlyRevenue: Number(monthlyRevenue),
      currencyCode: 'COP',
    };
  }
}
