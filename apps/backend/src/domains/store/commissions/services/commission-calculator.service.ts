import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class CommissionCalculatorService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Calculate commission for a payment based on active rules.
   * Rules are evaluated in priority order. First matching rule wins.
   */
  async calculateForPayment(params: {
    payment_id: number;
    amount: number;
    payment_method: string;
    store_id: number;
  }): Promise<{
    rule_id: number;
    commission_amount: number;
    detail: any;
  } | null> {
    const now = new Date();

    // 1. Get active rules ordered by priority
    const rules = await this.prisma.commission_rules.findMany({
      where: {
        is_active: true,
        OR: [
          { valid_from: null, valid_to: null },
          { valid_from: { lte: now }, valid_to: null },
          { valid_from: null, valid_to: { gte: now } },
          { valid_from: { lte: now }, valid_to: { gte: now } },
        ],
      },
      orderBy: { priority: 'desc' },
    });

    // 2. Evaluate each rule
    for (const rule of rules) {
      if (this.matchesConditions(rule, params)) {
        const commission_amount = this.calculate(rule, params.amount);

        // 3. Save calculation
        await this.prisma.commission_calculations.create({
          data: {
            store_id: params.store_id,
            commission_rule_id: rule.id,
            source_type: 'payment',
            source_id: params.payment_id,
            base_amount: params.amount,
            commission_amount,
            calculation_detail: {
              rule_name: rule.name,
              rule_type: rule.rule_type,
              commission_type: rule.commission_type,
              value: rule.value ? Number(rule.value) : null,
              payment_method: params.payment_method,
            },
          },
        });

        return {
          rule_id: rule.id,
          commission_amount,
          detail: {
            rule_name: rule.name,
            commission_type: rule.commission_type,
          },
        };
      }
    }

    return null;
  }

  private matchesConditions(
    rule: any,
    params: { payment_method: string; amount: number },
  ): boolean {
    const conditions = rule.conditions as Record<string, any>;
    if (!conditions) return false;

    switch (rule.rule_type) {
      case 'payment_method':
        return (
          conditions.payment_method === params.payment_method ||
          conditions.payment_methods?.includes(params.payment_method)
        );
      case 'volume':
        return (
          params.amount >= (conditions.min_amount || 0) &&
          params.amount <= (conditions.max_amount || Infinity)
        );
      case 'category':
        return true; // Category matching would need product info — simplified for now
      case 'custom':
        return true; // Custom rules always match if active
      default:
        return false;
    }
  }

  private calculate(rule: any, amount: number): number {
    switch (rule.commission_type) {
      case 'fixed':
        return Number(rule.value) || 0;
      case 'percentage':
        return amount * (Number(rule.value) || 0);
      case 'tiered': {
        const tiers = rule.tiers as Array<{
          min: number;
          max: number;
          rate: number;
        }>;
        if (!tiers?.length) return 0;
        for (const tier of tiers) {
          if (amount >= tier.min && amount <= (tier.max || Infinity)) {
            return amount * tier.rate;
          }
        }
        return 0;
      }
      default:
        return 0;
    }
  }
}
