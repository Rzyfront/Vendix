import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange, getPreviousPeriod } from '../utils/date.util';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Review state used for the public rating average and the rating histogram.
 *
 * `pending` and `rejected` reviews are EXCLUDED from the customer-facing
 * rating so the admin panel matches the storefront. They are still reported
 * separately as moderation queues.
 *
 * NOTE: this constant is intentionally local to ReviewsAnalyticsService for
 * now. The analytics-metrics.contract doesn't yet export a `REVIEW_*_STATES`
 * constant; promoting it to the contract would be the natural follow-up if a
 * second service ever needs to share this definition (matches the pattern
 * of `REFUND_RECOGNIZED_STATES` for the refunds contract).
 */
const REVIEW_APPROVED_STATE = 'approved';

/**
 * Reviews that are operational moderation queue entries. The contract is
 * implicit: `pending` means awaiting moderator action, `rejected` means the
 * moderator decided not to publish.
 */
const REVIEW_MODERATION_STATES = ['pending', 'rejected'] as const;

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
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    // QUI-629: every aggregate below is computed in DB instead of pulling
    // every review row into memory and calling .filter() ten times. The
    // contract is the source of the "approved" filter (see REVIEW_APPROVED_STATE).
    const [
      approvedAgg,
      totalApprovedInRange,
      pendingCount,
      rejectedCount,
      ratingDist,
      verifiedAgg,
      totalInRange,
      approvedPrev,
      verifiedPrev,
      pendingPrev,
      rejectedPrev,
    ] = await Promise.all([
      // 1. Average rating on approved reviews of the current period.
      this.prisma.reviews.aggregate({
        where: {
          store_id: storeId,
          state: REVIEW_APPROVED_STATE as any,
          created_at: { gte: startDate, lte: endDate },
        },
        _avg: { rating: true },
        _count: { id: true },
      }),
      // 2. Total approved count for the rating distribution.
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: REVIEW_APPROVED_STATE as any,
          created_at: { gte: startDate, lte: endDate },
        },
      }),
      // 3. Moderation queue counters.
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: 'pending' as any,
          created_at: { gte: startDate, lte: endDate },
        },
      }),
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: 'rejected' as any,
          created_at: { gte: startDate, lte: endDate },
        },
      }),
      // 4. Rating distribution on approved reviews via raw groupBy.
      // The store_id raw query is intentional: this is an aggregations-only
      // read on a single table with a covering index, well within the
      // safe direct-DB-access envelope.
      (async () => {
        const rows = await this.prisma.withoutScope().$queryRaw<
          Array<{ rating: number; count: bigint }>
        >(Prisma.sql`
          SELECT rating::int AS rating, COUNT(*) AS count
          FROM reviews
          WHERE store_id = ${storeId}
            AND state = ${REVIEW_APPROVED_STATE}
            AND created_at >= ${startDate}
            AND created_at <= ${endDate}
          GROUP BY rating
          ORDER BY rating ASC
        `);
        const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const r of rows) {
          dist[Number(r.rating)] = Number(r.count);
        }
        return dist;
      })(),
      // 5. Verified-purchase count on the current period (approved only).
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: REVIEW_APPROVED_STATE as any,
          verified_purchase: true,
          created_at: { gte: startDate, lte: endDate },
        },
      }),
      // 6. Total reviews in range (operational counters include all states).
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          created_at: { gte: startDate, lte: endDate },
        },
      }),
      // 7. Previous-period averages for computeGrowth.
      this.prisma.reviews.aggregate({
        where: {
          store_id: storeId,
          state: REVIEW_APPROVED_STATE as any,
          created_at: { gte: previousStartDate, lte: previousEndDate },
        },
        _avg: { rating: true },
        _count: { id: true },
      }),
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: REVIEW_APPROVED_STATE as any,
          verified_purchase: true,
          created_at: { gte: previousStartDate, lte: previousEndDate },
        },
      }),
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: 'pending' as any,
          created_at: { gte: previousStartDate, lte: previousEndDate },
        },
      }),
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          state: 'rejected' as any,
          created_at: { gte: previousStartDate, lte: previousEndDate },
        },
      }),
    ]);

    const averageRatingRaw = Number(approvedAgg._avg.rating || 0);
    const averageRating = Math.round(averageRatingRaw * 10) / 10;
    const previousAverageRatingRaw = Number(approvedPrev._avg.rating || 0);
    const previousAverageRating = Math.round(previousAverageRatingRaw * 10) / 10;

    // Growth: the previous behaviour returned 0 for empty previous periods,
    // which falsely read as "no change". The QUI-377 contract calls for null
    // when the previous base is missing; we emit null and let the UI render
    // 'sin base de comparación'.
    const approvedCount = Number(approvedAgg._count.id || 0);
    const previousApprovedCount = Number(approvedPrev._count.id || 0);
    const averageRatingGrowth =
      previousApprovedCount > 0 && approvedCount > 0
        ? Math.round(
            ((averageRatingRaw - previousAverageRatingRaw) /
              previousAverageRatingRaw) *
              100 *
              10,
          ) / 10
        : null;
    const reviewsGrowth =
      previousApprovedCount > 0
        ? Math.round(
            ((approvedCount - previousApprovedCount) / previousApprovedCount) *
              100 *
              10,
          ) / 10
        : null;

    // Verified-purchase rate with denominator declared.
    const verifiedPurchaseRate =
      approvedCount > 0 ? (verifiedAgg / approvedCount) * 100 : 0;

    return {
      total_reviews: totalInRange,
      // Defect 1: the average uses ONLY approved reviews. Pending and rejected
      // are still listed separately below as moderation queues; they no longer
      // pull the rating down.
      average_rating: averageRating,
      // Defect 7: explicit note for the UI about the policy.
      average_rating_policy: 'Solo reseñas aprobadas (visibles en la tienda)',
      approved_reviews: approvedCount,
      pending_reviews: pendingCount,
      rejected_reviews: rejectedCount,
      verified_purchases: verifiedAgg,
      verified_purchase_rate: Math.round(verifiedPurchaseRate * 10) / 10,
      rating_distribution: ratingDist,
      // Defect 4: growth from the previous period via computeGrowth semantics.
      average_rating_growth: averageRatingGrowth,
      reviews_growth: reviewsGrowth,
      pending_growth:
        pendingPrev > 0
          ? Math.round(
              ((pendingCount - pendingPrev) / pendingPrev) * 100 * 10,
            ) / 10
          : null,
      rejected_growth:
        rejectedPrev > 0
          ? Math.round(
              ((rejectedCount - rejectedPrev) / rejectedPrev) * 100 * 10,
            ) / 10
          : null,
      // Defect 3: the heavy _findMany → ten _filter() walk over the array is gone;
      // everything above is a single aggregate / count / groupBy at the DB.
      moderation_queue_total: pendingCount + rejectedCount,
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
