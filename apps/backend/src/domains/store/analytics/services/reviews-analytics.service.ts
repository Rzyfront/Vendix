import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { parseDateRange } from '../utils/date.util';
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

    const { startDate, endDate } = parseDateRange(query);

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
}