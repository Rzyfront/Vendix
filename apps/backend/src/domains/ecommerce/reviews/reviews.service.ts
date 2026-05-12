import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
  VoteReviewDto,
  ReportReviewDto,
} from './dto';

@Injectable()
export class EcommerceReviewsService {
  constructor(
    private readonly prisma: EcommercePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  async getProductReviews(query: ReviewListQueryDto) {
    const {
      product_id,
      page = 1,
      limit = 10,
      sort_by = 'recent',
      rating,
    } = query;

    const where: any = { product_id, state: 'approved' };
    if (rating) {
      where.rating = rating;
    }

    const order_by =
      sort_by === 'helpful'
        ? { helpful_count: 'desc' as const }
        : { created_at: 'desc' as const };

    const [reviews, total] = await Promise.all([
      this.prisma.reviews.findMany({
        where,
        orderBy: order_by,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          users: { select: { id: true, first_name: true, last_name: true } },
          review_responses: {
            include: {
              users: {
                select: { id: true, first_name: true, last_name: true },
              },
            },
          },
        },
      }),
      this.prisma.reviews.count({ where }),
    ]);

    // Rating distribution for the product (all approved reviews)
    const distribution_raw = await this.prisma.reviews.groupBy({
      by: ['rating'],
      where: { product_id, state: 'approved' },
      _count: true,
    });
    const rating_distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of distribution_raw) {
      rating_distribution[r.rating as keyof typeof rating_distribution] =
        r._count;
    }

    // Compute avg and total from distribution
    const total_count = Object.values(rating_distribution).reduce(
      (a, b) => a + b,
      0,
    );
    const avg_rating =
      total_count > 0
        ? Object.entries(rating_distribution).reduce(
            (sum, [star, count]) => sum + Number(star) * count,
            0,
          ) / total_count
        : 0;

    return {
      reviews,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      rating_distribution,
      avg_rating: Math.round(avg_rating * 10) / 10,
      total_count,
    };
  }

  async canReview(productId: number) {
    const context = RequestContextService.getContext()!;
    const user_id = context.user_id!;

    // Check if user has a delivered/finished order with this product
    // EcommercePrismaService scopes orders by store_id + customer_id automatically
    const order = await this.prisma.orders.findFirst({
      where: {
        state: { in: ['delivered', 'finished'] },
        order_items: { some: { product_id: productId } },
      },
    });

    if (!order) {
      return { can_review: false, reason: 'no_purchase' };
    }

    // Check if review already exists (reviews scoped by store_id, add user_id manually)
    const existing = await this.prisma.reviews.findFirst({
      where: { product_id: productId, user_id },
    });

    if (existing) {
      return { can_review: false, reason: 'already_reviewed' };
    }

    return { can_review: true };
  }

  async create(dto: CreateReviewDto) {
    const context = RequestContextService.getContext()!;
    const user_id = context.user_id!;

    // Validate can review
    const check = await this.canReview(dto.product_id);
    if (!check.can_review) {
      if (check.reason === 'no_purchase') {
        throw new VendixHttpException(ErrorCodes.REV_PURCHASE_001);
      }
      if (check.reason === 'already_reviewed') {
        throw new VendixHttpException(ErrorCodes.REV_DUP_001);
      }
    }

    // Rate limit: max 3 reviews per day
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const daily_count = await this.prisma.reviews.count({
      where: { user_id, created_at: { gte: today } },
    });
    if (daily_count >= 3) {
      throw new VendixHttpException(ErrorCodes.REV_RATE_LIMIT_001);
    }

    // Get product name for event
    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: { name: true },
    });

    // Get user name for event
    const user = await this.prisma.users.findFirst({
      where: { id: user_id },
      select: { first_name: true, last_name: true },
    });

    // Create review (store_id auto-injected by EcommercePrismaService)
    const review = await this.prisma.reviews.create({
      data: {
        product_id: dto.product_id,
        user_id,
        rating: dto.rating,
        title: dto.title,
        comment: dto.comment,
        verified_purchase: true,
        state: 'pending',
      },
    });

    this.event_emitter.emit('review.created', {
      store_id: context.store_id,
      review_id: review.id,
      product_id: dto.product_id,
      product_name: product?.name || 'Producto',
      customer_name:
        `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
      rating: dto.rating,
    });

    return review;
  }

  async update(id: number, dto: UpdateReviewDto) {
    const context = RequestContextService.getContext()!;
    const user_id = context.user_id!;

    const review = await this.prisma.reviews.findFirst({ where: { id } });

    if (!review) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }
    if (review.user_id !== user_id) {
      throw new VendixHttpException(ErrorCodes.REV_PERM_001);
    }
    if (review.state !== 'pending') {
      throw new VendixHttpException(ErrorCodes.REV_STATE_001);
    }

    const update_data: any = {};
    if (dto.rating !== undefined) update_data.rating = dto.rating;
    if (dto.title !== undefined) update_data.title = dto.title;
    if (dto.comment !== undefined) update_data.comment = dto.comment;

    const updated = await this.prisma.reviews.update({
      where: { id },
      data: update_data,
    });

    return updated;
  }

  async remove(id: number) {
    const context = RequestContextService.getContext()!;
    const user_id = context.user_id!;

    const review = await this.prisma.reviews.findFirst({ where: { id } });

    if (!review) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }
    if (review.user_id !== user_id) {
      throw new VendixHttpException(ErrorCodes.REV_PERM_001);
    }

    await this.prisma.reviews.delete({ where: { id } });

    return { deleted: true };
  }

  async vote(reviewId: number, dto: VoteReviewDto) {
    const context = RequestContextService.getContext()!;
    const user_id = context.user_id!;

    // Verify review exists and is approved
    const review = await this.prisma.reviews.findFirst({
      where: { id: reviewId, state: 'approved' },
    });
    if (!review) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }

    // Check existing vote
    const existing_vote = await this.prisma.review_votes.findFirst({
      where: { review_id: reviewId, user_id },
    });

    let vote;
    if (existing_vote) {
      vote = await this.prisma.review_votes.update({
        where: { id: existing_vote.id },
        data: { is_helpful: dto.is_helpful },
      });
    } else {
      vote = await this.prisma.review_votes.create({
        data: {
          review_id: reviewId,
          user_id,
          is_helpful: dto.is_helpful,
        },
      });
    }

    // Recount helpful votes and update review
    const helpful = await this.prisma.review_votes.count({
      where: { review_id: reviewId, is_helpful: true },
    });
    await this.prisma.reviews.update({
      where: { id: reviewId },
      data: { helpful_count: helpful },
    });

    return vote;
  }

  async report(reviewId: number, dto: ReportReviewDto) {
    const context = RequestContextService.getContext()!;
    const user_id = context.user_id!;

    // Verify review exists and is approved
    const review = await this.prisma.reviews.findFirst({
      where: { id: reviewId, state: 'approved' },
    });
    if (!review) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }

    // Check no existing report from this user
    const existing_report = await this.prisma.review_reports.findFirst({
      where: { review_id: reviewId, user_id },
    });
    if (existing_report) {
      throw new VendixHttpException(ErrorCodes.REV_REPORT_DUP_001);
    }

    // Create report
    const report = await this.prisma.review_reports.create({
      data: {
        review_id: reviewId,
        user_id,
        reason: dto.reason,
      },
    });

    // Increment report_count on review
    const new_report_count = (review.report_count || 0) + 1;
    const update_data: any = { report_count: new_report_count };

    // Auto-flag if 3+ reports
    if (new_report_count >= 3) {
      update_data.state = 'flagged';
    }

    await this.prisma.reviews.update({
      where: { id: reviewId },
      data: update_data,
    });

    return report;
  }
}
