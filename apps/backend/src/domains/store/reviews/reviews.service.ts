import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ReviewQueryDto,
  CreateReviewResponseDto,
  UpdateReviewResponseDto,
} from './dto';

@Injectable()
export class ReviewsService {
  constructor(
    private prisma: StorePrismaService,
    private event_emitter: EventEmitter2,
  ) {}

  async findAll(query: ReviewQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      state,
      rating,
      product_id,
      user_id,
      verified_purchase,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (state) where.state = state;
    if (rating) where.rating = rating;
    if (product_id) where.product_id = product_id;
    if (user_id) where.user_id = user_id;
    if (verified_purchase !== undefined)
      where.verified_purchase = verified_purchase;

    if (search) {
      where.OR = [
        { users: { first_name: { contains: search, mode: 'insensitive' } } },
        { users: { last_name: { contains: search, mode: 'insensitive' } } },
        { products: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.reviews.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          users: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
          products: {
            select: { id: true, name: true, image_url: true },
          },
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

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStats() {
    const [
      pending_count,
      approved_count,
      rejected_count,
      flagged_count,
      ratingAgg,
    ] = await Promise.all([
      this.prisma.reviews.count({ where: { state: 'pending' } }),
      this.prisma.reviews.count({ where: { state: 'approved' } }),
      this.prisma.reviews.count({ where: { state: 'rejected' } }),
      this.prisma.reviews.count({ where: { state: 'flagged' } }),
      this.prisma.reviews.aggregate({
        _avg: { rating: true },
        where: { state: 'approved' },
      }),
    ]);

    return {
      pending_count,
      approved_count,
      rejected_count,
      flagged_count,
      average_rating: ratingAgg._avg?.rating ?? null,
    };
  }

  async findOne(id: number) {
    const review = await this.prisma.reviews.findFirst({
      where: { id },
      include: {
        users: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
        products: {
          select: { id: true, name: true, image_url: true },
        },
        review_responses: {
          include: {
            users: {
              select: { id: true, first_name: true, last_name: true },
            },
          },
        },
        review_votes: true,
        review_reports: true,
      },
    });

    if (!review) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }

    return review;
  }

  async approve(id: number) {
    const review = await this.findOne(id);
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const updated = await this.prisma.reviews.update({
      where: { id },
      data: { state: 'approved' },
    });

    this.event_emitter.emit('review.moderated', {
      store_id,
      review_id: id,
      user_id: review.user_id,
      product_name: review.products.name,
      new_state: 'approved',
    });

    return updated;
  }

  async reject(id: number) {
    const review = await this.findOne(id);
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    const updated = await this.prisma.reviews.update({
      where: { id },
      data: { state: 'rejected' },
    });

    this.event_emitter.emit('review.moderated', {
      store_id,
      review_id: id,
      user_id: review.user_id,
      product_name: review.products.name,
      new_state: 'rejected',
    });

    return updated;
  }

  async hide(id: number) {
    await this.findOne(id);

    return this.prisma.reviews.update({
      where: { id },
      data: { state: 'hidden' },
    });
  }

  async remove(id: number) {
    await this.findOne(id);

    return this.prisma.reviews.delete({
      where: { id },
    });
  }

  async createResponse(review_id: number, dto: CreateReviewResponseDto) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    await this.findOne(review_id);

    const existing = await this.prisma.review_responses.findFirst({
      where: { review_id },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.REV_DUP_001);
    }

    return this.prisma.review_responses.create({
      data: {
        review_id,
        user_id,
        content: dto.content,
      },
    });
  }

  async updateResponse(review_id: number, dto: UpdateReviewResponseDto) {
    const response = await this.prisma.review_responses.findFirst({
      where: { review_id },
    });

    if (!response) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }

    return this.prisma.review_responses.update({
      where: { id: response.id },
      data: { content: dto.content },
    });
  }

  async deleteResponse(review_id: number) {
    const response = await this.prisma.review_responses.findFirst({
      where: { review_id },
    });

    if (!response) {
      throw new VendixHttpException(ErrorCodes.REV_FIND_001);
    }

    return this.prisma.review_responses.delete({
      where: { id: response.id },
    });
  }
}
