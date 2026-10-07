import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto, Granularity } from '../dto/analytics-query.dto';
import { parseDateRange, getPreviousPeriod } from '../utils/date.util';
import {
  resolveStoreTimezone,
  localPeriodSql,
} from '@common/utils/store-timezone.util';
import { computeGrowth, round2 } from '../analytics-metrics.contract';
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
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    // Estado de moderación: son métricas OPERATIVAS aparte. Nada de
    // `state: 'approved'` vive en esta consulta: `pending`/`rejected` NO son
    // insumo del promedio ni del histograma.
    const stateGroups = await this.prisma.reviews.groupBy({
      by: ['state'],
      where: {
        store_id: storeId,
        created_at: { gte: startDate, lte: endDate },
      }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
      _count: { _all: true },
    });
    const approvedReviews =
      stateGroups.find((g) => g.state === 'approved')?._count._all ?? 0;
    const pendingReviews =
      stateGroups.find((g) => g.state === 'pending')?._count._all ?? 0;
    const rejectedReviews =
      stateGroups.find((g) => g.state === 'rejected')?._count._all ?? 0;
    const totalReviews = stateGroups.reduce((sum, g) => sum + g._count._all, 0);

    // Promedio e histograma SOLO sobre `approved` (lo que ve la tienda).
    const [avgAgg, ratingGroups] = await Promise.all([
      this.prisma.reviews.aggregate({
        where: {
          store_id: storeId,
          state: 'approved',
          created_at: { gte: startDate, lte: endDate },
        }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
        _avg: { rating: true },
      }),
      this.prisma.reviews.groupBy({
        by: ['rating'],
        where: {
          store_id: storeId,
          state: 'approved',
          created_at: { gte: startDate, lte: endDate },
        }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
        _count: { _all: true },
      }),
    ]);

    const totalHelpfulVotes = await this.prisma.reviews.aggregate({
      where: {
        store_id: storeId,
        created_at: { gte: startDate, lte: endDate },
      }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
      _sum: { helpful_count: true },
    });

    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of ratingGroups) {
      const count = g._count._all;
      if (g.rating >= 1 && g.rating <= 5) {
        ratingDistribution[g.rating] = count;
      }
    }

    // Compra verificada: % de aprobadas (denominador explícito). `0` approved
    // ⇒ sin base ⇒ `null` (nunca `0 %`), igual que `computeGrowth`.
    const verifiedApproved = await this.prisma.reviews.count({
      where: {
        store_id: storeId,
        state: 'approved',
        verified_purchase: true,
        created_at: { gte: startDate, lte: endDate },
      }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
    });
    const verifiedPurchaseRate =
      approvedReviews > 0
        ? round2((verifiedApproved / approvedReviews) * 100)
        : null;

    // Período anterior: promedio y total de aprobadas para `computeGrowth`.
    const [prevAvgAgg, prevTotal] = await Promise.all([
      this.prisma.reviews.aggregate({
        where: {
          store_id: storeId,
          state: 'approved',
          created_at: { gte: previousStartDate, lte: previousEndDate },
        }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.prisma.reviews.count({
        where: {
          store_id: storeId,
          created_at: { gte: previousStartDate, lte: previousEndDate },
        }, // tz-audit:ignore — INSTANTE, ventana en TZ de tienda
      }),
    ]);
    const previousApprovedReviews = prevAvgAgg._count._all || 0;
    const previousAverage =
      previousApprovedReviews > 0 ? (prevAvgAgg._avg.rating ?? 0) : 0;

    const averageRating =
      approvedReviews > 0 ? (avgAgg._avg.rating ?? 0) : 0;

    return {
      total_reviews: totalReviews,
      total_reviews_growth: computeGrowth(totalReviews, prevTotal),
      average_rating: Math.round(averageRating * 10) / 10,
      average_rating_growth:
        approvedReviews > 0 && previousApprovedReviews > 0
          ? computeGrowth(averageRating, previousAverage)
          : null,
      verified_purchases: verifiedApproved,
      verified_purchase_rate: verifiedPurchaseRate,
      pending_reviews: pendingReviews,
      approved_reviews: approvedReviews,
      rejected_reviews: rejectedReviews,
      rating_distribution: ratingDistribution,
      total_helpful_votes: totalHelpfulVotes._sum.helpful_count ?? 0,
    };
  }

  /**
   * QUI-629: tendencia de la calificación promedio (solo `approved`) por
   * período local de la tienda. `reviews.created_at` es INSTANTE → se
   * convierte con `localPeriodSql` (doble `AT TIME ZONE`) para que el bucket
   * caiga en el día local, no en el UTC.
   */
  async getRatingTrend(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const granularity = query.granularity || Granularity.DAY;
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    const periodSql = localPeriodSql('r.created_at', tz, granularity);
    return (await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{ period: string; average_rating: unknown; review_count: bigint }>
    >`
      SELECT
        ${periodSql} AS period,
        COALESCE(AVG(r.rating), 0) AS average_rating,
        COUNT(*) AS review_count
      FROM reviews r
      WHERE r.store_id = ${storeId}
        AND r.state = 'approved'
        AND r.created_at >= ${startDate}
        AND r.created_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `).map((row) => ({
      period: row.period,
      average_rating: Number(row.average_rating),
      review_count: Number(row.review_count),
    }));
  }

  async getReviewsForExport(query: AnalyticsQueryDto) {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const tz = await resolveStoreTimezone(this.prisma, context.store_id);
    const { startDate, endDate } = parseDateRange(query, tz);

    // QUI-629 / ADR-5: el tope de 10.000 filas debe llegar SEÑALADO, no
    // recortado en silencio. Se pide una fila extra para distinguir "exacto"
    // de "cortado".
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
      take: 10001,
    });

    const truncated = reviews.length > 10000;
    const capped = truncated ? reviews.slice(0, 10000) : reviews;

    const rows = capped.map((review) => ({
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

    if (truncated) {
      rows.push({
        Fecha: null,
        Producto: 'AVISO: Dataset truncado a 10.000 filas. Refinar filtros para ver el resto.',
        SKU: '',
        Cliente: '',
        Email: '',
        Calificación: 0,
        Título: '',
        Comentario: '',
        Estado: '',
        'Compra Verificada': '',
        'Votos Útiles': 0,
      });
    }

    return { rows, truncated };
  }

  /**
   * QUI-548: reseñas agregadas por producto. Una fila por producto con:
   * - product_id, name, sku
   * - total_reviews
   * - average_rating (redondeado a 1 decimal para legibilidad)
   * - distribución de estrellas (1..5)
   * - verified_count y pending_count (para filtrar reseñas reales)
   * - last_review_date (Date cruda)
   *
   * Ordenado por total_reviews desc. Si un producto no tiene reseñas en
   * el período, NO aparece (es un reporte del período, no del catálogo).
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
        // Prisma 7 rejects `{ not: null }` (semantically redundant: nullable fields
        // are excluded by default). The original Prisma-6 form here triggered
        // `PrismaClientValidationError: Argument 'not' must not be null` at
        // runtime — see PR #593 / QUI-548 follow-up.
        product_id: { not: undefined },
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
      if (r.created_at && (!bucket.last_review_date || r.created_at > bucket.last_review_date)) {
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
        last_review_date: b.last_review_date,
      }))
      .sort((a, b) => b.total_reviews - a.total_reviews);
  }
}
