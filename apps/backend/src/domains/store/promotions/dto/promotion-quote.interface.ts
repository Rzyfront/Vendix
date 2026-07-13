/**
 * Input/Output contracts for the reusable promotion quote calculation in
 * `PromotionEngineService.quoteDiscounts`. This is the single source of truth
 * consumed by POS, catalog, checkout and orders for promotional pricing.
 *
 * Money values are plain `number` (already rounded to 2 decimals). The engine
 * accepts Decimal-compatible values from Prisma but always normalizes the
 * output to numbers so consumers can do arithmetic safely.
 *
 * Discounts are calculated over the products subtotal BEFORE shipping.
 */

export type PromotionQuoteScope = 'order' | 'product' | 'category';
export type PromotionQuoteType = 'percentage' | 'fixed_amount';

/**
 * Cart/order line items as seen by the promotion engine. Consumers only need
 * to provide identification + unit price + quantity. Categories may be a
 * single id or an array (products often belong to multiple categories).
 */
export interface PromotionQuoteItemInput {
  /** Stable identifier of the cart item (used to map output back). */
  line_id?: string | number;
  product_id: number;
  variant_id?: number | null;
  category_id?: number | null;
  category_ids?: Array<number | string> | null;
  unit_price: number;
  quantity: number;
}

export interface PromotionQuoteInput {
  items: PromotionQuoteItemInput[];
  /**
   * Optional customer id. Required when promotions have per-customer usage
   * limits; engine will still try to quote when absent (limit skipped).
   */
  customer_id?: number | null;
  /**
   * Manual promotion ids submitted explicitly by the caller (e.g. user picked
   * a non-auto promotion in POS). Manual promotions are ONLY applied when
   * passed here.
   */
  manual_promotion_ids?: number[];
  /**
   * Reference date used for date-range eligibility. Defaults to `new Date()`.
   * Useful for deterministic tests and replays.
   */
  now?: Date;
}

export interface PromotionQuoteApplied {
  promotion_id: number;
  name: string;
  code: string | null;
  type: PromotionQuoteType;
  scope: PromotionQuoteScope;
  value: number;
  /** Whether this promotion was triggered automatically by `is_auto_apply`. */
  is_auto_apply: boolean;
  /** Total discount in money produced by this promotion across the cart. */
  discount_amount: number;
  /** Items the discount was prorated against (sorted by line index). */
  applicable_item_ids: Array<string | number | undefined>;
}

export interface PromotionQuoteItemBreakdown {
  line_id?: string | number;
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  /** Unit price BEFORE any promotional discount. */
  original_unit_price: number;
  /** Total promotional discount for this item across all applied promotions. */
  promotion_discount: number;
  /** Effective unit price after applying promotions (>= 0). */
  final_unit_price: number;
  /** Final line total after promotions (= final_unit_price * quantity). */
  final_line_total: number;
  /** All promotion ids that contributed to this item's discount. */
  promotion_ids: number[];
}

/**
 * Persistence-ready snapshot for `order_promotions`. The orders/payments
 * services map this 1:1 to `order_promotions.create` so promotions, totals
 * and audit trail stay consistent.
 */
export interface OrderPromotionSnapshot {
  promotion_id: number;
  discount_amount: number;
}

/**
 * "Next tier" nudge for an auto-apply `quantity_tiered` promotion that already
 * has items in the cart scope but has NOT yet reached its next threshold.
 * Structured, currency-unformatted mirror of the POS-only frontend helper
 * (`getPromotionTierProgress` / `formatTierBenefit`) so POS and ecommerce nudge
 * identically. Consumers format `benefit_value` for display; the engine never
 * formats money here.
 */
export interface PromotionTierProgress {
  promotion_id: number;
  name: string;
  /** Units still needed to unlock the next tier. */
  remaining_quantity: number;
  benefit_type: 'percentage' | 'fixed_amount';
  /** RAW tier value (percentage points or money amount). NOT formatted. */
  benefit_value: number;
}

export interface PromotionQuoteResult {
  /** Subtotal of items BEFORE any promotional discount. */
  subtotal: number;
  /** Sum of every promotion discount applied. */
  total_discount: number;
  /** subtotal - total_discount (>= 0). */
  promotional_subtotal: number;
  applied_promotions: PromotionQuoteApplied[];
  items: PromotionQuoteItemBreakdown[];
  /** Order_promotions records ready to persist (one per applied promotion). */
  order_promotions_snapshot: OrderPromotionSnapshot[];
  /**
   * "Add N more and get X off" nudges for auto-apply quantity_tiered
   * promotions with items already in scope but a higher tier still reachable.
   * Pure read: never affects the discount math above.
   */
  tier_progress: PromotionTierProgress[];
}

/**
 * Active promotion descriptor surfaced on product cards (POS + ecommerce).
 *
 * Represents the highest-priority auto-apply promotion eligible for a given
 * product based on scope=product or scope=category. `promotional_price` is
 * the unit price AFTER applying the promotion (tax-inclusive when the
 * input was tax-inclusive). Order-scope promotions are NOT included here
 * because they depend on cart context, not on the product itself.
 */
export interface ActiveProductPromotion {
  id: number;
  name: string;
  type: PromotionQuoteType;
  scope: 'product' | 'category';
  /** Percentage value when `type === 'percentage'` (0..100), undefined otherwise. */
  discount_percentage?: number;
  /** Fixed amount when `type === 'fixed_amount'`, undefined otherwise. */
  discount_amount?: number;
  /** Effective unit price after the discount (rounded to 2 decimals). */
  promotional_price: number;
  /** Short label that the UI badge can show ("-20% OFF", "$5.000 OFF"). */
  badge_label: string;
  priority: number;
}

/**
 * Minimal product shape the engine needs to evaluate auto-apply promotions
 * for listing/cards. Consumers (POS, catalog) build this from their own
 * Prisma queries without depending on the products domain.
 */
export interface ActivePromotionProductInput {
  product_id: number;
  category_ids: number[];
  /**
   * Base unit price that the promotion discount applies to. Consumers may
   * pass the already-tax-inclusive `final_price` so the resulting
   * `promotional_price` stays comparable on the card.
   */
  unit_price: number;
}
