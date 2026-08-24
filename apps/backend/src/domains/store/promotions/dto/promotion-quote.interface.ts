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
  /**
   * Presentación de venta aplicada a la línea (`price_tiers.id`). Su sola
   * presencia le dice al motor que `unit_price` YA es el precio del paquete
   * completo y `quantity` YA cuenta paquetes.
   *
   * Sin este dato, un producto que además declara escala (`price_unit_quantity
   * > 1`) recibe el precio del paquete y lo vuelve a dividir por la escala:
   * cobra de menos. El motor tiene el predicado desde siempre
   * (`isSoldByPresentation`); lo que faltaba era que los callers lo alimentaran.
   */
  applied_price_tier_id?: number | null;
  /**
   * Unidades de stock que consume la línea (`quantity × pack_size`). Viaja
   * junto a `applied_price_tier_id` y cumple el mismo papel de señal: el motor
   * acepta cualquiera de los dos por si una superficie llega con el snapshot a
   * medias.
   */
  stock_units_consumed?: number | null;
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
  /**
   * Optional evaluation strategy override. When omitted, reads from `store_settings.promotions.evaluation_strategy`
   * with fallback to `'winner_takes_all'`.
   */
  strategy?: 'winner_takes_all' | 'stacking_groups';
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
  /**
   * Unique `product_id`s that contributed to this promotion's discount.
   * Surfaced to the frontend so the cart UI can name the products/SKUs that
   * actually unlocked the deal (e.g. "Super promo — en: Kit de freno, Kit de
   * arrastre"). Empty when the discount crossed product boundaries (e.g.
   * `scope='order'` with a percentage off the whole cart).
   */
  target_product_ids?: number[];
  /**
   * Promotion priority that determined this promo as the winner. Surfaced to
   * the frontend for the cart audit trail — an order has at most ONE active
   * promotion (the highest priority wins, ties broken by lowest promotion_id).
   * Optional for back-compat with older backend versions.
   */
  priority?: number;
}

export interface PromotionQuoteItemBreakdown {
  line_id?: string | number;
  product_id: number;
  variant_id?: number | null;
  /** Cantidad en unidades de STOCK, tal como llegó en la línea. */
  quantity: number;
  /**
   * Unit price BEFORE any promotional discount, expressed per PRICE unit —
   * per metre for a cable stocked in millimetres, not per millimetre.
   */
  original_unit_price: number;
  /** Total promotional discount for this item across all applied promotions. */
  promotion_discount: number;
  /** Effective unit price after applying promotions (>= 0), same scale as `original_unit_price`. */
  final_unit_price: number;
  /**
   * Final line total after promotions. Es `final_unit_price × unidades de
   * PRECIO`, no `× quantity`: cuando el producto publica su precio por N
   * unidades de stock (`products.price_unit_quantity`), las dos difieren por
   * ese factor. Con N = 1 —todo el catálogo histórico— coinciden.
   */
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
  /**
   * `product_id` of the cart line(s) that are closest to qualifying for the
   * next tier. Populated when `quantity_grouping === 'per_product'` (the
   * engine reports which specific SKU needs more units); null otherwise (the
   * scope crosses products, e.g. `cart_total` or `scope='order'`).
   *
   * The frontend resolves the product name locally by crossing this id with
   * `cart.items[]` — the engine never resolves names to keep its contract
   * numeric and side-effect-free.
   */
  target_product_id?: number | null;
}

export interface PromotionQuoteResult {
  /** Subtotal of items BEFORE any promotional discount. */
  subtotal: number;
  /** Sum of every promotion discount applied. */
  total_discount: number;
  /** subtotal - total_discount (>= 0). */
  promotional_subtotal: number;
  /** Strategy used to evaluate and apply promotions for this quote. */
  strategy_applied?: 'winner_takes_all' | 'stacking_groups';
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
 * Compact snapshot of a single tier row from `promotion_quantity_tiers`,
 * surfaced on `ActiveProductPromotion.quantity_tiers` so the frontend can
 * render the full tier ladder ("Lleva 3 → -10% · Lleva 6 → -15% …") without
 * re-querying the backend. Values are flattened to a strict shape:
 *   - `type` is the literal union, not the broader `PromotionQuoteType` alias.
 *   - `value` is normalised to `number` (raw `Decimal`-compatible values from
 *     Prisma are coerced here so consumers never see `unknown`).
 *   - `max_quantity` is `null` for open-ended top tiers.
 *
 * Rows are emitted ordered by `min_quantity` ASC; secondary order by
 * `sort_order` ASC; final tie-break by tier `id` ASC — same ordering the
 * engine uses internally for tier resolution.
 */
export interface QuantityTierSummary {
  min_quantity: number;
  max_quantity: number | null;
  type: 'percentage' | 'fixed_amount';
  value: number;
  sort_order: number;
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
  /**
   * `true` ONLY for `quantity_tiered` promos. Lets the frontend branch on
   * the rule type without re-deriving it from `promotion_quantity_tiers`.
   * `undefined` (NOT `false`) for flat promos.
   */
  is_quantity_tiered?: boolean;
  /**
   * Lowest-tier discount, in money, used as the card preview signal
   * ("Descuentos por cantidad — desde $5.000 OFF"). Mirrors what the badge
   * advertises so the frontend can show a numeric hint without re-running
   * the math. `undefined` for flat promos.
   */
  preview_min_discount?: number;
  /**
   * Full tier ladder for `quantity_tiered` promos, ordered by `min_quantity`
   * ASC. Empty array `[]` (NOT `undefined`) for flat promos — the field is
   * always present so consumers can iterate unconditionally.
   */
  quantity_tiers?: QuantityTierSummary[];
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
