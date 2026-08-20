import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PromotionEngineService } from '../../store/promotions/promotion-engine/promotion-engine.service';
import { QuantityTierSummary } from '../../store/promotions/dto/promotion-quote.interface';

/**
 * The ONLY promotion scopes the public storefront contract recognises. Mirrors
 * `promotion_scope_enum` in the Prisma schema; declared here as a `const`
 * tuple so the runtime guard (`isStorefrontPromotionScope`) and the compile
 * time union can never drift apart.
 */
export const STOREFRONT_PROMOTION_SCOPES = [
  'order',
  'product',
  'category',
] as const;

export type StorefrontPromotionScope =
  (typeof STOREFRONT_PROMOTION_SCOPES)[number];

/**
 * Runtime narrowing for `promotions.scope`. The DB column is a Postgres enum,
 * so an out-of-contract value should be impossible — but a legacy row (or a
 * future enum value added ahead of the storefront) must NOT be silently
 * coerced into a wrong scope, and must NOT 500 a public storefront endpoint
 * either. Rows failing this guard are dropped from the response.
 */
function isStorefrontPromotionScope(
  value: unknown,
): value is StorefrontPromotionScope {
  return (STOREFRONT_PROMOTION_SCOPES as readonly string[]).includes(
    value as string,
  );
}

/**
 * Human copy appended to `promotion_type_label`, telling the shopper WHERE the
 * benefit lands. Keyed by scope so adding a scope is a compile error until the
 * copy exists.
 */
const PROMOTION_SCOPE_SUFFIX: Record<StorefrontPromotionScope, string> = {
  order: 'en toda tu compra',
  product: 'en este producto',
  category: 'en productos de esta categoría',
};

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
  /**
   * Strict union (never a bare `string`): rows whose scope falls outside the
   * contract are filtered out upstream, so every emitted row is renderable.
   */
  scope: StorefrontPromotionScope;
  type: 'percentage' | 'fixed_amount';
  /** Promotion-level value (percentage or fixed amount). 0 for tiered promos. */
  value: number;
  /** Precomputed badge copy, identical format to product-card badges. */
  badge_label: string;
  /** Minimum cart total required for the promo to apply (null when none). */
  min_purchase_amount: number | null;
  /**
   * Full tier ladder for `quantity_tiered` promos, ordered by `min_quantity`
   * ASC (then `sort_order` ASC, then tier `id` ASC — the same ordering the
   * engine uses internally). ALWAYS present: an empty array `[]` (never
   * `undefined`) for `flat` promos, so consumers can iterate unconditionally
   * and use emptiness as the "no ladder" discriminator.
   */
  quantity_tiers: QuantityTierSummary[];
  /**
   * Server-formatted, ready-to-render Spanish sentence describing the benefit
   * AND its scope ("20% OFF en toda tu compra", "Desde 3 und: -10% en este
   * producto"). Formatted here — never on the client — so every storefront
   * surface shows identical copy. Guaranteed non-empty.
   */
  promotion_type_label: string;
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
        // Ordered exactly like the engine sorts tiers internally, so the
        // emitted ladder never needs re-sorting downstream.
        promotion_quantity_tiers: {
          orderBy: [
            { min_quantity: 'asc' },
            { sort_order: 'asc' },
            { id: 'asc' },
          ],
        },
      },
      // Priority follows the "1 = highest" convention (lower number wins).
      orderBy: [{ priority: 'asc' }, { id: 'desc' }],
    });

    const active: StorefrontActivePromotion[] = [];

    for (const promo of promotions) {
      // Legacy / out-of-contract scope: drop the row instead of emitting an
      // unrenderable value or failing the whole public request.
      if (!isStorefrontPromotionScope(promo.scope)) continue;
      const scope: StorefrontPromotionScope = promo.scope;

      const isTiered = promo.rule_type === 'quantity_tiered';
      const value = Number(promo.value);

      // Tier ladder: only meaningful for `quantity_tiered`; flat promos emit
      // `[]` so the field shape stays symmetric across both rule types.
      const quantityTiers: QuantityTierSummary[] = isTiered
        ? (promo.promotion_quantity_tiers ?? []).map((tier) => ({
            min_quantity: Number(tier.min_quantity),
            max_quantity:
              tier.max_quantity === null ? null : Number(tier.max_quantity),
            type: tier.type,
            value: Number(tier.value),
            sort_order: Number(tier.sort_order),
          }))
        : [];

      // Single source of truth for promotional copy: the engine builds the
      // badge (tiered → "Desde N und: -X%" / "-$Y"; flat → "-X% OFF").
      const badgeLabel = this.promotionEngine.buildPromotionBadgeLabel({
        type: promo.type,
        value: promo.value,
        rule_type: promo.rule_type,
        promotion_quantity_tiers: promo.promotion_quantity_tiers,
      });

      active.push({
        id: promo.id,
        name: promo.name,
        rule_type: promo.rule_type,
        scope,
        type: promo.type,
        value,
        badge_label: badgeLabel,
        min_purchase_amount:
          promo.min_purchase_amount != null
            ? Number(promo.min_purchase_amount)
            : null,
        quantity_tiers: quantityTiers,
        promotion_type_label: this.buildPromotionTypeLabel({
          scope,
          rule_type: promo.rule_type,
          type: promo.type,
          value,
          badge_label: badgeLabel,
        }),
      });
    }

    return active;
  }

  /**
   * Compose the shopper-facing "<benefit> <scope>" sentence.
   *
   * The BENEFIT half never re-implements tier formatting: for
   * `quantity_tiered` promos it reuses the engine-built badge verbatim
   * ("Desde 3 und: -10%"), which keeps the banner copy byte-identical to the
   * product-card badge. Flat promos get the positive phrasing the banner
   * wants ("20% OFF", "$5.000 OFF") instead of the badge's `-` prefix. Any
   * promo carrying an unusable value falls back to the badge, which is itself
   * guaranteed non-empty ("OFERTA" / "Descuentos por cantidad").
   */
  private buildPromotionTypeLabel(promo: {
    scope: StorefrontPromotionScope;
    rule_type: 'flat' | 'quantity_tiered';
    type: 'percentage' | 'fixed_amount';
    value: number;
    badge_label: string;
  }): string {
    const suffix = PROMOTION_SCOPE_SUFFIX[promo.scope];
    const benefit = this.buildPromotionBenefitPhrase(promo);
    return `${benefit} ${suffix}`;
  }

  /** Benefit half of `promotion_type_label`. Always non-empty. */
  private buildPromotionBenefitPhrase(promo: {
    rule_type: 'flat' | 'quantity_tiered';
    type: 'percentage' | 'fixed_amount';
    value: number;
    badge_label: string;
  }): string {
    if (promo.rule_type === 'quantity_tiered') {
      // Engine-formatted ladder entry point; already includes the tier value.
      return promo.badge_label;
    }

    const hasUsableValue = Number.isFinite(promo.value) && promo.value > 0;
    if (!hasUsableValue) return promo.badge_label;

    if (promo.type === 'percentage') {
      // Rounded like the engine's flat badge so both strings agree within the
      // same payload (badge "-13% OFF" ↔ label "13% OFF ...").
      return `${Math.round(promo.value)}% OFF`;
    }

    return `$${this.formatCurrencyInteger(promo.value)} OFF`;
  }

  /**
   * Format a whole-currency amount with es-CO thousands separators (e.g.
   * `5000` → `5.000`). Mirrors the promotion engine's private formatter so
   * banner copy and product-card badges render money identically.
   */
  private formatCurrencyInteger(value: number): string {
    const amount = Math.round(Number(value) || 0);
    return amount.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }
}
