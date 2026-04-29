import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { EventsQueryDto } from '../dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async findBySubscription(subscriptionId: number, query: EventsQueryDto) {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id: subscriptionId },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const {
      page = 1,
      limit = 10,
      type,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.subscription_eventsWhereInput = {
      store_subscription_id: subscriptionId,
    };

    if (type) where.type = type as any;

    const [data, total] = await Promise.all([
      this.prisma.subscription_events.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.subscription_events.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findAll(query: EventsQueryDto) {
    const {
      page = 1,
      limit = 10,
      type,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.subscription_eventsWhereInput = {};

    if (type) where.type = type as any;

    const [data, total] = await Promise.all([
      this.prisma.subscription_events.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.subscription_events.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }
}
