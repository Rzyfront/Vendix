import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { EcommerceReviewsService } from './reviews.service';
import {
  CreateOrderProductReviewDto,
  CreateOrderReviewDto,
} from './dto/order-review.dto';

export type OrderReviewRef = { token: string } | { order_id: number };

export type ProductReviewBlockReason =
  | 'not_delivered'
  | 'already_reviewed'
  | 'no_customer'
  | 'reviews_disabled';

export type ResolvedOrder = {
  id: number;
  store_id: number;
  order_number: string;
  state: string;
  customer_id: number | null;
  order_items: Array<{
    product_id: number | null;
    product_name: string;
    products: {
      name: string;
      product_images: Array<{ image_url: string }>;
    } | null;
  }>;
};

const REVIEWABLE_STATES = ['delivered', 'finished'];
const NON_REVIEWABLE_EXPERIENCE_STATES = ['cancelled', 'refunded'];

@Injectable()
export class OrderReviewsService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly reviews_service: EcommerceReviewsService,
    private readonly s3_service: S3Service,
  ) {}

  // ------------------------------------------------------------------
  // Resolución de la orden
  // ------------------------------------------------------------------

  private get orderSelect() {
    return {
      id: true,
      store_id: true,
      order_number: true,
      state: true,
      customer_id: true,
      order_items: {
        where: { cancelled_at: null },
        orderBy: { id: 'asc' as const },
        select: {
          product_id: true,
          product_name: true,
          products: {
            select: {
              name: true,
              product_images: {
                where: { is_main: true },
                take: 1,
                select: { image_url: true },
              },
            },
          },
        },
      },
    } satisfies Prisma.ordersSelect;
  }

  /**
   * Resuelve la orden por token o por id, siempre dentro de la tienda del
   * contexto. Por token no hay sesión: se usa el cliente sin scope con
   * `store_id` explícito. Por id, `orders` ya filtra por store y customer.
   */
  private async resolveOrder(ref: OrderReviewRef) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.ORD_REVIEW_NOT_FOUND);
    }

    let order: any = null;
    if ('token' in ref) {
      const base = this.prisma.withoutScope();
      const request = await base.invoice_data_requests.findFirst({
        where: { token: ref.token, store_id },
        select: { order_id: true },
      });
      if (request) {
        order = await base.orders.findFirst({
          where: { id: request.order_id, store_id },
          select: this.orderSelect,
        });
      }
    } else {
      order = await this.prisma.orders.findFirst({
        where: { id: ref.order_id },
        select: this.orderSelect,
      });
    }

    if (!order) {
      throw new VendixHttpException(ErrorCodes.ORD_REVIEW_NOT_FOUND);
    }
    return order as ResolvedOrder;
  }

  private serializeOrderReview(row: any) {
    return {
      id: row.id,
      order_id: row.order_id,
      rating: row.rating,
      quick_tag: row.quick_tag ?? null,
      comment: row.comment ?? null,
      source: row.source,
      created_at: row.created_at,
    };
  }

  // ------------------------------------------------------------------
  // Status
  // ------------------------------------------------------------------

  private async buildStatus(order: ResolvedOrder) {
    const reviews_enabled = await this.reviews_service.areReviewsEnabled();

    const order_review = await this.prisma.order_reviews.findFirst({
      where: { order_id: order.id },
    });

    // Un item por producto distinto (primer nombre/imagen que aparezca).
    const products = new Map<
      number,
      { name: string; image_key: string | null }
    >();
    for (const item of order.order_items) {
      if (item.product_id == null || products.has(item.product_id)) continue;
      products.set(item.product_id, {
        name: item.products?.name || item.product_name,
        image_key: item.products?.product_images?.[0]?.image_url ?? null,
      });
    }

    const product_ids = [...products.keys()];
    const existing =
      order.customer_id != null && product_ids.length
        ? await this.prisma.reviews.findMany({
            where: {
              user_id: order.customer_id,
              product_id: { in: product_ids },
            },
            select: { id: true, rating: true, state: true, product_id: true },
          })
        : [];
    const existing_by_product = new Map(
      existing.map((r: any) => [r.product_id, r]),
    );

    const items = await Promise.all(
      product_ids.map(async (product_id) => {
        const info = products.get(product_id)!;
        const review = existing_by_product.get(product_id) as any;

        let reason: ProductReviewBlockReason | null = null;
        if (!reviews_enabled) reason = 'reviews_disabled';
        else if (order.customer_id == null) reason = 'no_customer';
        else if (!REVIEWABLE_STATES.includes(order.state))
          reason = 'not_delivered';
        else if (review) reason = 'already_reviewed';

        return {
          product_id,
          product_name: info.name,
          image_url: info.image_key
            ? await this.s3_service.signUrl(info.image_key)
            : null,
          can_review: reason === null,
          reason,
          review: review
            ? { id: review.id, rating: review.rating, state: review.state }
            : null,
        };
      }),
    );

    return {
      order_id: order.id,
      order_number: order.order_number,
      order_state: order.state,
      can_review_experience:
        !order_review &&
        !NON_REVIEWABLE_EXPERIENCE_STATES.includes(order.state),
      order_review: order_review
        ? this.serializeOrderReview(order_review)
        : null,
      items,
    };
  }

  async getStatus(ref: OrderReviewRef) {
    const order = await this.resolveOrder(ref);
    return this.buildStatus(order);
  }

  // ------------------------------------------------------------------
  // Experiencia de compra
  // ------------------------------------------------------------------

  async createExperience(ref: OrderReviewRef, dto: CreateOrderReviewDto) {
    const order = await this.resolveOrder(ref);

    if (NON_REVIEWABLE_EXPERIENCE_STATES.includes(order.state)) {
      throw new VendixHttpException(ErrorCodes.ORD_REVIEW_ORDER_INVALID_STATE);
    }

    const existing = await this.prisma.order_reviews.findFirst({
      where: { order_id: order.id },
      select: { id: true },
    });
    if (existing) {
      throw new VendixHttpException(ErrorCodes.ORD_REVIEW_ALREADY_EXISTS);
    }

    try {
      const created = await this.prisma.order_reviews.create({
        data: {
          store_id: order.store_id,
          order_id: order.id,
          customer_id: order.customer_id,
          rating: dto.rating,
          quick_tag: dto.quick_tag ?? null,
          comment: dto.comment ?? null,
          source: dto.source ?? 'order_detail',
        },
      });
      return this.serializeOrderReview(created);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.ORD_REVIEW_ALREADY_EXISTS);
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------
  // Reseña de producto desde el pedido
  // ------------------------------------------------------------------

  async createProductReview(
    ref: OrderReviewRef,
    dto: CreateOrderProductReviewDto,
  ) {
    const order = await this.resolveOrder(ref);

    const in_order = order.order_items.some(
      (item) => item.product_id === dto.product_id,
    );
    if (!in_order) {
      throw new VendixHttpException(ErrorCodes.ORD_REVIEW_PRODUCT_NOT_IN_ORDER);
    }

    const status = await this.buildStatus(order);
    const item = status.items.find((i) => i.product_id === dto.product_id);
    if (!item || !item.can_review) {
      throw new VendixHttpException(
        ErrorCodes.ORD_REVIEW_PRODUCT_NOT_ALLOWED,
        `No se puede reseñar este producto: ${item?.reason ?? 'not_allowed'}`,
        { reason: item?.reason ?? null },
      );
    }

    const user_id = order.customer_id as number;
    await this.reviews_service.assertDailyLimit(user_id);

    let review;
    try {
      review = await this.prisma.reviews.create({
        data: {
          product_id: dto.product_id,
          user_id,
          rating: dto.rating,
          title: dto.title,
          comment: dto.comment,
          verified_purchase: true,
          order_id: order.id,
          state: 'pending',
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.REV_DUP_001);
      }
      throw error;
    }

    await this.reviews_service.emitReviewCreated({
      store_id: order.store_id,
      review_id: review.id,
      product_id: dto.product_id,
      rating: dto.rating,
      user_id,
    });

    return review;
  }
}
