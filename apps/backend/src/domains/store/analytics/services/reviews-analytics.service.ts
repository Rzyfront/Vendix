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
}
