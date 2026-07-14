import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import {
  ActiveProductPromotion,
  ActivePromotionProductInput,
  OrderPromotionSnapshot,
  PromotionQuoteApplied,
  PromotionQuoteInput,
  PromotionQuoteItemBreakdown,
  PromotionQuoteItemInput,
  PromotionQuoteResult,
  PromotionQuoteScope,
  PromotionQuoteType,
  PromotionTierProgress,
} from '../dto/promotion-quote.interface';

/** Promotions resolve rule types from the Prisma enum. */
type PromotionRuleType = 'flat' | 'quantity_tiered';

/** Tier row resolved from DB; `type` and `value` mirror a flattened promotion. */
interface PromotionQuantityTierRecord {
  id: number;
  promotion_id: number;
  min_quantity: number;
  max_quantity: number | null;
  type: PromotionQuoteType;
  value: unknown;
  sort_order: number;
}

/** Internal helper: represents a promotion row resolved from DB with relations. */
interface PromotionRecord {
  id: number;
  name: string;
  code: string | null;
  type: PromotionQuoteType;
  value: unknown;
  rule_type: PromotionRuleType;
  scope: PromotionQuoteScope;
  min_purchase_amount: unknown;
  max_discount_amount: unknown;
  usage_limit: number | null;
  usage_count: number;
  per_customer_limit: number | null;
  is_auto_apply: boolean;
  priority: number;
  start_date: Date;
  end_date: Date | null;
  state: string;
  promotion_products?: Array<{ product_id: number }>;
  promotion_categories?: Array<{ category_id: number }>;
  promotion_quantity_tiers?: PromotionQuantityTierRecord[];
}

@Injectable()
export class PromotionEngineService {
  constructor(private prisma: StorePrismaService) {}

  /**
   * Get eligible promotions for the current cart
   */
  async getEligiblePromotions(cartItems: any[], customerId?: number) {
    const now = new Date();

    // Fetch active promotions (query-time filtering)
    const promotions = await this.prisma.promotions.findMany({
      where: {
        state: { in: ['active', 'scheduled'] },
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
      },
      include: {
        promotion_products: true,
        promotion_categories: true,
        promotion_quantity_tiers: true,
      },
      orderBy: { priority: 'desc' },
    });

    const eligible: any[] = [];
    for (const promo of promotions) {
      // Check usage limit
      if (promo.usage_limit && promo.usage_count >= promo.usage_limit) continue;

      // Check per-customer limit
      if (promo.per_customer_limit && customerId) {
        const customerUsage = await this.prisma.order_promotions.count({
          where: {
            promotion_id: promo.id,
            customer_id: customerId,
          },
        });
        if (customerUsage >= promo.per_customer_limit) continue;
      }

      const applicableTotal = this.calculateApplicableTotal(promo, cartItems);
      if (applicableTotal <= 0) continue;

      // Check minimum purchase
      const cartTotal = cartItems.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0,
      );
      if (
        promo.min_purchase_amount &&
        cartTotal < Number(promo.min_purchase_amount)
      )
        continue;

      // Calculate discount
      const discount = this.calculateDiscount(promo, cartItems);

      eligible.push({
        ...promo,
        calculated_discount: discount,
      });
    }

    return eligible;
  }

  /**
   * Calculate discount amount for a promotion
   */
  calculateDiscount(promotion: any, cartItems: any[]): number {
    const applicableTotal = this.calculateApplicableTotal(promotion, cartItems);

    let discount = 0;
    if (promotion.type === 'percentage') {
      discount = applicableTotal * (Number(promotion.value) / 100);
    } else {
      discount = Math.min(Number(promotion.value), applicableTotal);
    }

    // Apply max_discount_amount cap
    const maxDiscountAmount = Number(promotion.max_discount_amount);
    if (Number.isFinite(maxDiscountAmount) && maxDiscountAmount > 0) {
      discount = Math.min(discount, maxDiscountAmount);
    }

    return Math.round(discount * 100) / 100;
  }

  private calculateApplicableTotal(promotion: any, cartItems: any[]): number {
    if (promotion.scope === 'product') {
      const promoProductIds =
        promotion.promotion_products?.map((pp: any) => Number(pp.product_id)) ||
        [];

      return cartItems
        .filter((item) => promoProductIds.includes(Number(item.product_id)))
        .reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
    }

    if (promotion.scope === 'category') {
      const promoCategoryIds =
        promotion.promotion_categories?.map((pc: any) => Number(pc.category_id)) ||
        [];

      return cartItems
        .filter((item) =>
          this.getItemCategoryIds(item).some((categoryId) =>
            promoCategoryIds.includes(categoryId),
          ),
        )
        .reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
    }

    return cartItems.reduce(
      (sum, item) => sum + Number(item.unit_price) * Number(item.quantity),
      0,
    );
  }

  private getItemCategoryIds(item: any): number[] {
    const categoryIds = Array.isArray(item.category_ids)
      ? item.category_ids
      : item.category_id
        ? [item.category_id]
        : [];

    return categoryIds
      .map((categoryId: string | number) => Number(categoryId))
      .filter((categoryId: number) => Number.isFinite(categoryId));
  }

  /**
   * Apply promotion to an order (create order_promotion record + increment usage)
   */
  async applyPromotion(
    orderId: number,
    promotionId: number,
    discountAmount: number,
    customerId: number | null,
    tx?: any,
  ) {
    const client = tx || this.prisma;

    await client.order_promotions.create({
      data: {
        order_id: orderId,
        promotion_id: promotionId,
        discount_amount: discountAmount,
        customer_id: customerId,
      },
    });

    await client.promotions.update({
      where: { id: promotionId },
      data: { usage_count: { increment: 1 } },
    });
  }

  /**
   * Validate a specific promotion (e.g. coupon code) against cart
   */
  async validatePromotion(
    promotionId: number,
    cartItems: any[],
    customerId?: number,
  ) {
    const now = new Date();
    const promotion = await this.prisma.promotions.findFirst({
      where: {
        id: promotionId,
        state: { in: ['active', 'scheduled'] },
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
      },
      include: {
        promotion_products: true,
        promotion_categories: true,
        promotion_quantity_tiers: true,
      },
    });

    if (!promotion) {
      throw new BadRequestException('Promocion no valida o expirada');
    }

    if (
      promotion.usage_limit &&
      promotion.usage_count >= promotion.usage_limit
    ) {
      throw new BadRequestException('Promocion ha alcanzado su limite de uso');
    }

    if (promotion.per_customer_limit && customerId) {
      const customerUsage = await this.prisma.order_promotions.count({
        where: {
          promotion_id: promotion.id,
          customer_id: customerId,
        },
      });
      if (customerUsage >= promotion.per_customer_limit) {
        throw new BadRequestException(
          'Has alcanzado el limite de uso para esta promocion',
        );
      }
    }

    const cartTotal = cartItems.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );
    if (
      promotion.min_purchase_amount &&
      cartTotal < Number(promotion.min_purchase_amount)
    ) {
      throw new BadRequestException(
        `Compra minima de ${promotion.min_purchase_amount} requerida`,
      );
    }

    const applicableTotal = this.calculateApplicableTotal(promotion, cartItems);
    if (applicableTotal <= 0) {
      throw new BadRequestException('Promocion no aplica a los items del carrito');
    }

    const discount = this.calculateDiscount(promotion, cartItems);
    return { promotion, discount };
  }

  /**
   * Build a structured promotional quote shared by POS, catalog, checkout and
   * orders. Backend is the single source of truth for discount math; consumers
   * pass cart items + optional manual promotion ids and receive:
   *  - applied promotions (auto + manual that survived eligibility)
   *  - per-item breakdown with original/final unit price
   *  - totals (subtotal, total_discount, promotional_subtotal)
   *  - order_promotions_snapshot ready to persist
   *
   * Rules:
   *  - Auto promotions (`is_auto_apply = true`) apply automatically.
   *  - Manual promotions only apply when their id is in `manual_promotion_ids`.
   *  - Coupons are handled separately and do NOT enter this quote.
   *  - Discounts are computed on the products subtotal BEFORE shipping.
   *  - Date range, scope, min purchase, usage and per-customer limits are
   *    honoured (same predicates the legacy methods already enforce).
   *  - Stacking follows promotion `priority` (desc) like `getEligiblePromotions`.
   */
  async quoteDiscounts(input: PromotionQuoteInput): Promise<PromotionQuoteResult> {
    const now = input.now ?? new Date();
    const items = input.items ?? [];
    const customerId = input.customer_id ?? null;
    const manualIds = Array.from(new Set(input.manual_promotion_ids ?? []));

    const subtotal = this.roundMoney(
      items.reduce(
        (sum, item) => sum + Number(item.unit_price) * Number(item.quantity),
        0,
      ),
    );

    // Initialize item breakdown — even if no promotions apply we return a
    // populated breakdown so consumers can rely on the shape unconditionally.
    const itemBreakdownMap = new Map<number, PromotionQuoteItemBreakdown>();
    items.forEach((item, index) => {
      const originalUnitPrice = Number(item.unit_price);
      const quantity = Number(item.quantity);
      itemBreakdownMap.set(index, {
        line_id: item.line_id,
        product_id: Number(item.product_id),
        variant_id: item.variant_id ?? null,
        quantity,
        original_unit_price: this.roundMoney(originalUnitPrice),
        promotion_discount: 0,
        final_unit_price: this.roundMoney(originalUnitPrice),
        final_line_total: this.roundMoney(originalUnitPrice * quantity),
        promotion_ids: [],
      });
    });

    if (items.length === 0) {
      return {
        subtotal: 0,
        total_discount: 0,
        promotional_subtotal: 0,
        applied_promotions: [],
        items: [],
        order_promotions_snapshot: [],
        tier_progress: [],
      };
    }

    // Fetch candidate promotions: auto-apply OR explicitly requested.
    const candidates = (await this.prisma.promotions.findMany({
      where: {
        state: { in: ['active', 'scheduled'] },
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
        ...(manualIds.length
          ? { AND: [{ OR: [{ is_auto_apply: true }, { id: { in: manualIds } }] }] }
          : { is_auto_apply: true }),
      },
      include: {
        promotion_products: true,
        promotion_categories: true,
        promotion_quantity_tiers: true,
      },
      orderBy: { priority: 'desc' },
    })) as unknown as PromotionRecord[];

    const appliedPromotions: PromotionQuoteApplied[] = [];

    for (const promo of candidates) {
      const isManual = !promo.is_auto_apply;

      // Manual promotions only apply if caller passed their id.
      if (isManual && !manualIds.includes(promo.id)) continue;

      // Usage limit (global).
      if (promo.usage_limit && promo.usage_count >= promo.usage_limit) continue;

      // Per-customer usage limit.
      if (promo.per_customer_limit && customerId) {
        const customerUsage = await this.prisma.order_promotions.count({
          where: {
            promotion_id: promo.id,
            customer_id: customerId,
          },
        });
        if (customerUsage >= promo.per_customer_limit) continue;
      }

      const applicableIndexes = this.resolveApplicableItemIndexes(promo, items);
      if (applicableIndexes.length === 0) continue;

      const applicableTotal = this.roundMoney(
        applicableIndexes.reduce((sum, idx) => {
          const item = items[idx];
          return sum + Number(item.unit_price) * Number(item.quantity);
        }, 0),
      );
      if (applicableTotal <= 0) continue;

      // Min purchase is evaluated against the cart subtotal (not the scoped
      // applicable total) to mirror current `getEligiblePromotions` behaviour.
      if (
        promo.min_purchase_amount &&
        subtotal < Number(promo.min_purchase_amount)
      )
        continue;

      // ---------------------------------------------------------------
      // quantity_tiered branch: resolve ONE tier from the AGGREGATED scope
      // quantity, apply it to every line, sum, then global cap.
      // ---------------------------------------------------------------
      if (promo.rule_type === 'quantity_tiered') {
        const tiers = (promo.promotion_quantity_tiers ?? [])
          .slice()
          .sort((a, b) => {
            if (a.min_quantity !== b.min_quantity)
              return a.min_quantity - b.min_quantity;
            if (a.sort_order !== b.sort_order)
              return a.sort_order - b.sort_order;
            return a.id - b.id;
          });

        if (tiers.length === 0) continue;

        // Aggregate the scope quantity: ALL scopes sum the `quantity` of their
        // applicable lines (order = whole cart, category = category lines,
        // product = product lines INCLUDING variants/derivatives that share the
        // same product_id, already merged by resolveApplicableItemIndexes).
        const scopedQty = applicableIndexes.reduce(
          (sum, idx) => sum + Number(items[idx].quantity),
          0,
        );

        // Resolve ONE winning tier from the aggregated quantity. Tiers are
        // already sorted ascending by min_quantity, so `find` returns the
        // correct band. That single tier applies to every line in scope.
        const matchedTier = tiers.find(
          (t) =>
            t.min_quantity <= scopedQty &&
            (t.max_quantity === null || t.max_quantity >= scopedQty),
        );
        if (!matchedTier) continue;

        // Per-line discount computed from the FIXED winning tier (resolved once
        // from scopedQty above), not from each line's individual quantity.
        // percentage tiers apply per line; fixed_amount tiers apply a single
        // flat amount across the scope (capped at applicableTotal) split
        // proportionally across lines — see computeTierDiscountForResolvedTier.
        const perLineDiscount = new Map<number, number>();
        let rawTotal = 0;
        for (const idx of applicableIndexes) {
          const item = items[idx];
          const lineDiscount = this.computeTierDiscountForResolvedTier(
            Number(item.unit_price),
            Number(item.quantity),
            matchedTier,
            applicableTotal,
          );
          perLineDiscount.set(idx, lineDiscount);
          rawTotal = this.roundMoney(rawTotal + lineDiscount);
        }

        if (rawTotal <= 0) continue;

        // Apply the existing global max_discount_amount cap on top of the
        // summed line discounts; never exceed applicable scoped total either.
        let discountAmount = rawTotal;
        const maxDiscount = Number(promo.max_discount_amount);
        if (Number.isFinite(maxDiscount) && maxDiscount > 0) {
          discountAmount = Math.min(discountAmount, maxDiscount);
        }
        discountAmount = Math.min(discountAmount, applicableTotal);
        discountAmount = this.roundMoney(discountAmount);
        if (discountAmount <= 0) continue;

        // Proportionally scale per-line discounts to match the capped total
        // so the persisted snapshot matches the per-item breakdown exactly.
        const scale = rawTotal > 0 ? discountAmount / rawTotal : 0;
        let assigned = 0;
        applicableIndexes.forEach((idx, i) => {
          const item = items[idx];
          const lineTotal = Number(item.unit_price) * Number(item.quantity);
          const isLast = i === applicableIndexes.length - 1;
          const rawShare = perLineDiscount.get(idx) ?? 0;
          const proportionalShare = this.roundMoney(rawShare * scale);
          const share = isLast
            ? this.roundMoney(discountAmount - assigned)
            : proportionalShare;
          assigned = this.roundMoney(assigned + share);

          const current = itemBreakdownMap.get(idx);
          if (!current) return;
          const nextDiscount = this.roundMoney(current.promotion_discount + share);
          // Cap discount per line at the line total so final_unit_price >= 0.
          const cappedDiscount = Math.min(nextDiscount, lineTotal);
          const remainingLineTotal = this.roundMoney(lineTotal - cappedDiscount);
          const nextUnitPrice =
            item.quantity > 0
              ? this.roundMoney(remainingLineTotal / Number(item.quantity))
              : current.original_unit_price;

          itemBreakdownMap.set(idx, {
            ...current,
            promotion_discount: cappedDiscount,
            final_unit_price: Math.max(0, nextUnitPrice),
            final_line_total: Math.max(0, remainingLineTotal),
            promotion_ids: current.promotion_ids.includes(promo.id)
              ? current.promotion_ids
              : [...current.promotion_ids, promo.id],
          });
        });

        appliedPromotions.push({
          promotion_id: promo.id,
          name: promo.name,
          code: promo.code ?? null,
          type: promo.type,
          scope: promo.scope,
          value: Number(promo.value),
          is_auto_apply: promo.is_auto_apply,
          discount_amount: this.roundMoney(discountAmount),
          applicable_item_ids: applicableIndexes
            .map((idx) => itemBreakdownMap.get(idx)?.line_id)
            .filter((lineId): lineId is string | number => lineId !== undefined),
        });
        continue;
      }

      const discountAmount = this.computeDiscountAmount(promo, applicableTotal);
      if (discountAmount <= 0) continue;

      // Prorate the discount across applicable items proportional to their
      // line total so per-item breakdown stays accurate. We track the running
      // remainder and assign it to the last item to avoid rounding drift.
      let assigned = 0;
      applicableIndexes.forEach((idx, i) => {
        const item = items[idx];
        const lineTotal = Number(item.unit_price) * Number(item.quantity);
        const isLast = i === applicableIndexes.length - 1;
        const share = isLast
          ? this.roundMoney(discountAmount - assigned)
          : this.roundMoney((lineTotal / applicableTotal) * discountAmount);
        assigned = this.roundMoney(assigned + share);

        const current = itemBreakdownMap.get(idx);
        if (!current) return;
        const nextDiscount = this.roundMoney(current.promotion_discount + share);
        // Cap discount per line at the line total so final_unit_price >= 0.
        const cappedDiscount = Math.min(nextDiscount, lineTotal);
        const remainingLineTotal = this.roundMoney(lineTotal - cappedDiscount);
        const nextUnitPrice =
          item.quantity > 0
            ? this.roundMoney(remainingLineTotal / Number(item.quantity))
            : current.original_unit_price;

        itemBreakdownMap.set(idx, {
          ...current,
          promotion_discount: cappedDiscount,
          final_unit_price: Math.max(0, nextUnitPrice),
          final_line_total: Math.max(0, remainingLineTotal),
          promotion_ids: current.promotion_ids.includes(promo.id)
            ? current.promotion_ids
            : [...current.promotion_ids, promo.id],
        });
      });

      appliedPromotions.push({
        promotion_id: promo.id,
        name: promo.name,
        code: promo.code ?? null,
        type: promo.type,
        scope: promo.scope,
        value: Number(promo.value),
        is_auto_apply: promo.is_auto_apply,
        discount_amount: this.roundMoney(discountAmount),
        applicable_item_ids: applicableIndexes
          .map((idx) => itemBreakdownMap.get(idx)?.line_id)
          .filter((lineId): lineId is string | number => lineId !== undefined),
      });
    }

    const itemBreakdown = Array.from(itemBreakdownMap.values());
    const totalDiscount = this.roundMoney(
      appliedPromotions.reduce((sum, p) => sum + p.discount_amount, 0),
    );
    const promotionalSubtotal = this.roundMoney(
      Math.max(0, subtotal - totalDiscount),
    );

    const snapshot: OrderPromotionSnapshot[] = appliedPromotions.map((p) => ({
      promotion_id: p.promotion_id,
      discount_amount: p.discount_amount,
    }));

    // Pure, non-mutating read over the SAME candidate set resolved above. Never
    // touches the discount math; the return only GAINS this field.
    const tierProgress = this.buildTierProgress(candidates, items);

    return {
      subtotal,
      total_discount: totalDiscount,
      promotional_subtotal: promotionalSubtotal,
      applied_promotions: appliedPromotions,
      items: itemBreakdown,
      order_promotions_snapshot: snapshot,
      tier_progress: tierProgress,
    };
  }

  /**
   * Compute the "next tier" nudge for auto-apply `quantity_tiered` promotions.
   * Pure READ over the candidate promotions + cart items: reuses the SAME scope
   * resolver (`resolveApplicableItemIndexes`) and tier ordering as the discount
   * branch, and performs NO discount math. Structured mirror of the POS-only
   * frontend helper `getPromotionTierProgress` so POS and ecommerce nudge
   * identically. Returns one entry per promo that already has items in scope AND
   * a next tier reachable above the current aggregated scope quantity.
   */
  private buildTierProgress(
    candidatePromos: PromotionRecord[],
    items: PromotionQuoteItemInput[],
  ): PromotionTierProgress[] {
    const progress: PromotionTierProgress[] = [];

    for (const promo of candidatePromos ?? []) {
      // Only auto-apply quantity_tiered promos surface a nudge.
      if (!promo?.is_auto_apply) continue;
      if (promo.rule_type !== 'quantity_tiered') continue;

      // Same tier ordering as the discount branch (min_quantity, sort_order, id).
      const tiers = (promo.promotion_quantity_tiers ?? [])
        .slice()
        .sort((a, b) => {
          if (a.min_quantity !== b.min_quantity)
            return a.min_quantity - b.min_quantity;
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return a.id - b.id;
        });
      if (tiers.length === 0) continue;

      // Aggregate the scope quantity with the SAME resolver the discount branch
      // uses, so the nudge and the applied discount always agree on scope.
      const applicableIndexes = this.resolveApplicableItemIndexes(promo, items);
      const scopedQty = applicableIndexes.reduce(
        (sum, idx) => sum + Number(items[idx].quantity),
        0,
      );
      // Only nudge when the customer already has in-scope items in the cart.
      if (scopedQty <= 0) continue;

      // Next tier = first tier whose threshold is still ABOVE the current qty.
      const nextTier = tiers.find((t) => t.min_quantity > scopedQty);
      if (!nextTier) continue;

      const remaining = nextTier.min_quantity - scopedQty;
      if (!Number.isFinite(remaining) || remaining <= 0) continue;

      progress.push({
        promotion_id: Number(promo.id),
        name: String(promo.name ?? ''),
        remaining_quantity: remaining,
        benefit_type: nextTier.type,
        benefit_value: Number(nextTier.value),
      });
    }

    return progress;
  }

  /**
   * Batch-fetch the active auto-apply promotions (scope=product or
   * scope=category) for product listings. POS and catalog use this to render
   * the promotional price + badge on cards without re-running the full
   * `quoteDiscounts` per product.
   *
   * Returns a Map<product_id, ActiveProductPromotion> for the products that
   * have at least one applicable promotion (highest priority wins, with
   * scope=product preferred over scope=category on ties).
   *
   * Notes:
   *  - Cart-only checks (usage_count vs usage_limit, per_customer_limit,
   *    min_purchase_amount) are intentionally skipped because we do not have
   *    a cart at listing time. The cart-time engine (`quoteDiscounts`) still
   *    enforces them at checkout/POS payment, so this can only over-state
   *    eligibility in edge cases (e.g. coupon-style usage cap). UI should
   *    treat the badge as informational; the authoritative discount is the
   *    one computed at checkout.
   *  - Order-scope promotions are excluded because they cannot be evaluated
   *    against a single product card.
   */
  async findActiveAutoPromotionsForProducts(
    products: ActivePromotionProductInput[],
    now: Date = new Date(),
  ): Promise<Map<number, ActiveProductPromotion>> {
    const result = new Map<number, ActiveProductPromotion>();
    if (!Array.isArray(products) || products.length === 0) return result;

    const promotions = (await this.prisma.promotions.findMany({
      where: {
        state: { in: ['active', 'scheduled'] },
        start_date: { lte: now },
        OR: [{ end_date: null }, { end_date: { gte: now } }],
        is_auto_apply: true,
        scope: { in: ['product', 'category'] },
      },
      include: {
        promotion_products: { select: { product_id: true } },
        promotion_categories: { select: { category_id: true } },
        promotion_quantity_tiers: true,
      },
      orderBy: { priority: 'desc' },
    })) as unknown as PromotionRecord[];

    if (promotions.length === 0) return result;

    for (const input of products) {
      const productId = Number(input.product_id);
      if (!Number.isFinite(productId)) continue;
      const unitPrice = Number(input.unit_price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

      const categoryIds = (input.category_ids ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id));

      // Find the highest priority eligible promotion for this product.
      // Promotions are pre-ordered by priority desc; among equal priorities,
      // prefer scope=product over scope=category for clearer UX.
      let chosen: { promo: PromotionRecord; rank: number } | null = null;
      for (const promo of promotions) {
        const productIds = (promo.promotion_products ?? []).map((pp) =>
          Number(pp.product_id),
        );
        const promoCategoryIds = (promo.promotion_categories ?? []).map((pc) =>
          Number(pc.category_id),
        );

        const matchesProduct =
          promo.scope === 'product' && productIds.includes(productId);
        const matchesCategory =
          promo.scope === 'category' &&
          promoCategoryIds.some((cid) => categoryIds.includes(cid));

        if (!matchesProduct && !matchesCategory) continue;

        // Higher rank wins: product scope beats category scope at same priority.
        const rank =
          (promo.priority ?? 0) * 10 + (promo.scope === 'product' ? 1 : 0);
        if (chosen === null || rank > chosen.rank) {
          chosen = { promo, rank };
        }
      }

      if (!chosen) continue;
      const promo = chosen.promo;
      const promoType = promo.type as PromotionQuoteType;
      const value = Number(promo.value);

      // quantity_tiered promotions don't have a fixed single-unit discount; we
      // surface the lowest tier (by min_quantity) as a preview signal so
      // downstream UIs can show "Descuentos por cantidad" + minimum tier
      // value without forcing the UI to query tiers directly. The
      // `promotional_price` for such promos stays at the unit price (no
      // instant discount applies on a single-unit view).
      if (promo.rule_type === 'quantity_tiered') {
        const tiers = (promo.promotion_quantity_tiers ?? [])
          .slice()
          .sort((a, b) => {
            if (a.min_quantity !== b.min_quantity)
              return a.min_quantity - b.min_quantity;
            if (a.sort_order !== b.sort_order)
              return a.sort_order - b.sort_order;
            return a.id - b.id;
          });
        const firstTier = tiers[0];
        if (!firstTier) continue;
        const tierValue = Number(firstTier.value);
        if (!Number.isFinite(tierValue) || tierValue <= 0) continue;

        const previewMinDiscount =
          firstTier.type === 'percentage'
            ? this.roundMoney((unitPrice * tierValue) / 100)
            : this.roundMoney(tierValue);

        const baseEntry: ActiveProductPromotion = {
          id: promo.id,
          name: promo.name,
          type: promoType,
          scope: promo.scope === 'product' ? 'product' : 'category',
          discount_percentage:
            firstTier.type === 'percentage' ? tierValue : undefined,
          discount_amount:
            firstTier.type === 'fixed_amount' ? tierValue : undefined,
          promotional_price: this.roundMoney(unitPrice),
          badge_label: this.buildQuantityTieredBadgeLabel(firstTier),
          priority: promo.priority ?? 0,
        };

        // Forward extra signals for downstream consumers (Agent C may extend
        // the interface contract). The shared `ActiveProductPromotion`
        // interface does not declare these today, so we cast to keep the
        // engine's typed contract intact while still surfacing them at
        // runtime.
        const extendedEntry = {
          ...baseEntry,
          is_quantity_tiered: true,
          preview_min_discount: previewMinDiscount,
        };
        result.set(productId, extendedEntry as unknown as ActiveProductPromotion);
        continue;
      }

      const discount = this.computeDiscountAmount(promo, unitPrice);
      if (discount <= 0) continue;

      const promotionalPrice = this.roundMoney(Math.max(0, unitPrice - discount));
      const isPercentage = promoType === 'percentage';

      result.set(productId, {
        id: promo.id,
        name: promo.name,
        type: promoType,
        scope: promo.scope === 'product' ? 'product' : 'category',
        discount_percentage: isPercentage ? value : undefined,
        discount_amount: isPercentage ? undefined : value,
        promotional_price: promotionalPrice,
        badge_label: this.buildBadgeLabel(promo, discount, unitPrice),
        priority: promo.priority ?? 0,
      });
    }

    return result;
  }

  /**
   * Build a badge label for a promotion in a LISTING / BANNER context where
   * there is NO single product unit price (e.g. the public storefront "active
   * promotions" banner). Reuses the SAME private builders that power product
   * cards so the promotional copy stays consistent across surfaces:
   *  - quantity_tiered → lowest tier via `buildQuantityTieredBadgeLabel`
   *    ("Desde N und: -X%" / "Desde N und: -$Y").
   *  - flat percentage → "-X% OFF".
   *  - flat fixed_amount → "-$Y OFF" (es-CO whole-currency amount).
   * Falls back to a generic "OFERTA" when the promotion carries no usable
   * value. The parameter type intentionally uses only exported / inline types
   * (no private engine names) so `declaration` emit stays clean.
   */
  buildPromotionBadgeLabel(promo: {
    type: PromotionQuoteType;
    value: unknown;
    rule_type: 'flat' | 'quantity_tiered';
    promotion_quantity_tiers?: Array<{
      id: number;
      promotion_id: number;
      min_quantity: number;
      max_quantity: number | null;
      type: PromotionQuoteType;
      value: unknown;
      sort_order: number;
    }>;
  }): string {
    if (promo.rule_type === 'quantity_tiered') {
      const tiers = (promo.promotion_quantity_tiers ?? [])
        .slice()
        .sort((a, b) => {
          if (a.min_quantity !== b.min_quantity)
            return a.min_quantity - b.min_quantity;
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return a.id - b.id;
        });
      const firstTier = tiers[0];
      return firstTier
        ? this.buildQuantityTieredBadgeLabel(firstTier)
        : 'Descuentos por cantidad';
    }

    const value = Number(promo.value);
    if (promo.type === 'percentage' && Number.isFinite(value) && value > 0) {
      return `-${Math.round(value)}% OFF`;
    }
    if (promo.type === 'fixed_amount' && Number.isFinite(value) && value > 0) {
      return `-$${this.formatCurrencyInteger(value)} OFF`;
    }
    return 'OFERTA';
  }

  /**
   * Build a compact badge label for product cards. Prefer percentage when the
   * promotion is percentage-typed, otherwise show the absolute saved amount.
   */
  private buildBadgeLabel(
    promo: PromotionRecord,
    discount: number,
    unitPrice: number,
  ): string {
    if (promo.type === 'percentage') {
      const value = Number(promo.value);
      if (Number.isFinite(value) && value > 0) {
        return `-${Math.round(value)}% OFF`;
      }
    }

    // Compute effective percentage from the capped discount for fixed_amount
    // promotions; this is more informative than the raw amount on cards.
    if (unitPrice > 0) {
      const effectivePct = Math.round((discount / unitPrice) * 100);
      if (effectivePct > 0) return `-${effectivePct}% OFF`;
    }

    return 'OFERTA';
  }

  /**
   * Compact badge label for quantity_tiered promotions on product cards.
   * Distinct from `buildBadgeLabel` because there is no instant single-unit
   * discount — the badge advertises the minimum quantity needed AND the real
   * benefit of that tier, coherent with the `discount_percentage` /
   * `discount_amount` signals the same method exposes for this tier:
   *  - percentage   → "Desde N und: -X%"   (X without decimals when integer)
   *  - fixed_amount → "Desde N und: -$Y"    (Y as an es-CO whole-currency
   *                                           amount, e.g. -$5.000)
   */
  private buildQuantityTieredBadgeLabel(
    tier: PromotionQuantityTierRecord,
  ): string {
    const minQuantity = Number(tier.min_quantity);
    const prefix =
      Number.isFinite(minQuantity) && minQuantity > 1
        ? `Desde ${minQuantity} und: `
        : '';

    const value = Number(tier.value);
    if (Number.isFinite(value) && value > 0) {
      if (tier.type === 'percentage') {
        const pct = Number.isInteger(value)
          ? value
          : Math.round(value * 100) / 100;
        return `${prefix}-${pct}%`;
      }
      // fixed_amount: flat currency amount.
      return `${prefix}-$${this.formatCurrencyInteger(value)}`;
    }

    // No usable tier value: keep the generic quantity-discount hint.
    return prefix ? `${prefix}descuento` : 'Descuentos por cantidad';
  }

  /**
   * Format a whole-currency amount with es-CO thousands separators (e.g.
   * `5000` → `5.000`). Matches the repo's existing `toLocaleString('es-CO')`
   * money-rendering convention; no new dependencies.
   */
  private formatCurrencyInteger(value: number): string {
    const amount = Math.round(Number(value) || 0);
    return amount.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  /** Resolve which item indexes a promotion applies to based on its scope. */
  private resolveApplicableItemIndexes(
    promotion: PromotionRecord,
    items: PromotionQuoteItemInput[],
  ): number[] {
    if (promotion.scope === 'product') {
      const promoProductIds = (promotion.promotion_products ?? []).map((pp) =>
        Number(pp.product_id),
      );
      return items
        .map((item, idx) =>
          promoProductIds.includes(Number(item.product_id)) ? idx : -1,
        )
        .filter((idx) => idx >= 0);
    }

    if (promotion.scope === 'category') {
      const promoCategoryIds = (promotion.promotion_categories ?? []).map((pc) =>
        Number(pc.category_id),
      );
      return items
        .map((item, idx) =>
          this.getItemCategoryIds(item).some((categoryId) =>
            promoCategoryIds.includes(categoryId),
          )
            ? idx
            : -1,
        )
        .filter((idx) => idx >= 0);
    }

    // Order scope: applies to the whole cart.
    return items.map((_, idx) => idx);
  }

  /**
   * Compute the raw discount amount for a promotion against a scoped total,
   * honouring `max_discount_amount` cap and the applicable total ceiling.
   */
  private computeDiscountAmount(
    promotion: PromotionRecord,
    applicableTotal: number,
  ): number {
    let discount = 0;
    if (promotion.type === 'percentage') {
      discount = applicableTotal * (Number(promotion.value) / 100);
    } else {
      discount = Math.min(Number(promotion.value), applicableTotal);
    }

    const maxDiscount = Number(promotion.max_discount_amount);
    if (Number.isFinite(maxDiscount) && maxDiscount > 0) {
      discount = Math.min(discount, maxDiscount);
    }

    // Never discount more than the applicable scoped total.
    discount = Math.min(discount, applicableTotal);
    return this.roundMoney(discount);
  }

  /**
   * Compute the per-line discount contribution for a `quantity_tiered`
   * promotion once the winning tier has ALREADY been resolved from the
   * aggregated scope quantity (`scopedQty`) by the caller. The tier is fixed
   * for every line in scope, so this helper never performs a `find`; it only
   * applies the tier math to a single line. Tier math:
   *  - percentage: `lineTotal × tier.value / 100` (each line, its own %).
   *  - fixed_amount: a FLAT amount applied ONCE across the whole scope
   *    (`min(tier.value, applicableTotal)`) — NOT multiplied per unit or per
   *    line — split across lines proportional to each line total. This mirrors
   *    the non-tiered `flat` fixed_amount path in `computeDiscountAmount`
   *    (`Math.min(Number(promotion.value), applicableTotal)`). Business rule
   *    confirmed: a fixed_amount tier discounts a single flat amount, exactly
   *    like a non-tiered fixed discount.
   * The returned share is capped at the line total (never a negative line) and
   * rounded to 2 decimals. Returns 0 when guards fail (quantity <= 0,
   * unitPrice <= 0, tier.value <= 0, or, for fixed_amount, applicableTotal <= 0).
   */
  private computeTierDiscountForResolvedTier(
    unitPrice: number,
    quantity: number,
    tier: PromotionQuantityTierRecord,
    applicableTotal: number,
  ): number {
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    if (!Number.isFinite(price) || price <= 0) return 0;

    const tierValue = Number(tier.value);
    if (!Number.isFinite(tierValue) || tierValue <= 0) return 0;

    const lineTotal = price * qty;
    let discount = 0;
    if (tier.type === 'percentage') {
      discount = (lineTotal * tierValue) / 100;
    } else {
      // fixed_amount: FLAT amount applied ONCE to the whole scope, split across
      // lines proportional to their line total (parity with the non-tiered flat
      // fixed discount). It is NOT multiplied per unit or per line.
      const scopeTotal = Number(applicableTotal);
      if (!Number.isFinite(scopeTotal) || scopeTotal <= 0) return 0;
      const flatDiscount = Math.min(tierValue, scopeTotal);
      discount = (lineTotal / scopeTotal) * flatDiscount;
    }

    // Never discount more than the line total (final line total >= 0).
    discount = Math.max(0, Math.min(discount, lineTotal));
    return this.roundMoney(discount);
  }

  private roundMoney(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }
}
