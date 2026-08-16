import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange } from '../utils/date.util';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class ReviewsAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getReviewsSummary(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    const reviews = await this.prisma.reviews.findMany({
      where: {
        store_id: storeId,
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

    const verifiedPurchases = reviews.filter((r) => r.verified_purchase).length;
    const pendingReviews = reviews.filter((r) => r.state === 'pending').length;
    const approvedReviews = reviews.filter((r) => r.state === 'approved').length;
    const rejectedReviews = reviews.filter((r) => r.state === 'rejected').length;

    const ratingDistribution = {
      1: reviews.filter((r) => r.rating === 1).length,
      2: reviews.filter((r) => r.rating === 2).length,
      3: reviews.filter((r) => r.rating === 3).length,
      4: reviews.filter((r) => r.rating === 4).length,
      5: reviews.filter((r) => r.rating === 5).length,
    };

    const totalHelpfulVotes = reviews.reduce(
      (sum, r) => sum + r.helpful_count,
      0,
    );

    return {
      total_reviews: totalReviews,
      average_rating: Math.round(averageRating * 10) / 10,
      verified_purchases: verifiedPurchases,
      pending_reviews: pendingReviews,
      approved_reviews: approvedReviews,
      rejected_reviews: rejectedReviews,
      rating_distribution: ratingDistribution,
      total_helpful_votes: totalHelpfulVotes,
    };
  }

  async getReviewsForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const tz = await resolveStoreTimezone(this.prisma, context.store_id);
    const { startDate, endDate } = parseDateRange(query, tz);

    const reviews = await this.prisma.reviews.findMany({
      where: {
        store_id: context.store_id,
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        products: {
          select: {
            name: true,
            sku: true,
          },
        },
        users: {
          select: {
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 10000,
    });

    return reviews.map((review) => ({
      Fecha: review.created_at ?? null,
      Producto: review.products?.name || '',
      SKU: review.products?.sku || '',
      Cliente: review.users
        ? `${review.users.first_name || ''} ${review.users.last_name || ''}`.trim()
        : '',
      Email: review.users?.email || '',
      Calificación: review.rating,
      Título: review.title || '',
      Comentario: review.comment,
      Estado: review.state,
      'Compra Verificada': review.verified_purchase ? 'Sí' : 'No',
      'Votos Útiles': review.helpful_count,
    }));
  }

  /**
   * QUI-548: reseñas agregadas por producto. Una fila por producto con:
   * - product_id, name, sku
   * - total_reviews
   * - average_rating (redondeado a 1 decimal para legibilidad)
   * - distribución de estrellas (1..5)
   * - verified_count y pending_count
   * - last_review_date (Date cruda)
   *
   * Ordenado por total_reviews desc. Si un producto no tiene reseñas en
   * el período, NO aparece (es un reporte del período, no del catálogo).
   *
   * NO se filtra por `state`: la columna «Pendientes» del reporte cuenta
   * justamente las que aún no están aprobadas, así que restringir a
   * aprobadas la dejaría en cero en toda fila. Mismo criterio que
   * `getReviewsSummary`, que también agrega sobre todos los estados.
   */
  async getReviewsByProduct(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    const reviews = await this.prisma.reviews.findMany({
      where: {
        store_id: storeId,
        created_at: { gte: startDate, lte: endDate },
        product_id: { not: null },
      },
      include: {
        products: { select: { name: true, sku: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10000,
    });

    const buckets = new Map<
      number,
      {
        product_id: number;
        product_name: string;
        sku: string;
        total_reviews: number;
        rating_sum: number;
        stars_1: number;
        stars_2: number;
        stars_3: number;
        stars_4: number;
        stars_5: number;
        verified_count: number;
        pending_count: number;
        last_review_date: Date | null;
      }
    >();

    for (const r of reviews) {
      const productId = r.product_id as number;
      const bucket = buckets.get(productId) ?? {
        product_id: productId,
        product_name: r.products?.name ?? '',
        sku: r.products?.sku ?? '',
        total_reviews: 0,
        rating_sum: 0,
        stars_1: 0,
        stars_2: 0,
        stars_3: 0,
        stars_4: 0,
        stars_5: 0,
        verified_count: 0,
        pending_count: 0,
        last_review_date: null,
      };
      bucket.total_reviews += 1;
      bucket.rating_sum += r.rating;
      if (r.rating === 1) bucket.stars_1 += 1;
      else if (r.rating === 2) bucket.stars_2 += 1;
      else if (r.rating === 3) bucket.stars_3 += 1;
      else if (r.rating === 4) bucket.stars_4 += 1;
      else if (r.rating === 5) bucket.stars_5 += 1;
      if (r.verified_purchase) bucket.verified_count += 1;
      if (r.state === 'pending') bucket.pending_count += 1;
      if (
        r.created_at &&
        (!bucket.last_review_date || r.created_at > bucket.last_review_date)
      ) {
        bucket.last_review_date = r.created_at;
      }
      buckets.set(productId, bucket);
    }

    return Array.from(buckets.values())
      .map((b) => ({
        product_id: b.product_id,
        product_name: b.product_name,
        sku: b.sku,
        total_reviews: b.total_reviews,
        average_rating:
          b.total_reviews > 0
            ? Math.round((b.rating_sum / b.total_reviews) * 10) / 10
            : 0,
        stars_1: b.stars_1,
        stars_2: b.stars_2,
        stars_3: b.stars_3,
        stars_4: b.stars_4,
        stars_5: b.stars_5,
        verified_count: b.verified_count,
        pending_count: b.pending_count,
        // RAW Date — el emitter la formatea con la TZ de la tienda.
        last_review_date: b.last_review_date,
      }))
      .sort((a, b) => b.total_reviews - a.total_reviews);
  }
}
