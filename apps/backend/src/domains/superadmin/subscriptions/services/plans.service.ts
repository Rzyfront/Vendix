import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreatePlanDto, UpdatePlanDto, PlanQueryDto } from '../dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async create(dto: CreatePlanDto) {
    const existing = await this.prisma.subscription_plans.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.SYS_CONFLICT_001);
    }

    return this.prisma.subscription_plans.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description || null,
        plan_type: (dto.plan_type as any) || 'base',
        state: (dto.state as any) || 'draft',
        billing_cycle: (dto.billing_cycle as any) || 'monthly',
        base_price: dto.base_price,
        currency: dto.currency || 'COP',
        setup_fee: dto.setup_fee || null,
        trial_days: dto.trial_days ?? 0,
        grace_period_soft_days: dto.grace_period_soft_days ?? 5,
        grace_period_hard_days: dto.grace_period_hard_days ?? 10,
        suspension_day: dto.suspension_day ?? 14,
        cancellation_day: dto.cancellation_day ?? 45,
        feature_matrix: (dto.feature_matrix ?? {}) as any,
        ai_feature_flags: (dto.ai_feature_flags ?? {}) as any,
        resellable: dto.resellable ?? false,
        max_partner_margin_pct: dto.max_partner_margin_pct || null,
        is_promotional: dto.is_promotional ?? false,
        promo_rules: (dto.promo_rules as any) || null,
        promo_priority: dto.promo_priority ?? 0,
        is_popular: dto.is_popular ?? false,
        is_default: dto.is_default ?? false,
        sort_order: dto.sort_order ?? 0,
        parent_plan_id: dto.parent_plan_id || null,
        updated_at: new Date(),
      },
    });
  }

  async findAll(query: PlanQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      plan_type,
      state,
      billing_cycle,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.subscription_plansWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (plan_type) where.plan_type = plan_type as any;
    if (state) where.state = state as any;
    if (billing_cycle) where.billing_cycle = billing_cycle as any;

    const [data, total] = await Promise.all([
      this.prisma.subscription_plans.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.subscription_plans.count({ where }),
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
    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id },
      include: {
        parent_plan: { select: { id: true, code: true, name: true } },
        partner_overrides: true,
      },
    });

    if (!plan) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return plan;
  }

  async update(id: number, dto: UpdatePlanDto) {
    const existing = await this.prisma.subscription_plans.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.subscription_plans.findUnique({
        where: { code: dto.code },
      });
      if (conflict) {
        throw new VendixHttpException(ErrorCodes.SYS_CONFLICT_001);
      }
    }

    return this.prisma.subscription_plans.update({
      where: { id },
      data: {
        ...(dto.code && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.plan_type && { plan_type: dto.plan_type as any }),
        ...(dto.state && { state: dto.state as any }),
        ...(dto.billing_cycle && { billing_cycle: dto.billing_cycle as any }),
        ...(dto.base_price !== undefined && { base_price: dto.base_price }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.setup_fee !== undefined && { setup_fee: dto.setup_fee }),
        ...(dto.trial_days !== undefined && { trial_days: dto.trial_days }),
        ...(dto.grace_period_soft_days !== undefined && {
          grace_period_soft_days: dto.grace_period_soft_days,
        }),
        ...(dto.grace_period_hard_days !== undefined && {
          grace_period_hard_days: dto.grace_period_hard_days,
        }),
        ...(dto.suspension_day !== undefined && {
          suspension_day: dto.suspension_day,
        }),
        ...(dto.cancellation_day !== undefined && {
          cancellation_day: dto.cancellation_day,
        }),
        ...(dto.feature_matrix !== undefined && {
          feature_matrix: dto.feature_matrix as any,
        }),
        ...(dto.ai_feature_flags !== undefined && {
          ai_feature_flags: dto.ai_feature_flags as any,
        }),
        ...(dto.resellable !== undefined && { resellable: dto.resellable }),
        ...(dto.max_partner_margin_pct !== undefined && {
          max_partner_margin_pct: dto.max_partner_margin_pct,
        }),
        ...(dto.is_promotional !== undefined && {
          is_promotional: dto.is_promotional,
        }),
        ...(dto.promo_rules !== undefined && {
          promo_rules: dto.promo_rules as any,
        }),
        ...(dto.promo_priority !== undefined && {
          promo_priority: dto.promo_priority,
        }),
        ...(dto.is_popular !== undefined && { is_popular: dto.is_popular }),
        ...(dto.is_default !== undefined && { is_default: dto.is_default }),
        ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
        ...(dto.parent_plan_id !== undefined && {
          parent_plan_id: dto.parent_plan_id,
        }),
        updated_at: new Date(),
      },
    });
  }

  async archive(id: number) {
    const existing = await this.prisma.subscription_plans.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return this.prisma.subscription_plans.update({
      where: { id },
      data: {
        state: 'archived',
        archived_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.subscription_plans.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    await this.prisma.subscription_plans.delete({ where: { id } });
  }
}
