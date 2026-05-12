import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionQueryDto } from '../dto';

@Injectable()
export class ActiveSubscriptionsService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async findAll(query: SubscriptionQueryDto) {
    const {
      page = 1,
      limit = 10,
      state,
      plan_id,
      store_id,
      organization_id,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.store_subscriptionsWhereInput = {};

    if (state) where.state = state as any;
    if (plan_id) where.plan_id = plan_id;
    if (store_id) where.store_id = store_id;

    if (organization_id) {
      where.store = { organization_id };
    }

    if (search) {
      where.store = {
        ...((where.store as any) || {}),
        name: { contains: search, mode: 'insensitive' },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.store_subscriptions.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          plan: {
            select: { id: true, code: true, name: true, plan_type: true },
          },
          store: {
            select: {
              id: true,
              name: true,
              organization_id: true,
              organizations: { select: { id: true, name: true } },
            },
          },
          promotional_plan: { select: { id: true, code: true, name: true } },
          partner_override: {
            select: { id: true, custom_name: true, margin_pct: true },
          },
        },
      }),
      this.prisma.store_subscriptions.count({ where }),
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

  async findOne(id: number) {
    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { id },
      include: {
        plan: true,
        store: {
          select: {
            id: true,
            name: true,
            organization_id: true,
            organizations: { select: { id: true, name: true } },
          },
        },
        promotional_plan: { select: { id: true, code: true, name: true } },
        partner_override: true,
        invoices: {
          take: 5,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            invoice_number: true,
            state: true,
            total: true,
            due_at: true,
          },
        },
      },
    });

    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    return sub;
  }
}
