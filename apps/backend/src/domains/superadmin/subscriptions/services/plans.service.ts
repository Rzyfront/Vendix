import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreatePlanDto, UpdatePlanDto, PlanQueryDto } from '../dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  private normalizeRedemptionCode(value: string | null | undefined) {
    if (value === undefined) return undefined;
    const code = String(value ?? '').trim();
    return code.length > 0 ? code : null;
  }

  private resolvePlanType(
    planType: string | undefined,
    isPromotional: boolean | undefined,
    fallback: string = 'base',
  ) {
    if (isPromotional === true) return 'promotional';
    const nextPlanType = planType ?? fallback;
    if (isPromotional === false && nextPlanType === 'promotional') return 'base';
    return nextPlanType;
  }

  async create(dto: CreatePlanDto) {
    const existing = await this.prisma.subscription_plans.findUnique({
      where: { code: dto.code },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.SYS_CONFLICT_001);
    }

    const planType = this.resolvePlanType(dto.plan_type, dto.is_promotional);
    const isPromotional = planType === 'promotional';

    return this.prisma.subscription_plans.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description || null,
        plan_type: planType as any,
        state: (dto.state as any) || 'draft',
        billing_cycle: (dto.billing_cycle as any) || 'monthly',
        base_price: dto.is_free ? 0 : dto.base_price,
        currency: dto.currency || 'COP',
        setup_fee: dto.is_free ? null : dto.setup_fee || null,
        is_free: dto.is_free ?? false,
        trial_days: dto.trial_days ?? 0,
        grace_period_soft_days: dto.grace_period_soft_days ?? 5,
        grace_period_hard_days: dto.grace_period_hard_days ?? 10,
        suspension_day: dto.suspension_day ?? 14,
        cancellation_day: dto.cancellation_day ?? 45,
        feature_matrix: (dto.feature_matrix ?? {}) as any,
        ai_feature_flags: (dto.ai_feature_flags ?? {}) as any,
        resellable: dto.resellable ?? !isPromotional,
        max_partner_margin_pct: dto.max_partner_margin_pct || null,
        is_promotional: isPromotional,
        redemption_code: this.normalizeRedemptionCode(dto.redemption_code),
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

    const nextIsFree = dto.is_free ?? existing.is_free;
    const nextPlanType = this.resolvePlanType(
      dto.plan_type,
      dto.is_promotional,
      existing.plan_type,
    );
    const nextIsPromotional = nextPlanType === 'promotional';
    const isLeavingPromotional =
      (existing.is_promotional || existing.plan_type === 'promotional') &&
      !nextIsPromotional;
    const redemptionCode = this.normalizeRedemptionCode(dto.redemption_code);

    return this.prisma.subscription_plans.update({
      where: { id },
      data: {
        ...(dto.code && { code: dto.code }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        plan_type: nextPlanType as any,
        ...(dto.state && { state: dto.state as any }),
        ...(dto.billing_cycle && { billing_cycle: dto.billing_cycle as any }),
        ...(nextIsFree
          ? { base_price: 0 }
          : dto.base_price !== undefined
            ? { base_price: dto.base_price }
            : {}),
        ...(dto.currency && { currency: dto.currency }),
        ...(nextIsFree
          ? { setup_fee: null }
          : dto.setup_fee !== undefined
            ? { setup_fee: dto.setup_fee }
            : {}),
        ...(dto.is_free !== undefined && { is_free: dto.is_free }),
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
        ...(isLeavingPromotional
          ? { resellable: true }
          : dto.resellable !== undefined
            ? { resellable: dto.resellable }
            : {}),
        ...(dto.max_partner_margin_pct !== undefined && {
          max_partner_margin_pct: dto.max_partner_margin_pct,
        }),
        is_promotional: nextIsPromotional,
        ...(redemptionCode !== undefined && {
          redemption_code: redemptionCode,
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

  /**
   * RNC-04 — Atomically set a plan as the unique default. Runs inside a
   * Serializable transaction:
   *  1. UPDATE subscription_plans SET is_default = false WHERE is_default = true
   *  2. UPDATE subscription_plans SET is_default = true WHERE id = :id
   *
   * Validations:
   *  - Plan must exist
   *  - Plan must be in `state='active'` (cannot promote draft/archived)
   *
   * The DB also enforces uniqueness through the partial unique index created
   * in migration 20260429000000 (`uniq_subscription_plans_only_one_default`),
   * so a race that sneaks past the read-then-write window will surface as a
   * unique-violation rather than corrupt data.
   */
  async setDefault(id: number) {
    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (plan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Only plans in state=active can be set as default',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Clear any existing default first to avoid violating the partial
        //    unique index (idx allows a single row with is_default=true).
        await tx.subscription_plans.updateMany({
          where: { is_default: true },
          data: { is_default: false, updated_at: new Date() },
        });

        // 2. Promote the requested plan.
        return tx.subscription_plans.update({
          where: { id },
          data: { is_default: true, updated_at: new Date() },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
