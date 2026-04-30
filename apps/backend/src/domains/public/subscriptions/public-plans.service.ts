import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

/**
 * Public feature keys exposed to unauthenticated callers.
 * NEVER include cost_*, partner_*, internal_*, max_partner_margin_pct,
 * resellable, promo_rules, or billing internals.
 */
const PUBLIC_AI_FEATURE_KEYS = [
  'text_generation',
  'streaming_chat',
  'conversations',
  'tool_agents',
  'rag_embeddings',
  'async_queue',
] as const;

/**
 * Strips sensitive fields from ai_feature_flags / feature_matrix,
 * returning only the keys safe for public consumption.
 */
function pickPublicFeatures(
  matrix: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!matrix || typeof matrix !== 'object') return {};
  return Object.fromEntries(
    PUBLIC_AI_FEATURE_KEYS.filter((key) => key in matrix).map((key) => [
      key,
      matrix[key],
    ]),
  );
}

export interface PublicPlanDto {
  id: number;
  code: string;
  name: string;
  description: string | null;
  plan_type: string;
  billing_cycle: string;
  base_price: string;
  currency: string;
  trial_days: number;
  is_popular: boolean;
  is_promotional: boolean;
  sort_order: number;
  ai_features: Record<string, unknown>;
}

/**
 * 📦 PublicPlansService
 *
 * Returns only the active, non-archived subscription plans with
 * a whitelist of public-safe fields. Sensitive fields such as
 * cost_multiplier, partner_overrides, resellable, promo_rules, and
 * max_partner_margin_pct are intentionally excluded.
 */
@Injectable()
export class PublicPlansService {
  private readonly logger = new Logger(PublicPlansService.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async findAll(): Promise<PublicPlanDto[]> {
    this.logger.log('Fetching public subscription plans');

    const plans = await this.globalPrisma.subscription_plans.findMany({
      where: {
        state: 'active',
        archived_at: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        plan_type: true,
        billing_cycle: true,
        base_price: true,
        currency: true,
        trial_days: true,
        is_popular: true,
        is_promotional: true,
        sort_order: true,
        ai_feature_flags: true,
        // Deliberately excluded: feature_matrix, max_partner_margin_pct,
        // resellable, promo_rules, setup_fee (internal), created_by, etc.
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      plan_type: plan.plan_type,
      billing_cycle: plan.billing_cycle,
      base_price: plan.base_price.toString(),
      currency: plan.currency,
      trial_days: plan.trial_days,
      is_popular: plan.is_popular,
      is_promotional: plan.is_promotional,
      sort_order: plan.sort_order,
      ai_features: pickPublicFeatures(
        plan.ai_feature_flags as Record<string, unknown> | null,
      ),
    }));
  }
}
