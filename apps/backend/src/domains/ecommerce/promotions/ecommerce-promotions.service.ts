import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';

/**
 * Storefront-facing descriptor for an active auto-apply promotion. Only the
 * fields the public catalog banner / order-scope indicator needs are exposed;
 * no usage counters, customer limits or internal audit fields leak to the
 * public API.
 */
export interface StorefrontActivePromotion {
  id: number;
  name: string;
  rule_type: 'flat' | 'quantity_tiered';
  scope: 'order' | 'product' | 'category';
  type: 'percentage' | 'fixed_amount';
  /** Promotion-level value (percentage or fixed amount). 0 for tiered promos. */
  value: number;
  /** Precomputed badge copy, identical format to product-card badges. */
  badge_label: string;
  /** Minimum cart total required for the promo to apply (null when none). */
  min_purchase_amount: number | null;
}

@Injectable()
export class EcommercePromotionsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly promotionEngine: PromotionEngineService,
  ) {}

  /**
   * List the store's currently-live auto-apply promotions for the public
   * storefront (banner + order-scope indicator).
   *
   * Tenant isolation: `promotions` is a direct `store_scoped_models` entry in
   * `StorePrismaService`, so the read is automatically filtered by the request
   * store resolved from the public domain context (`DomainResolverMiddleware`
   * populates `store_id` for `/ecommerce/*` routes). The query never crosses
   * stores.
   *
   * "Active" criteria (strictest live definition, matching a storefront
   * banner): `state = 'active'` AND the date window is current AND
   * `is_auto_apply = true`. Manual/coupon promotions are excluded because they
   * are not auto-applied.
   */
  async getActivePromotions(): Promise<StorefrontActivePromotion[]> {
    const now = new Date();

    const promotions = await this.prisma.promotions.findMany({
      where: {
        state: 'active',
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
        is_auto_apply: true,
      },
      include: {
        promotion_quantity_tiers: { orderBy: { sort_order: 'asc' } },
      },
      // Priority follows the "1 = highest" convention (lower number wins).
      orderBy: [{ priority: 'asc' }, { id: 'desc' }],
    });

    return promotions.map((promo) => ({
      id: promo.id,
      name: promo.name,
      rule_type: promo.rule_type,
      scope: promo.scope,
      type: promo.type,
      value: Number(promo.value),
      badge_label: this.promotionEngine.buildPromotionBadgeLabel({
        type: promo.type,
        value: promo.value,
        rule_type: promo.rule_type,
        promotion_quantity_tiers: promo.promotion_quantity_tiers,
      }),
      min_purchase_amount:
        promo.min_purchase_amount != null
          ? Number(promo.min_purchase_amount)
          : null,
    }));
  }
}
