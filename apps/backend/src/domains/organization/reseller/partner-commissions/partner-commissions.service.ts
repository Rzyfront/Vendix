import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CommissionQueryDto, PayoutQueryDto } from './dto';

@Injectable()
export class PartnerCommissionsService {
  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async findCommissions(query: CommissionQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sort_by = query.sort_by ?? 'accrued_at';
    const sort_order = query.sort_order ?? 'desc';
    const { state, period_start, period_end } = query;
    const skip = (page - 1) * limit;

    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const where: any = { partner_organization_id: ctx.organization_id };
    if (state) {
      where.state = state;
    }
    if (period_start || period_end) {
      where.accrued_at = {
        ...(period_start && { gte: new Date(period_start) }),
        ...(period_end && { lte: new Date(period_end) }),
      };
    }

    const [data, total] = await Promise.all([
      this.globalPrisma.partner_commissions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          invoice: {
            select: {
              id: true,
              invoice_number: true,
              state: true,
              total: true,
              period_start: true,
              period_end: true,
            },
          },
        },
      }),
      this.globalPrisma.partner_commissions.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async getSummary() {
    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const org_id = ctx.organization_id;

    const [accrued, pending_payout, paid] = await Promise.all([
      this.globalPrisma.partner_commissions.aggregate({
        where: { partner_organization_id: org_id, state: 'accrued' },
        _sum: { amount: true },
        _count: true,
      }),
      this.globalPrisma.partner_commissions.aggregate({
        where: { partner_organization_id: org_id, state: 'pending_payout' },
        _sum: { amount: true },
        _count: true,
      }),
      this.globalPrisma.partner_commissions.aggregate({
        where: { partner_organization_id: org_id, state: 'paid' },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      accrued: {
        total: Number(accrued._sum.amount || 0),
        count: accrued._count,
      },
      pending_payout: {
        total: Number(pending_payout._sum.amount || 0),
        count: pending_payout._count,
      },
      paid: {
        total: Number(paid._sum.amount || 0),
        count: paid._count,
      },
    };
  }

  async findPayouts(query: PayoutQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sort_by = query.sort_by ?? 'created_at';
    const sort_order = query.sort_order ?? 'desc';
    const { state } = query;
    const skip = (page - 1) * limit;

    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const where: any = { partner_organization_id: ctx.organization_id };
    if (state) {
      where.state = state;
    }

    const [data, total] = await Promise.all([
      this.globalPrisma.partner_payout_batches.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          commissions: {
            select: {
              id: true,
              amount: true,
              state: true,
              invoice: {
                select: {
                  invoice_number: true,
                },
              },
            },
          },
        },
      }),
      this.globalPrisma.partner_payout_batches.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }
}
