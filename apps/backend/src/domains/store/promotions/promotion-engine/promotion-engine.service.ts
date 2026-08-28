import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { resolvePriceUnits } from '../../products/services/price-unit.util';
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
  QuantityTierSummary,
} from '../dto/promotion-quote.interface';

/** Promotions resolve rule types from the Prisma enum. */
type PromotionRuleType = 'flat' | 'quantity_tiered';

/**
 * Línea mínima que la aritmética de escala necesita leer. Cubre a la vez el
 * `PromotionQuoteItemInput` tipado que entra por `quoteDiscounts` y los
 * `any[]` sin tipo que llegan por `POST /store/promotions/check-eligibility`,
 * para que las dos superficies compartan exactamente el mismo cálculo.
 */
type ScalableLine = {
  product_id?: unknown;
  unit_price?: unknown;
  quantity?: unknown;
  stock_units_consumed?: unknown;
  applied_price_tier_id?: unknown;
};

/**
 * "Ningún producto declara escala". Se usa como valor por defecto en los
 * caminos legacy sincrónicos, donde colapsa la aritmética a la histórica
 * `unit_price × quantity`.
 */
const NO_SALE_UNIT_SCALES: ReadonlyMap<number, number> = new Map();

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
  // quantity_grouping: how quantity_tiered promos aggregate cart quantities
  // when checking tier thresholds. Added in migration 20260715... — the
  // Prisma client may not know about it yet (it returns unknown).
  quantity_grouping?: 'cart_total' | 'per_product';
  start_date: Date;
  end_date: Date | null;
  state: string;
  promotion_products?: Array<{ product_id: number }>;
  promotion_categories?: Array<{ category_id: number }>;
  promotion_quantity_tiers?: PromotionQuantityTierRecord[];
}

@Injectable()
export class PromotionEngineService {
  private readonly logger = new Logger(PromotionEngineService.name);

  constructor(private prisma: StorePrismaService) {}

  /**
   * Get eligible promotions for the current cart
   */
  async getEligiblePromotions(cartItems: any[], customerId?: number) {
    const now = new Date();

    // Misma escala de venta que `quoteDiscounts`: /check-eligibility y el
    // snapshot del POS tienen que ver el mismo dinero, o el cliente vería un
    // descuento al validar y otro al cobrar.
    const saleUnitScale = await this.resolveSaleUnitScales(cartItems ?? []);

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
      // Priority follows the "1 = highest" convention (ranking-style, intuitive
      // for UI). Lower number wins. Promos with the same priority keep their
      // insertion order (id desc as tiebreaker).
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });

    // CP-ECOM-PROMO-UX-001 convergence-R5-N+1: batch per-customer usage
    // counts via a single `groupBy` instead of issuing one `count` per
    // candidate promo. With N promos carrying `per_customer_limit`, the
    // loop below used to issue N extra queries per `getCart`; now it is a
    // single round-trip and the per-promo check is a Map lookup. Same
    // shape as the optimization applied to `quoteDiscounts`.
    const usageCounts = new Map<number, number>();
    const candidateIds = promotions.map((p) => p.id);
    if (customerId && candidateIds.length > 0) {
      const rows = await this.prisma.order_promotions.groupBy({
        by: ['promotion_id'],
        where: {
          promotion_id: { in: candidateIds },
          customer_id: customerId,
        },
        _count: { _all: true },
      });
      for (const row of rows) {
        usageCounts.set(Number(row.promotion_id), Number(row._count._all));
      }
    }

    const eligible: any[] = [];
    for (const promo of promotions) {
      // Check usage limit
      if (promo.usage_limit && promo.usage_count >= promo.usage_limit) continue;

      // Check per-customer limit (looked up from the batched Map above).
      if (promo.per_customer_limit && customerId) {
        const customerUsage = usageCounts.get(promo.id) ?? 0;
        if (customerUsage >= promo.per_customer_limit) continue;
      }

      const applicableTotal = this.calculateApplicableTotal(
        promo,
        cartItems,
        saleUnitScale,
      );
      if (applicableTotal <= 0) continue;

      // Check minimum purchase
      const cartTotal = cartItems.reduce(
        (sum, item) => sum + this.lineTotal(item, saleUnitScale),
        0,
      );
      if (
        promo.min_purchase_amount &&
        cartTotal < Number(promo.min_purchase_amount)
      )
        continue;

      // Calculate discount
      const discount = this.calculateDiscount(promo, cartItems, saleUnitScale);

      eligible.push({
        ...promo,
        calculated_discount: discount,
      });
    }

    // WINNER-TAKES-ALL: return only the single lowest-priority-number
    // eligible promotion (1 = highest, per the "1=highest" convention).
    // Ties broken by lowest promotion_id (the older promo wins). This MUST
    // match quoteDiscounts exactly, otherwise /check-eligibility and the POS
    // payments snapshot pick different winners whenever two promos share a
    // priority — which is the common case, since promotions.priority defaults
    // to 0.
    if (eligible.length === 0) return eligible;
    const winner = eligible.reduce((best, current) => {
      if (
        current.priority < best.priority ||
        (current.priority === best.priority && current.id < best.id)
      ) {
        return current;
      }
      return best;
    });
    return [winner];
  }

  /**
   * Calculate discount amount for a promotion.
   *
   * `scaleByProduct` trae el `price_unit_quantity` de los productos que
   * publican su precio por N unidades de stock. Se recibe por parámetro porque
   * este método es sincrónico y la escala se lee una sola vez por carrito; sin
   * él la aritmética colapsa a la histórica `unit_price × quantity`, que es lo
   * correcto para todo el catálogo por pieza.
   */
  calculateDiscount(
    promotion: any,
    cartItems: any[],
    scaleByProduct: ReadonlyMap<number, number> = NO_SALE_UNIT_SCALES,
  ): number {
    const applicableTotal = this.calculateApplicableTotal(
      promotion,
      cartItems,
      scaleByProduct,
    );

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

  private calculateApplicableTotal(
    promotion: any,
    cartItems: any[],
    scaleByProduct: ReadonlyMap<number, number> = NO_SALE_UNIT_SCALES,
  ): number {
    if (promotion.scope === 'product') {
      const promoProductIds =
        promotion.promotion_products?.map((pp: any) => Number(pp.product_id)) ||
        [];

      return cartItems
        .filter((item) => promoProductIds.includes(Number(item.product_id)))
        .reduce((sum, item) => sum + this.lineTotal(item, scaleByProduct), 0);
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
        .reduce((sum, item) => sum + this.lineTotal(item, scaleByProduct), 0);
    }

    return cartItems.reduce(
      (sum, item) => sum + this.lineTotal(item, scaleByProduct),
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

    // Misma escala de venta que `quoteDiscounts` y `getEligiblePromotions`.
    const saleUnitScale = await this.resolveSaleUnitScales(cartItems ?? []);

    const cartTotal = cartItems.reduce(
      (sum, item) => sum + this.lineTotal(item, saleUnitScale),
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

    const applicableTotal = this.calculateApplicableTotal(
      promotion,
      cartItems,
      saleUnitScale,
    );
    if (applicableTotal <= 0) {
      throw new BadRequestException('Promocion no aplica a los items del carrito');
    }

    const discount = this.calculateDiscount(promotion, cartItems, saleUnitScale);
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
  /**
   * `price_unit_quantity` por producto del carrito. Solo devuelve los que
   * publican su precio por N unidades: la ausencia significa escala 1, que es
   * todo el catálogo por pieza y no necesita consulta ni conversión.
   */
  private async resolveSaleUnitScales(
    items: ScalableLine[],
  ): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const ids = Array.from(
      new Set(
        items
          .map((i) => Number(i.product_id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    if (ids.length === 0) return out;
    try {
      const rows = await this.prisma.products.findMany({
        where: { id: { in: ids } },
        select: { id: true, price_unit_quantity: true },
      });
      for (const row of rows as any[]) {
        const n = Number(row.price_unit_quantity ?? 1);
        if (Number.isFinite(n) && n > 1) out.set(Number(row.id), n);
      }
    } catch {
      // Sin la escala, la promoción cuenta como siempre: preferible a no
      // cotizar descuentos por una lectura fallida.
      return out;
    }
    return out;
  }

  /**
   * Una línea vendida por PRESENTACIÓN ya viene en su propia escala:
   * `unit_price` es el precio del paquete completo y `quantity` cuenta
   * paquetes, no unidades de stock. Volver a dividir por `price_unit_quantity`
   * contaría de menos y —peor— cobraría de menos.
   *
   * Predicado ÚNICO a propósito: lo comparten la CANTIDAD (`toSaleUnits`) y el
   * DINERO (`toPriceUnits`), para que las dos lecturas de una misma línea no
   * puedan divergir nunca. `applied_price_tier_id` viaja junto a
   * `stock_units_consumed` en todos los caminos que hoy persisten una
   * presentación; se lee también por si alguna superficie llega con el
   * snapshot a medias.
   */
  private isSoldByPresentation(item: ScalableLine): boolean {
    return (
      item.stock_units_consumed != null || item.applied_price_tier_id != null
    );
  }

  /**
   * Cantidad de una línea expresada en unidades de VENTA — el contador de
   * TRAMOS ("lleva 3").
   *
   * Una línea con presentación aplicada ya cuenta paquetes —2 bultos son 2— y
   * queda intacta. Una línea de un producto con escala se divide: 3.000 mm de
   * un cable vendido por metro son 3. El piso es 1 cuando la cantidad vendida
   * es menor que la escala (medio metro sigue siendo una compra, no cero).
   */
  private toSaleUnits(
    item: ScalableLine,
    scaleByProduct: ReadonlyMap<number, number>,
  ): number {
    const quantity = Number(item.quantity) || 0;
    if (this.isSoldByPresentation(item)) {
      const stockUnits = Number(item.stock_units_consumed);
      if (Number.isFinite(stockUnits) && stockUnits > 0) {
        return stockUnits;
      }
      return quantity;
    }
    const scale = scaleByProduct.get(Number(item.product_id));
    if (!scale || scale <= 1) return quantity;
    const converted = resolvePriceUnits(quantity, scale);
    // CP-ECOM-PROMO-UX-001 M7: trace scale conversions so that "I bought 3
    // meters of cable and the tier didn't fire" reports can be reconstructed.
    this.logger.debug(
      {
        productId: Number(item.product_id),
        unitsPerPackage: scale,
        convertedQty: converted,
      },
      'Scale converted',
    );
    return converted >= 1 ? Math.floor(converted) : converted;
  }

  /**
   * Unidades de PRECIO de una línea — el multiplicador del DINERO.
   *
   * Comparte la escala con `toSaleUnits` pero NO su piso, y esa distinción es
   * el corazón de QUI-648:
   *
   *   - `toSaleUnits` cuenta unidades ENTERAS porque resuelve un TRAMO: "lleva
   *     3" no se cumple con 2,5 metros, así que aplica `Math.floor`.
   *   - el DINERO es continuo: 2.500 mm de un cable publicado a $5.000 el
   *     metro son 2,5 metros y valen $12.500. Aplicar el piso acá cobraría
   *     $10.000, es decir, regalaría medio metro en cada línea.
   *
   * Con escala 1 —todo el catálogo vendido por pieza— devuelve `quantity`
   * intacto y la aritmética queda idéntica a la histórica.
   */
  private toPriceUnits(
    item: ScalableLine,
    scaleByProduct: ReadonlyMap<number, number>,
  ): number {
    const quantity = Number(item.quantity) || 0;
    if (this.isSoldByPresentation(item)) return quantity;
    return resolvePriceUnits(
      quantity,
      scaleByProduct.get(Number(item.product_id)),
    );
  }

  /**
   * Total NETO de una línea en la escala de venta de su producto. Es el mismo
   * contrato que `resolveLineTotal` de `price-unit.util`
   * (`unit_price × quantity / price_unit_quantity`) pero SIN redondear a
   * centavos: el motor redondea una sola vez por agregado (subtotal,
   * applicableTotal, share por línea) y redondear también acá acumularía el
   * error línea a línea.
   */
  private lineTotal(
    item: ScalableLine,
    scaleByProduct: ReadonlyMap<number, number>,
  ): number {
    return Number(item.unit_price) * this.toPriceUnits(item, scaleByProduct);
  }

  async quoteDiscounts(input: PromotionQuoteInput): Promise<PromotionQuoteResult> {
    const now = input.now ?? new Date();
    const items = input.items ?? [];
    // "Lleva 3" cuenta unidades de VENTA, no de stock. Un producto medido en
    // milímetros llega con `quantity = 3000` para 3 metros: sin normalizar, la
    // promoción se dispararía con 3 milímetros de cable.
    //
    // La MISMA escala gobierna el DINERO: `unit_price` es el precio de una
    // unidad de PRECIO (el metro), así que multiplicarlo por la cantidad cruda
    // en unidades de stock inflaría el subtotal por N. Ver `toPriceUnits` para
    // por qué el dinero no puede usar el piso que sí usa la cantidad.
    const saleUnitScale = await this.resolveSaleUnitScales(items);
    const customerId = input.customer_id ?? null;
    const manualIds = Array.from(new Set(input.manual_promotion_ids ?? []));

    const subtotal = this.roundMoney(
      items.reduce((sum, item) => sum + this.lineTotal(item, saleUnitScale), 0),
    );

    // Initialize item breakdown — even if no promotions apply we return a
    // populated breakdown so consumers can rely on the shape unconditionally.
    const itemBreakdownMap = new Map<number, PromotionQuoteItemBreakdown>();
    items.forEach((item, index) => {
      const originalUnitPrice = Number(item.unit_price);
      const quantity = Number(item.quantity);
      // `quantity` se reporta CRUDO (en unidades de stock) porque es la
      // cantidad que la orden persiste; el multiplicador del dinero va en
      // unidades de precio. Los dos números coinciden salvo en productos con
      // escala.
      const priceUnits = this.toPriceUnits(item, saleUnitScale);
      itemBreakdownMap.set(index, {
        line_id: item.line_id,
        product_id: Number(item.product_id),
        variant_id: item.variant_id ?? null,
        quantity,
        original_unit_price: this.roundMoney(originalUnitPrice),
        promotion_discount: 0,
        final_unit_price: this.roundMoney(originalUnitPrice),
        final_line_total: this.roundMoney(originalUnitPrice * priceUnits),
        promotion_ids: [],
      });
    });

    // Fetch store_settings to read the promotion evaluation strategy and guards
    const settingsRow = await this.prisma.store_settings?.findFirst?.({
      select: { settings: true },
    });
    const rawPromoSettings = (settingsRow?.settings as any)?.promotions;
    const strategy: 'winner_takes_all' | 'stacking_groups' =
      input.strategy ??
      rawPromoSettings?.evaluation_strategy ??
      'winner_takes_all';
    // [PROMO-DEBUG] Temporary diagnostic — remove after bug fix is verified.
    // eslint-disable-next-line no-console
    console.log(
      '[PROMO-DEBUG]',
      JSON.stringify({
        hasSettingsRow: settingsRow !== undefined && settingsRow !== null,
        hasPromotionsKey: rawPromoSettings !== undefined,
        rawEvaluationStrategy: rawPromoSettings?.evaluation_strategy ?? null,
        maxCombinedDiscountPercent: rawPromoSettings?.max_combined_discount_percentage ?? null,
        allowOrderPromoStacking: rawPromoSettings?.allow_order_promo_stacking ?? null,
        inputStrategy: input.strategy ?? null,
        resolvedStrategy: strategy,
      }),
    );
    const maxCombinedDiscountPercent =
      rawPromoSettings?.max_combined_discount_percentage != null
        ? Number(rawPromoSettings.max_combined_discount_percentage)
        : null;
    const allowOrderPromoStacking =
      rawPromoSettings?.allow_order_promo_stacking !== false;
    const excludeTierPricedLines =
      rawPromoSettings?.exclude_tier_priced_lines === true;

    if (items.length === 0) {
      return {
        subtotal: 0,
        total_discount: 0,
        promotional_subtotal: 0,
        strategy_applied: strategy,
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
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    })) as unknown as PromotionRecord[];

    // CP-ECOM-PROMO-UX-001 convergence-R5-N+1: batch per-customer usage
    // counts via a single `groupBy` instead of issuing one `count` per
    // candidate promo.
    const customerUsageByPromotion = new Map<number, number>();
    const candidateIds = candidates.map((c) => Number(c.id));
    if (customerId && candidateIds.length > 0) {
      const rows = await this.prisma.order_promotions.groupBy({
        by: ['promotion_id'],
        where: {
          promotion_id: { in: candidateIds },
          customer_id: customerId,
        },
        _count: { _all: true },
      });
      for (const row of rows) {
        customerUsageByPromotion.set(
          Number(row.promotion_id),
          Number(row._count._all),
        );
      }
    }

    // Evaluate all candidates against current items
    const evaluatedCandidates: Array<{
      promo: PromotionRecord;
      applicableIndexes: number[];
      chargedIndexes: number[];
      discountAmount: number;
      perLineShares: Map<number, number>;
      matchedTierValue?: number;
    }> = [];

    for (const promo of candidates) {
      const isManual = !promo.is_auto_apply;
      if (isManual && !manualIds.includes(promo.id)) continue;
      if (promo.usage_limit && promo.usage_count >= promo.usage_limit) continue;
      if (promo.per_customer_limit && customerId) {
        const customerUsage = customerUsageByPromotion.get(promo.id) ?? 0;
        if (customerUsage >= promo.per_customer_limit) continue;
      }

      let applicableIndexes = this.resolveApplicableItemIndexes(promo, items);
      if (excludeTierPricedLines && promo.scope !== 'order') {
        applicableIndexes = applicableIndexes.filter(
          (idx) => !(Number(items[idx].applied_price_tier_id) > 0),
        );
      }
      if (applicableIndexes.length === 0) continue;

      const applicableTotal = this.roundMoney(
        applicableIndexes.reduce(
          (sum, idx) => sum + this.lineTotal(items[idx], saleUnitScale),
          0,
        ),
      );
      if (applicableTotal <= 0) continue;

      if (
        promo.min_purchase_amount &&
        subtotal < Number(promo.min_purchase_amount)
      ) {
        continue;
      }

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

        const grouping = promo.quantity_grouping ?? 'cart_total';
        let matchedTier: (typeof tiers)[number] | undefined;
        let scopedQty = 0;
        let tierIndexes = applicableIndexes;
        let tierTotal = applicableTotal;

        if (grouping === 'per_product') {
          const byProduct = new Map<number, number>();
          for (const idx of applicableIndexes) {
            const pid = Number(items[idx].product_id);
            byProduct.set(
              pid,
              (byProduct.get(pid) ?? 0) +
                this.toSaleUnits(items[idx], saleUnitScale),
            );
          }
          const tierByProduct = new Map<number, (typeof tiers)[number]>();
          for (const [pid, qty] of byProduct.entries()) {
            const candidate = tiers.find(
              (t) =>
                t.min_quantity <= qty &&
                (t.max_quantity === null || t.max_quantity >= qty),
            );
            if (!candidate) continue;
            tierByProduct.set(pid, candidate);
            if (!matchedTier || Number(candidate.value) > Number(matchedTier.value)) {
              matchedTier = candidate;
              scopedQty = qty;
            }
          }

          if (matchedTier) {
            const winningTierId = matchedTier.id;
            const qualifyingPids = new Set(
              Array.from(tierByProduct.entries())
                .filter(([, t]) => t.id === winningTierId)
                .map(([pid]) => pid),
            );
            tierIndexes = applicableIndexes.filter((idx) =>
              qualifyingPids.has(Number(items[idx].product_id)),
            );
            tierTotal = this.roundMoney(
              tierIndexes.reduce(
                (sum, idx) => sum + this.lineTotal(items[idx], saleUnitScale),
                0,
              ),
            );
          }
        } else {
          scopedQty = applicableIndexes.reduce(
            (sum, idx) => sum + this.toSaleUnits(items[idx], saleUnitScale),
            0,
          );
          matchedTier = tiers.find(
            (t) =>
              t.min_quantity <= scopedQty &&
              (t.max_quantity === null || t.max_quantity >= scopedQty),
          );
        }

        if (!matchedTier) continue;
        if (tierIndexes.length === 0 || tierTotal <= 0) continue;

        const perLineShares = new Map<number, number>();
        let rawTotal = 0;
        for (const idx of tierIndexes) {
          const item = items[idx];
          const lineDiscount = this.computeTierDiscountForResolvedTier(
            Number(item.unit_price),
            this.toPriceUnits(item, saleUnitScale),
            matchedTier,
            tierTotal,
          );
          perLineShares.set(idx, lineDiscount);
          rawTotal = this.roundMoney(rawTotal + lineDiscount);
        }

        if (rawTotal <= 0) continue;

        let discountAmount = rawTotal;
        const maxDiscount = Number(promo.max_discount_amount);
        if (Number.isFinite(maxDiscount) && maxDiscount > 0) {
          discountAmount = Math.min(discountAmount, maxDiscount);
        }
        discountAmount = Math.min(discountAmount, tierTotal);
        discountAmount = this.roundMoney(discountAmount);
        if (discountAmount <= 0) continue;

        const scale = rawTotal > 0 ? discountAmount / rawTotal : 0;
        let assigned = 0;
        for (let i = 0; i < tierIndexes.length; i++) {
          const idx = tierIndexes[i];
          const isLast = i === tierIndexes.length - 1;
          const rawShare = perLineShares.get(idx) ?? 0;
          const proportionalShare = this.roundMoney(rawShare * scale);
          const share = isLast
            ? this.roundMoney(discountAmount - assigned)
            : proportionalShare;
          perLineShares.set(idx, share);
          assigned = this.roundMoney(assigned + share);
        }

        evaluatedCandidates.push({
          promo,
          applicableIndexes,
          chargedIndexes: tierIndexes,
          discountAmount,
          perLineShares,
          matchedTierValue: Number(matchedTier.value),
        });
      } else {
        // Flat promotion branch
        const discountAmount = this.computeDiscountAmount(
          promo,
          applicableTotal,
        );
        if (discountAmount <= 0) continue;

        const perLineShares = new Map<number, number>();
        let assigned = 0;
        for (let i = 0; i < applicableIndexes.length; i++) {
          const idx = applicableIndexes[i];
          const item = items[idx];
          const lineTotal = this.lineTotal(item, saleUnitScale);
          const isLast = i === applicableIndexes.length - 1;
          const share = isLast
            ? this.roundMoney(discountAmount - assigned)
            : this.roundMoney((lineTotal / applicableTotal) * discountAmount);
          perLineShares.set(idx, share);
          assigned = this.roundMoney(assigned + share);
        }

        evaluatedCandidates.push({
          promo,
          applicableIndexes,
          chargedIndexes: applicableIndexes,
          discountAmount,
          perLineShares,
        });
      }
    }

    // Determine final applied promotions based on configured strategy
    const winningPromotions: Array<{
      promo: PromotionRecord;
      applicableIndexes: number[];
      discountAmount: number;
      perLineShares: Map<number, number>;
      matchedTierValue?: number;
    }> = [];

    if (strategy === 'winner_takes_all') {
      let winner: (typeof evaluatedCandidates)[number] | null = null;
      for (const candidate of evaluatedCandidates) {
        if (
          winner === null ||
          candidate.promo.priority < winner.promo.priority ||
          (candidate.promo.priority === winner.promo.priority &&
            candidate.promo.id < winner.promo.id)
        ) {
          winner = candidate;
        }
      }
      if (winner) {
        winningPromotions.push({
          promo: winner.promo,
          applicableIndexes: winner.chargedIndexes ?? winner.applicableIndexes,
          discountAmount: winner.discountAmount,
          perLineShares: winner.perLineShares,
          matchedTierValue: winner.matchedTierValue,
        });
      }
    } else {
      // ---------------------------------------------------------------
      // STACKING GROUPS strategy:
      // 1. Separate item/category promos from order-level promos.
      // 2. For each line, assign at most ONE item/category promo (highest priority).
      // 3. Recompute each item promo's share on its won lines.
      // 4. If allowed, apply the best order-level promo over residual subtotal.
      // ---------------------------------------------------------------
      const itemCandidates = evaluatedCandidates.filter(
        (c) => c.promo.scope === 'product' || c.promo.scope === 'category',
      );
      const orderCandidates = evaluatedCandidates.filter(
        (c) => c.promo.scope === 'order',
      );

      // Line assignment: lineIndex -> winning item candidate
      const lineWinnerMap = new Map<
        number,
        (typeof evaluatedCandidates)[number]
      >();
      for (const candidate of itemCandidates) {
        for (const lineIdx of candidate.chargedIndexes) {
          const existing = lineWinnerMap.get(lineIdx);
          if (!existing) {
            lineWinnerMap.set(lineIdx, candidate);
          } else {
            // Conflict resolution on same line: lower priority wins. Tiebreak: higher line discount, then lower promo.id
            const existingShare = existing.perLineShares.get(lineIdx) ?? 0;
            const currentShare = candidate.perLineShares.get(lineIdx) ?? 0;
            if (
              candidate.promo.priority < existing.promo.priority ||
              (candidate.promo.priority === existing.promo.priority &&
                currentShare > existingShare) ||
              (candidate.promo.priority === existing.promo.priority &&
                currentShare === existingShare &&
                candidate.promo.id < existing.promo.id)
            ) {
              lineWinnerMap.set(lineIdx, candidate);
            }
          }
        }
      }

      // Group won lines by candidate promo
      const wonLinesByPromo = new Map<number, number[]>();
      for (const [lineIdx, candidate] of lineWinnerMap.entries()) {
        const list = wonLinesByPromo.get(candidate.promo.id) ?? [];
        list.push(lineIdx);
        wonLinesByPromo.set(candidate.promo.id, list);
      }

      // Build item-level winners
      for (const candidate of itemCandidates) {
        const wonLines = wonLinesByPromo.get(candidate.promo.id);
        if (!wonLines || wonLines.length === 0) continue;

        let promoRawTotal = 0;
        const perLineShares = new Map<number, number>();
        for (const lineIdx of wonLines) {
          const share = candidate.perLineShares.get(lineIdx) ?? 0;
          perLineShares.set(lineIdx, share);
          promoRawTotal = this.roundMoney(promoRawTotal + share);
        }

        if (promoRawTotal <= 0) continue;

        let promoDiscount = promoRawTotal;
        const maxDiscount = Number(candidate.promo.max_discount_amount);
        if (Number.isFinite(maxDiscount) && maxDiscount > 0) {
          promoDiscount = Math.min(promoDiscount, maxDiscount);
        }
        promoDiscount = this.roundMoney(promoDiscount);

        if (promoDiscount < promoRawTotal) {
          const scale = promoRawTotal > 0 ? promoDiscount / promoRawTotal : 0;
          let assigned = 0;
          for (let i = 0; i < wonLines.length; i++) {
            const lineIdx = wonLines[i];
            const isLast = i === wonLines.length - 1;
            const rawShare = perLineShares.get(lineIdx) ?? 0;
            const share = isLast
              ? this.roundMoney(promoDiscount - assigned)
              : this.roundMoney(rawShare * scale);
            perLineShares.set(lineIdx, share);
            assigned = this.roundMoney(assigned + share);
          }
        }

        winningPromotions.push({
          promo: candidate.promo,
          applicableIndexes: wonLines,
          discountAmount: promoDiscount,
          perLineShares,
          matchedTierValue: candidate.matchedTierValue,
        });
      }

      // Order-level promotion evaluation in stacking mode
      if (
        orderCandidates.length > 0 &&
        (allowOrderPromoStacking || winningPromotions.length === 0)
      ) {
        orderCandidates.sort((a, b) => {
          if (a.promo.priority !== b.promo.priority)
            return a.promo.priority - b.promo.priority;
          return a.promo.id - b.promo.id;
        });

        const bestOrderCandidate = orderCandidates[0];
        const itemDiscountsSum = winningPromotions.reduce(
          (sum, p) => sum + p.discountAmount,
          0,
        );
        const residualSubtotal = this.roundMoney(
          Math.max(0, subtotal - itemDiscountsSum),
        );

        if (residualSubtotal > 0) {
          let orderDiscount = 0;
          if (bestOrderCandidate.promo.type === 'percentage') {
            orderDiscount = this.roundMoney(
              residualSubtotal * (Number(bestOrderCandidate.promo.value) / 100),
            );
          } else {
            orderDiscount = Math.min(
              Number(bestOrderCandidate.promo.value),
              residualSubtotal,
            );
          }

          const maxOrderDiscount = Number(
            bestOrderCandidate.promo.max_discount_amount,
          );
          if (Number.isFinite(maxOrderDiscount) && maxOrderDiscount > 0) {
            orderDiscount = Math.min(orderDiscount, maxOrderDiscount);
          }
          orderDiscount = this.roundMoney(orderDiscount);

          if (orderDiscount > 0) {
            const orderLineShares = new Map<number, number>();
            let assigned = 0;
            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const lineTotal = this.lineTotal(item, saleUnitScale);
              const isLast = i === items.length - 1;
              const share = isLast
                ? this.roundMoney(orderDiscount - assigned)
                : this.roundMoney(
                    (lineTotal / subtotal) * orderDiscount,
                  );
              orderLineShares.set(i, share);
              assigned = this.roundMoney(assigned + share);
            }

            winningPromotions.push({
              promo: bestOrderCandidate.promo,
              applicableIndexes:
                bestOrderCandidate.chargedIndexes ??
                bestOrderCandidate.applicableIndexes,
              discountAmount: orderDiscount,
              perLineShares: orderLineShares,
              matchedTierValue: bestOrderCandidate.matchedTierValue,
            });
          }
        }
      }
    }

    // Global combined discount cap enforcement (when max_combined_discount_percentage is configured)
    if (maxCombinedDiscountPercent !== null && maxCombinedDiscountPercent > 0) {
      const totalDiscountBeforeCap = winningPromotions.reduce(
        (sum, p) => sum + p.discountAmount,
        0,
      );
      const maxAllowedDiscount = this.roundMoney(
        subtotal *
          (Math.min(90, Math.max(1, maxCombinedDiscountPercent)) / 100),
      );

      if (
        totalDiscountBeforeCap > maxAllowedDiscount &&
        maxAllowedDiscount > 0
      ) {
        const globalScale = maxAllowedDiscount / totalDiscountBeforeCap;
        let assignedPromoTotal = 0;

        for (let i = 0; i < winningPromotions.length; i++) {
          const wp = winningPromotions[i];
          const isLast = i === winningPromotions.length - 1;
          const scaledAmount = isLast
            ? this.roundMoney(maxAllowedDiscount - assignedPromoTotal)
            : this.roundMoney(wp.discountAmount * globalScale);
          assignedPromoTotal = this.roundMoney(
            assignedPromoTotal + scaledAmount,
          );

          const promoLineScale =
            wp.discountAmount > 0 ? scaledAmount / wp.discountAmount : 0;
          let assignedLineTotal = 0;
          const lineEntries = Array.from(wp.perLineShares.entries());

          for (let j = 0; j < lineEntries.length; j++) {
            const [lineIdx, share] = lineEntries[j];
            const isLastLine = j === lineEntries.length - 1;
            const scaledShare = isLastLine
              ? this.roundMoney(scaledAmount - assignedLineTotal)
              : this.roundMoney(share * promoLineScale);
            wp.perLineShares.set(lineIdx, scaledShare);
            assignedLineTotal = this.roundMoney(
              assignedLineTotal + scaledShare,
            );
          }

          wp.discountAmount = scaledAmount;
        }
      }
    }

    // Apply winning promotions to itemBreakdownMap
    const appliedPromotions: PromotionQuoteApplied[] = [];
    for (const wp of winningPromotions) {
      for (const [idx, share] of wp.perLineShares.entries()) {
        const current = itemBreakdownMap.get(idx);
        if (!current) continue;
        const item = items[idx];
        const priceUnits = this.toPriceUnits(item, saleUnitScale);
        const lineTotal = Number(item.unit_price) * priceUnits;

        const accumulatedDiscount = this.roundMoney(
          current.promotion_discount + share,
        );
        const cappedDiscount = Math.min(accumulatedDiscount, lineTotal);
        const remainingLineTotal = this.roundMoney(lineTotal - cappedDiscount);
        const nextUnitPrice =
          priceUnits > 0
            ? this.roundMoney(remainingLineTotal / priceUnits)
            : current.original_unit_price;

        itemBreakdownMap.set(idx, {
          ...current,
          promotion_discount: cappedDiscount,
          final_unit_price: Math.max(0, nextUnitPrice),
          final_line_total: Math.max(0, remainingLineTotal),
          promotion_ids: current.promotion_ids.includes(wp.promo.id)
            ? current.promotion_ids
            : [...current.promotion_ids, wp.promo.id],
        });
      }

      appliedPromotions.push({
        promotion_id: wp.promo.id,
        name: wp.promo.name,
        code: wp.promo.code ?? null,
        type: wp.promo.type,
        scope: wp.promo.scope,
        value: wp.matchedTierValue != null ? wp.matchedTierValue : Number(wp.promo.value),
        is_auto_apply: wp.promo.is_auto_apply,
        priority: wp.promo.priority,
        discount_amount: this.roundMoney(wp.discountAmount),
        applicable_item_ids: wp.applicableIndexes
          .map((idx) => itemBreakdownMap.get(idx)?.line_id)
          .filter((lineId): lineId is string | number => lineId !== undefined),
        target_product_ids:
          (wp.promo.quantity_grouping ?? 'cart_total') === 'per_product'
            ? Array.from(
                new Set(
                  wp.applicableIndexes.map((idx) =>
                    Number(items[idx].product_id),
                  ),
                ),
              )
            : [],
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

    const tierProgress = this.buildTierProgress(
      candidates,
      items,
      saleUnitScale,
      appliedPromotions.length === 1 && strategy === 'winner_takes_all'
        ? candidates.find((c) => c.id === appliedPromotions[0].promotion_id) ??
            null
        : null,
    );

    return {
      subtotal,
      total_discount: totalDiscount,
      promotional_subtotal: promotionalSubtotal,
      strategy_applied: strategy,
      applied_promotions: appliedPromotions,
      items: itemBreakdown,
      order_promotions_snapshot: snapshot,
      tier_progress: tierProgress,
    };
  }

  /**
   * Per-product tier ladder for promotions that touched the current cart.
   *
   * Returns one entry per `(promotion_id, target_product_id)` for every
   * `quantity_tiered` promotion in `promotionIds` whose target product is
   * listed in that promotion's `promotion_products` mapping. `tiers` is the
   * FULL ladder (ordered by `min_quantity` ASC, secondary by `sort_order`,
   * final tie-break by tier id), and `current_tier_index` reflects how many
   * units of THAT product are already in the cart — the last tier whose
   * `min_quantity <= quantity` wins (`null` when quantity is below the
   * first threshold).
   *
   * Pure READ — no discount math, no DB writes. Powers the per-product
   * tier-ladder UI (`Lleva 3 → -10% · Lleva 6 → -15% …`) so consumers can
   * render the full ladder next to each cart line without re-querying
   * `promotion_quantity_tiers`. Mirrors `ActiveProductPromotion.quantity_tiers`
   * (same `QuantityTierSummary` rows, same ordering) so the rendering code
   * stays symmetric with the product card surface.
   *
   * `perProductQuantity` is optional: when omitted, the engine aggregates
   * `quantity` from `cartItems` per `product_id` to build the per-product
   * map. Callers that already aggregate quantities (e.g. via the engine's
   * `toSaleUnits`) can pass a precomputed Map to skip the re-aggregation.
   *
   * Promotions whose `promotion_products` is empty (scope='order' /
   * scope='category') produce NO entries — they have no single
   * `target_product_id`. Callers that want a single ladder for those promos
   * can query `ActiveProductPromotion.quantity_tiers` directly.
   *
   * Resilience: errors from the DB read bubble up; callers are expected to
   * `try/catch` and degrade silently (the cart view must keep serving 200s
   * without the ladder field — same policy as `quoteDiscounts`).
   */
  async getTierLaddersForQuote(
    promotionIds: number[],
    cartItems: Array<{
      product_id: number;
      quantity: number;
      stock_units_consumed?: number | null;
    }>,
    perProductQuantity?: Map<number, number>,
  ): Promise<
    Array<{
      promotion_id: number;
      target_product_id: number;
      tiers: QuantityTierSummary[];
      current_tier_index: number | null;
    }>
  > {
    const ids = Array.from(
      new Set((promotionIds ?? []).map((id) => Number(id))),
    ).filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) return [];

    // One batched query through `promotions` (the model that owns the store
    // scope + the relations we need): tiers ordered by `min_quantity` ASC
    // (the same ordering the engine uses internally for tier resolution),
    // plus the promotion's `promotion_products` mapping so we know which
    // `product_id`s each promotion targets. We read via `promotions` rather
    // than `promotion_quantity_tiers` directly because `StorePrismaService`
    // doesn't expose a scoped getter for the tier model — its sole
    // cross-store query surface is the promotions relation here.
    const promoRows = (await this.prisma.promotions.findMany({
      where: { id: { in: ids } },
      include: {
        promotion_quantity_tiers: {
          orderBy: [
            { min_quantity: 'asc' },
            { sort_order: 'asc' },
            { id: 'asc' },
          ],
        },
        promotion_products: { select: { product_id: true } },
      },
    })) as unknown as Array<{
      id: number;
      promotion_quantity_tiers?: Array<{
        id: number;
        promotion_id: number;
        min_quantity: number;
        max_quantity: number | null;
        type: PromotionQuoteType;
        value: unknown;
        sort_order: number;
      }>;
      promotion_products?: Array<{ product_id: number | string }>;
    }>;

    // Per-product quantity: build from `cartItems` when the caller didn't
    // pass an aggregated map. Sum across lines of the same product — same
    // summation the engine does for `per_product` grouping in
    // `quoteDiscounts`.
    const quantityByProduct = new Map<number, number>();
    if (perProductQuantity) {
      for (const [pid, qty] of perProductQuantity.entries()) {
        const n = Number(pid);
        const q = Number(qty);
        if (Number.isFinite(n) && Number.isFinite(q) && q > 0) {
          quantityByProduct.set(n, (quantityByProduct.get(n) ?? 0) + q);
        }
      }
    } else {
      for (const item of cartItems ?? []) {
        const pid = Number(item?.product_id);
        const qty = Number(item?.quantity) || 0;
        if (!Number.isFinite(pid)) continue;
        if (qty <= 0) continue;
        const stockUnits = Number(item?.stock_units_consumed);
        const effectiveUnits =
          Number.isFinite(stockUnits) && stockUnits > 0 ? stockUnits : qty;
        quantityByProduct.set(
          pid,
          (quantityByProduct.get(pid) ?? 0) + effectiveUnits,
        );
      }
    }

    // Group tier rows per promotion so we emit one ladder per (promo,
    // target_product_id). `targetProductIds` is de-duplicated so a product
    // linked to the same promotion by multiple rows still appears once.
    const ladderByPromo = new Map<
      number,
      { tiers: QuantityTierSummary[]; targetProductIds: number[] }
    >();
    for (const promo of promoRows) {
      const promotionId = Number(promo.id);
      const tiers = promo.promotion_quantity_tiers ?? [];
      if (tiers.length === 0) continue;
      const bucket: { tiers: QuantityTierSummary[]; targetProductIds: number[] } =
        {
          tiers: tiers.map((t) => ({
            min_quantity: Number(t.min_quantity),
            max_quantity:
              t.max_quantity === null ? null : Number(t.max_quantity),
            type: t.type,
            value: Number(t.value),
            sort_order: Number(t.sort_order),
          })),
          targetProductIds: [],
        };
      for (const pp of promo.promotion_products ?? []) {
        const targetProductId = Number(pp.product_id);
        if (!Number.isFinite(targetProductId)) continue;
        if (!bucket.targetProductIds.includes(targetProductId)) {
          bucket.targetProductIds.push(targetProductId);
        }
      }
      ladderByPromo.set(promotionId, bucket);
    }

    const result: Array<{
      promotion_id: number;
      target_product_id: number;
      tiers: QuantityTierSummary[];
      current_tier_index: number | null;
    }> = [];
    for (const [promotionId, bucket] of ladderByPromo.entries()) {
      if (bucket.tiers.length === 0) continue;
      if (bucket.targetProductIds.length === 0) continue;
      for (const targetProductId of bucket.targetProductIds) {
        const quantity = quantityByProduct.get(targetProductId) ?? 0;
        result.push({
          promotion_id: promotionId,
          target_product_id: targetProductId,
          tiers: bucket.tiers,
          current_tier_index: this.resolveCurrentTierIndex(
            bucket.tiers,
            quantity,
          ),
        });
      }
    }
    return result;
  }

  /**
   * Index of the highest tier whose `min_quantity <= quantity`.
   * `null` when quantity is below the first threshold. Returns
   * `tiers.length - 1` when quantity crosses the top tier (since tiers are
   * ordered ASC by `min_quantity`, the top one is still "the last whose
   * `min_quantity <= quantity`").
   */
  private resolveCurrentTierIndex(
    tiers: QuantityTierSummary[],
    quantity: number,
  ): number | null {
    if (!tiers || tiers.length === 0) return null;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return tiers[0].min_quantity <= 0 ? 0 : null;
    }
    let idx = -1;
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i].min_quantity <= quantity) idx = i;
      else break;
    }
    return idx >= 0 ? idx : null;
  }

  /**
   * Compute the "next tier" nudge for auto-apply `quantity_tiered` promotions.
   * Pure READ over the candidate promotions + cart items: reuses the SAME scope
   * resolver (`resolveApplicableItemIndexes`) and tier ordering as the discount
   * branch, and performs NO discount math. Structured mirror of the POS-only
   * frontend helper `getPromotionTierProgress` so POS and ecommerce nudge
   * identically. Returns one entry per promo that already has items in scope AND
   * a next tier reachable above the current aggregated scope quantity AND that
   * could actually win the winner-takes-all comparison (see `appliedPromo`).
   *
   * @param appliedPromo the promo currently winning (null if none applies).
   *   Promos do NOT stack, so this is required to keep the nudge honest.
   */
  private buildTierProgress(
    candidatePromos: PromotionRecord[],
    items: PromotionQuoteItemInput[],
    scaleByProduct: ReadonlyMap<number, number>,
    appliedPromo: PromotionRecord | null = null,
  ): PromotionTierProgress[] {
    const progress: PromotionTierProgress[] = [];

    for (const promo of candidatePromos ?? []) {
      // Only auto-apply quantity_tiered promos surface a nudge.
      if (!promo?.is_auto_apply) continue;
      if (promo.rule_type !== 'quantity_tiered') continue;

      // Since only ONE promo can apply, a nudge is honest only if reaching the
      // tier would actually change what the customer is charged. A promo that
      // loses the priority comparison against the promo already applying can
      // never take over by adding quantity, so advertising "add 2 more for
      // -15%" would make the customer add product for nothing. Back when
      // promos stacked every nudge was reachable; winner-takes-all broke that
      // assumption. Same comparison as the winner loop above: lower priority
      // number wins, ties go to the lower id.
      if (
        appliedPromo &&
        promo.id !== appliedPromo.id &&
        !(
          promo.priority < appliedPromo.priority ||
          (promo.priority === appliedPromo.priority &&
            promo.id < appliedPromo.id)
        )
      )
        continue;

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

      // Same scope resolver as the discount branch so the nudge and the
      // applied discount always agree on scope.
      const applicableIndexes = this.resolveApplicableItemIndexes(promo, items);
      if (applicableIndexes.length === 0) continue;

      const grouping = promo.quantity_grouping ?? 'cart_total';
      let nextTier: (typeof tiers)[number] | undefined;
      let remaining = 0;
      /**
       * `product_id` of the cart line(s) that are closest to qualifying for
       * the next tier. Only meaningful when `grouping === 'per_product'` —
       * in `cart_total` the scope crosses products so the nudge refers to
       * "the cart" as a whole, not a single SKU. The frontend uses this to
       * render "Agrega 1 und más de '<nombre>'" instead of a generic line.
       */
      let targetProductId: number | null = null;

      if (grouping === 'per_product') {
        // For each product in scope, find its current per-product qty and
        // the smallest unmet tier for that product. The nudge shown is for
        // the product closest to qualifying (smallest remaining gap).
        for (const idx of applicableIndexes) {
          const pid = Number(items[idx].product_id);
          // Sum qty for this product across all its lines in cart.
          // Misma vara que el tramo que dispara el descuento: unidades de
          // VENTA. Contar en unidades de stock haría que el empujón dijera
          // "agrega 997 más" para un cable al que le falta un metro.
          const perProductQty = applicableIndexes
            .filter((i) => Number(items[i].product_id) === pid)
            .reduce((s, i) => s + this.toSaleUnits(items[i], scaleByProduct), 0);
          if (perProductQty <= 0) continue;
          const candidate = tiers.find((t) => t.min_quantity > perProductQty);
          if (!candidate) continue;
          const gap = candidate.min_quantity - perProductQty;
          if (gap <= 0) continue;
          if (!nextTier || gap < remaining) {
            nextTier = candidate;
            remaining = gap;
            targetProductId = pid;
          }
        }
      } else {
        // cart_total (legacy): sum across every applicable line.
        const scopedQty = applicableIndexes.reduce(
          (sum, idx) => sum + this.toSaleUnits(items[idx], scaleByProduct),
          0,
        );
        if (scopedQty <= 0) continue;
        nextTier = tiers.find((t) => t.min_quantity > scopedQty);
        if (!nextTier) continue;
        remaining = nextTier.min_quantity - scopedQty;
      }

      if (!nextTier || remaining <= 0) continue;
      if (!Number.isFinite(remaining)) continue;

      progress.push({
        promotion_id: Number(promo.id),
        name: String(promo.name ?? ''),
        remaining_quantity: remaining,
        benefit_type: nextTier.type,
        benefit_value: Number(nextTier.value),
        target_product_id: targetProductId,
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
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
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
      // Promotions are pre-ordered by (priority asc, id asc) — lowest priority
      // number first, oldest promo first. The `rank >` comparison below is
      // strict, so on an exact rank tie the FIRST promo iterated wins, which
      // makes the oldest promo win. That matches the explicit `id <` tie-break
      // in quoteDiscounts and getEligiblePromotions, so the product-card badge
      // and the cart/POS quote never disagree on which promo applies.
      // Among equal priorities, prefer scope=product over scope=category for
      // clearer UX.
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

        // LOWER priority number wins (consistent with quoteDiscounts — priority
        // 1 is the "first" promo to apply, like a priority queue). Inverted
        // into a "rank" so the existing `rank > chosen.rank` comparison still
        // picks the higher-priority promo. Among equal priorities, product
        // scope beats category scope for clearer UX.
        const rank =
          (1000 - (promo.priority ?? 0)) * 10 +
          (promo.scope === 'product' ? 1 : 0);
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
        // ERR-01 defensive guard: a `quantity_tiered` promo with ZERO rows is
        // not eligible — there is no tier to fire, and falling through to the
        // flat branch below would advertise a phantom discount. Mirrors the
        // exact guard already used by `quoteDiscounts` and `buildTierProgress`.
        if (tiers.length === 0) continue;
        const firstTier = tiers[0];
        if (!firstTier) continue;
        const tierValue = Number(firstTier.value);
        if (!Number.isFinite(tierValue) || tierValue <= 0) continue;

        const previewMinDiscount =
          firstTier.type === 'percentage'
            ? this.roundMoney((unitPrice * tierValue) / 100)
            : this.roundMoney(tierValue);

        // Emit the FULL tier ladder so the frontend can render every step
        // ("Lleva 3 → -10% · Lleva 6 → -15%") without re-querying. `value` is
        // coerced from the DB's `unknown` (Decimal) to a plain `number`; tier
        // `type` is narrowed to the strict literal union declared by
        // `QuantityTierSummary`. Ordering matches the sort above so consumers
        // never need to re-sort.
        const quantityTiers: QuantityTierSummary[] = tiers.map((t) => ({
          min_quantity: Number(t.min_quantity),
          max_quantity: t.max_quantity === null ? null : Number(t.max_quantity),
          type: t.type,
          value: Number(t.value),
          sort_order: Number(t.sort_order),
        }));

        result.set(productId, {
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
          is_quantity_tiered: true,
          preview_min_discount: previewMinDiscount,
          quantity_tiers: quantityTiers,
        });
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
        // Flat promo: always emit an EMPTY array (NOT `undefined`) so the
        // shape is symmetric with `quantity_tiered` rows. Consumers can
        // iterate `entry.quantity_tiers ?? []` unconditionally; the field is
        // also a reliable discriminator for "this promo has no tier ladder".
        quantity_tiers: [],
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
   * rounded to 2 decimals. Returns 0 when guards fail (priceUnits <= 0,
   * unitPrice <= 0, tier.value <= 0, or, for fixed_amount, applicableTotal <= 0).
   *
   * `priceUnits` son unidades de PRECIO, no de stock: el caller ya convirtió la
   * cantidad con `toPriceUnits`, así que `unitPrice × priceUnits` es el total
   * neto real de la línea. Para todo el catálogo sin escala `priceUnits` es la
   * cantidad tal cual y la aritmética no cambia.
   */
  private computeTierDiscountForResolvedTier(
    unitPrice: number,
    priceUnits: number,
    tier: PromotionQuantityTierRecord,
    applicableTotal: number,
  ): number {
    const qty = Number(priceUnits);
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
