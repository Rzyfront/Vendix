import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreatePromotionalDto, UpdatePromotionalDto, PromotionalQueryDto } from '../dto';

@Injectable()
export class PromotionalService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async create(dto: CreatePromotionalDto) {
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
        plan_type: 'promotional',
        state: 'draft',
        billing_cycle: (dto.billing_cycle as any) || 'monthly',
        base_price: dto.base_price,
        currency: dto.currency || 'COP',
        trial_days: dto.trial_days ?? 0,
        grace_period_soft_days: dto.grace_period_soft_days ?? 5,
        grace_period_hard_days: dto.grace_period_hard_days ?? 10,
        suspension_day: dto.suspension_day ?? 14,
        cancellation_day: dto.cancellation_day ?? 45,
        feature_matrix: (dto.feature_matrix ?? {}) as any,
        ai_feature_flags: (dto.ai_feature_flags ?? {}) as any,
        resellable: false,
        is_promotional: true,
        promo_rules: dto.promo_rules as any,
        promo_priority: dto.promo_priority ?? 0,
        parent_plan_id: dto.parent_plan_id || null,
        updated_at: new Date(),
      },
    });
  }

  async findAll(query: PromotionalQueryDto) {
    const { page = 1, limit = 10, search, state, sort_by = 'created_at', sort_order = 'desc' } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.subscription_plansWhereInput = {
      is_promotional: true,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (state) where.state = state as any;

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
    const plan = await this.prisma.subscription_plans.findFirst({
      where: { id, is_promotional: true },
    });

    if (!plan) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    // Histórico de aplicaciones del plan promocional
    // subscription_events.payload es Json — usamos JSON path query de Prisma
    const applications = await this.prisma.subscription_events.findMany({
      where: {
        type: 'promotional_applied',
        payload: { path: ['promotional_plan_id'], equals: id },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
      select: {
        id: true,
        store_subscription_id: true,
        payload: true,
        created_at: true,
        triggered_by_user_id: true,
        triggered_by_job: true,
      },
    });

    return { ...plan, applications };
  }

  async update(id: number, dto: UpdatePromotionalDto) {
    const existing = await this.prisma.subscription_plans.findFirst({
      where: { id, is_promotional: true },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (dto.code && dto.code !== existing.code) {
      const conflict = await this.prisma.subscription_plans.findUnique({ where: { code: dto.code } });
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
        ...(dto.billing_cycle && { billing_cycle: dto.billing_cycle as any }),
        ...(dto.base_price !== undefined && { base_price: dto.base_price }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.trial_days !== undefined && { trial_days: dto.trial_days }),
        ...(dto.grace_period_soft_days !== undefined && { grace_period_soft_days: dto.grace_period_soft_days }),
        ...(dto.grace_period_hard_days !== undefined && { grace_period_hard_days: dto.grace_period_hard_days }),
        ...(dto.suspension_day !== undefined && { suspension_day: dto.suspension_day }),
        ...(dto.cancellation_day !== undefined && { cancellation_day: dto.cancellation_day }),
        ...(dto.feature_matrix !== undefined && { feature_matrix: dto.feature_matrix as any }),
        ...(dto.ai_feature_flags !== undefined && { ai_feature_flags: dto.ai_feature_flags as any }),
        ...(dto.promo_rules !== undefined && { promo_rules: dto.promo_rules as any }),
        ...(dto.promo_priority !== undefined && { promo_priority: dto.promo_priority }),
        ...(dto.parent_plan_id !== undefined && { parent_plan_id: dto.parent_plan_id }),
        updated_at: new Date(),
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.subscription_plans.findFirst({
      where: { id, is_promotional: true },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    await this.prisma.subscription_plans.delete({ where: { id } });
  }
}
