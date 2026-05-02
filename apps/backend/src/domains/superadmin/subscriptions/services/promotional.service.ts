import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  CreatePromotionalDto,
  UpdatePromotionalDto,
  PromotionalQueryDto,
} from '../dto';

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
    const {
      page = 1,
      limit = 10,
      search,
      state,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

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
        ...(dto.billing_cycle && { billing_cycle: dto.billing_cycle as any }),
        ...(dto.base_price !== undefined && { base_price: dto.base_price }),
        ...(dto.currency && { currency: dto.currency }),
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
        ...(dto.promo_rules !== undefined && {
          promo_rules: dto.promo_rules as any,
        }),
        ...(dto.promo_priority !== undefined && {
          promo_priority: dto.promo_priority,
        }),
        ...(dto.parent_plan_id !== undefined && {
          parent_plan_id: dto.parent_plan_id,
        }),
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

  /**
   * RNC-05 — Super-admin grants a promotional plan to one or all stores of an
   * organization. Replaces the legacy `extend-trial` flow: there are no trial
   * extensions, only promotional plan assignments.
   *
   * Behavior:
   *  - If `storeId` is given, target that single store.
   *  - Otherwise, target every store of the org that does NOT already have an
   *    active promotional_plan_id (idempotent: never overwrites a different
   *    promo without explicit override).
   *  - For each target store_subscriptions row:
   *      * Sets `promotional_plan_id` and `promotional_applied_at`.
   *      * If currently in `draft`/`cancelled`/`expired`/`no_plan`, transitions
   *        to `active`.
   *      * Writes a `subscription_events` audit row of type
   *        `promotional_applied` with `payload.assigned_by_admin = true` plus
   *        the operator-provided `reason` (used by audit dashboards instead of
   *        the deprecated `promo_assigned_by_admin` event-type alias).
   *
   * Validations:
   *  - Plan must exist and be `plan_type='promotional'` and `state='active'`.
   *  - Org must exist; at least one eligible store required.
   */
  async assignPromoPlan(
    orgId: number,
    dto: { plan_id: number; store_id?: number; reason: string },
    actorUserId: number | null,
  ): Promise<{
    org_id: number;
    plan_id: number;
    assigned: Array<{ store_id: number; subscription_id: number }>;
  }> {
    if (!Number.isInteger(orgId) || orgId <= 0) {
      throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001);
    }
    if (!dto?.reason || dto.reason.trim().length === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'reason is required',
      );
    }

    const promoPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.plan_id },
    });

    if (!promoPlan) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Promotional plan not found',
      );
    }
    if (promoPlan.plan_type !== 'promotional') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Plan is not of type promotional',
      );
    }
    if (promoPlan.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Promotional plan must be in state=active',
      );
    }

    const org = await this.prisma.organizations.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Organization not found',
      );
    }

    // Resolve target stores.
    const storeWhere: Prisma.storesWhereInput = { organization_id: orgId };
    if (dto.store_id) {
      storeWhere.id = dto.store_id;
    }
    const stores = await this.prisma.stores.findMany({
      where: storeWhere,
      select: { id: true },
    });
    if (stores.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'No matching stores for organization',
      );
    }

    const now = new Date();
    const assigned: Array<{ store_id: number; subscription_id: number }> = [];
    const eligibleStateTransitions = new Set<string>([
      'draft',
      'cancelled',
      'expired',
      'no_plan',
    ]);

    for (const store of stores) {
      const sub = await this.prisma.store_subscriptions.findUnique({
        where: { store_id: store.id },
      });

      // When no explicit store_id, skip stores that already have a promo
      // assigned (idempotent broadcast).
      if (!dto.store_id && sub?.promotional_plan_id) {
        continue;
      }

      const result = await this.prisma.$transaction(async (tx) => {
        let targetSub = sub;

        if (!targetSub) {
          // No subscription yet — create one with the promo plan and active state.
          targetSub = await tx.store_subscriptions.create({
            data: {
              store_id: store.id,
              plan_id: promoPlan.id,
              promotional_plan_id: promoPlan.id,
              promotional_applied_at: now,
              state: 'active',
              auto_renew: true,
              updated_at: now,
            },
          });
        } else {
          const updateData: Prisma.store_subscriptionsUpdateInput = {
            promotional_plan: { connect: { id: promoPlan.id } },
            promotional_applied_at: now,
            updated_at: now,
          };
          if (eligibleStateTransitions.has(targetSub.state)) {
            updateData.state = 'active';
          }
          targetSub = await tx.store_subscriptions.update({
            where: { id: targetSub.id },
            data: updateData,
          });
        }

        // After both branches, targetSub is guaranteed non-null.
        const subRow = targetSub!;

        await tx.subscription_events.create({
          data: {
            store_subscription_id: subRow.id,
            type: 'promotional_applied',
            payload: {
              assigned_by_admin: true,
              promotional_plan_id: promoPlan.id,
              promotional_plan_code: promoPlan.code,
              reason: dto.reason,
              kind: 'promo_assigned_by_admin',
            } as Prisma.InputJsonValue,
            triggered_by_user_id: actorUserId ?? null,
          },
        });

        return subRow;
      });

      assigned.push({ store_id: store.id, subscription_id: result.id });
    }

    return { org_id: orgId, plan_id: promoPlan.id, assigned };
  }
}
