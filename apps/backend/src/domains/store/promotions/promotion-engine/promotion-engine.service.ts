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
}
