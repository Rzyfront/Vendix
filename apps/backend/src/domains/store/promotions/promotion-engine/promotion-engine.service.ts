import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

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

      // Check scope eligibility
      if (promo.scope === 'product') {
        const promoProductIds = promo.promotion_products.map(
          (pp) => pp.product_id,
        );
        const hasEligibleProduct = cartItems.some((item) =>
          promoProductIds.includes(item.product_id),
        );
        if (!hasEligibleProduct) continue;
      }

      if (promo.scope === 'category') {
        // For category scope, we need product category info from the caller
        // If cart items include category_id, we can match; otherwise skip
        const promoCategoryIds = promo.promotion_categories.map(
          (pc) => pc.category_id,
        );
        const hasEligibleCategory = cartItems.some(
          (item) =>
            item.category_id && promoCategoryIds.includes(item.category_id),
        );
        if (!hasEligibleCategory) continue;
      }

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
    let applicableTotal = 0;

    if (promotion.scope === 'product') {
      const promoProductIds =
        promotion.promotion_products?.map((pp: any) => pp.product_id) || [];
      applicableTotal = cartItems
        .filter((item) => promoProductIds.includes(item.product_id))
        .reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    } else {
      applicableTotal = cartItems.reduce(
        (sum, item) => sum + item.unit_price * item.quantity,
        0,
      );
    }

    let discount = 0;
    if (promotion.type === 'percentage') {
      discount = applicableTotal * (Number(promotion.value) / 100);
    } else {
      discount = Math.min(Number(promotion.value), applicableTotal);
    }

    // Apply max_discount_amount cap
    if (promotion.max_discount_amount) {
      discount = Math.min(discount, Number(promotion.max_discount_amount));
    }

    return Math.round(discount * 100) / 100;
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
      },
    });

    if (!promotion) {
      throw new BadRequestException('Promocion no valida o expirada');
    }

    if (promotion.usage_limit && promotion.usage_count >= promotion.usage_limit) {
      throw new BadRequestException(
        'Promocion ha alcanzado su limite de uso',
      );
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

    const discount = this.calculateDiscount(promotion, cartItems);
    return { promotion, discount };
  }
}
