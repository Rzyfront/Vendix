import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  CreatePlanDto,
  UpdatePlanDto,
  PlanQueryDto,
  PlanPricingDto,
} from '../dto';

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

  /**
   * Derive the per-cycle code for a non-default member of a multi-cycle group.
   * The is_default pricing keeps the canonical `dto.code`; the rest get a
   * `${code}-${billing_cycle}` suffix.
   */
  private deriveCycleCode(baseCode: string, billingCycle: string) {
    return `${baseCode}-${billingCycle}`;
  }

  /**
   * Build the subset of subscription_plans fields that are shared across every
   * row of a multi-cycle group. Excludes per-cycle fields (code, billing_cycle,
   * base_price, currency) and the group/identity fields handled by the caller.
   */
  private buildSharedCreateData(dto: CreatePlanDto, isPromotional: boolean) {
    return {
      name: dto.name,
      description: dto.description || null,
      state: (dto.state as any) || 'draft',
      setup_fee: dto.is_free ? null : dto.setup_fee || null,
      is_free: dto.is_free ?? false,
      grace_period_soft_days: dto.grace_period_soft_days ?? 5,
      grace_period_hard_days: dto.grace_period_hard_days ?? 10,
      suspension_day: dto.suspension_day ?? 14,
      cancellation_day: dto.cancellation_day ?? 45,
      feature_matrix: (dto.feature_matrix ?? {}) as any,
      ai_feature_flags: (dto.ai_feature_flags ?? {}) as any,
      resellable: dto.resellable ?? !isPromotional,
      max_partner_margin_pct: dto.max_partner_margin_pct || null,
      is_promotional: isPromotional,
      promo_rules: (dto.promo_rules as any) || null,
      promo_priority: dto.promo_priority ?? 0,
      is_popular: dto.is_popular ?? false,
      sort_order: dto.sort_order ?? 0,
      parent_plan_id: dto.parent_plan_id || null,
      details_md: dto.details_md ?? null,
    };
  }

  async create(dto: CreatePlanDto) {
    if (Array.isArray(dto.pricings) && dto.pricings.length > 0) {
      return this.createMultiCycle(dto);
    }

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
        ...this.buildSharedCreateData(dto, isPromotional),
        code: dto.code,
        plan_type: planType as any,
        billing_cycle: (dto.billing_cycle as any) || 'monthly',
        base_price: dto.is_free ? 0 : dto.base_price,
        currency: dto.currency || 'COP',
        plan_group_code: dto.plan_group_code ?? dto.code,
        redemption_code: this.normalizeRedemptionCode(dto.redemption_code),
        is_default: dto.is_default ?? false,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Multi-cycle create: one subscription_plans row per pricing, all sharing the
   * same plan_group_code. Exactly one pricing must be is_default=true; that row
   * keeps the canonical `dto.code`, the rest get a `${code}-${cycle}` suffix.
   * Atomic: any code collision rolls back the whole group.
   */
  private async createMultiCycle(dto: CreatePlanDto) {
    const pricings = dto.pricings as PlanPricingDto[];

    const defaults = pricings.filter((p) => p.is_default === true);
    if (defaults.length !== 1) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_010,
        'Exactly one pricing must be marked as is_default=true',
      );
    }

    // Reject duplicate billing cycles within the same group.
    const cycles = new Set<string>();
    for (const p of pricings) {
      if (cycles.has(p.billing_cycle)) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `Duplicate billing_cycle '${p.billing_cycle}' in pricings`,
        );
      }
      cycles.add(p.billing_cycle);
    }

    const planType = this.resolvePlanType(dto.plan_type, dto.is_promotional);
    const isPromotional = planType === 'promotional';
    const groupCode = dto.plan_group_code ?? dto.code;
    const shared = this.buildSharedCreateData(dto, isPromotional);

    return this.prisma.$transaction(
      async (tx) => {
        const created: any[] = [];

        for (const pricing of pricings) {
          const code = pricing.is_default
            ? dto.code
            : this.deriveCycleCode(dto.code, pricing.billing_cycle);

          const conflict = await tx.subscription_plans.findUnique({
            where: { code },
          });
          if (conflict) {
            throw new VendixHttpException(
              ErrorCodes.SYS_CONFLICT_001,
              `Plan code '${code}' already exists`,
            );
          }

          const row = await tx.subscription_plans.create({
            data: {
              ...shared,
              code,
              plan_type: planType as any,
              billing_cycle: pricing.billing_cycle as any,
              base_price: dto.is_free ? 0 : pricing.price,
              currency: pricing.currency || dto.currency || 'COP',
              plan_group_code: groupCode,
              // redemption_code is @unique, so it can only live on one row.
              redemption_code: pricing.is_default
                ? this.normalizeRedemptionCode(dto.redemption_code)
                : null,
              // Row-level `is_default` is the GLOBAL "default plan" flag guarded
              // by the partial unique index (only one active row may be true).
              // The per-pricing `is_default` only marks the canonical CYCLE
              // (the row that keeps `dto.code`), it must NOT leak into the
              // global flag. Only the canonical row may carry the global flag,
              // and only when the form explicitly opted in via dto.is_default.
              is_default: pricing.is_default ? (dto.is_default ?? false) : false,
              updated_at: new Date(),
            },
          });
          created.push(row);
        }

        return {
          plan_group_code: groupCode,
          plans: created,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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

    // Multi-cycle plans are stored as one row PER billing cycle, all sharing a
    // plan_group_code (the canonical cycle keeps the base code; the rest carry
    // a `-${cycle}` suffix). The list must collapse each group to a SINGLE row
    // so plans are not shown duplicated. Cycles remain visible in findOne via
    // the pricings[] array.

    // 1. Resolve the candidate group keys from rows matching the filters. A
    // plan's group key is its plan_group_code (backfilled to its own code for
    // legacy single-cycle rows).
    const matches = await this.prisma.subscription_plans.findMany({
      where,
      select: { code: true, plan_group_code: true },
    });

    const groupKeys = Array.from(
      new Set(matches.map((m) => m.plan_group_code ?? m.code)),
    );

    if (groupKeys.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page: Number(page),
          limit: Number(limit),
          totalPages: 0,
        },
      };
    }

    // 2. Load every row of those groups to pick the canonical cycle row and
    // build the pricings[] summary per group.
    const groupRows = await this.prisma.subscription_plans.findMany({
      where: {
        OR: [
          { plan_group_code: { in: groupKeys } },
          { code: { in: groupKeys } },
        ],
      },
    });

    // 3. Bucket rows by group key.
    const grouped = new Map<string, typeof groupRows>();
    for (const row of groupRows) {
      const key = row.plan_group_code ?? row.code;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(row);
      else grouped.set(key, [row]);
    }

    // 4. Collapse each group to its canonical cycle row + pricings[]. The
    // canonical CYCLE is the row whose code equals the group key; fallback to
    // the cheapest row. Same pricings mapping as findOne for consistency.
    const collapsed = Array.from(grouped.entries()).map(([key, rows]) => {
      const cheapest = [...rows].sort(
        (a, b) => Number(a.base_price) - Number(b.base_price),
      )[0];
      const canonical = rows.find((r) => r.code === key) ?? cheapest;

      const pricings = rows
        .filter((r) => r.state !== 'archived')
        .sort((a, b) => Number(a.base_price) - Number(b.base_price))
        .map((r) => ({
          id: r.id,
          code: r.code,
          billing_cycle: r.billing_cycle,
          price: r.base_price,
          currency: r.currency,
          is_default: r.code === key,
          state: r.state,
        }));

      return { ...canonical, plan_group_code: key, pricings };
    });

    // 5. Sort the collapsed groups by the requested column.
    const norm = (v: unknown): number | string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.getTime();
      if (typeof v === 'object' && typeof (v as any).toNumber === 'function') {
        return (v as any).toNumber();
      }
      return typeof v === 'number' ? v : String(v);
    };
    const dir = sort_order === 'asc' ? 1 : -1;
    collapsed.sort((a, b) => {
      const av = norm((a as any)[sort_by]);
      const bv = norm((b as any)[sort_by]);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return cmp * dir;
    });

    // 6. Paginate over groups (not rows).
    const total = collapsed.length;
    const skip = (Number(page) - 1) * Number(limit);
    const data = collapsed.slice(skip, skip + Number(limit));

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

    // Resolve the multi-cycle group. A null plan_group_code (legacy/backfill
    // edge) is treated as a single-row group keyed by its own code.
    const groupCode = plan.plan_group_code ?? plan.code;
    const groupRows = await this.prisma.subscription_plans.findMany({
      where: {
        plan_group_code: groupCode,
        state: { not: 'archived' },
      },
      orderBy: { base_price: 'asc' },
    });

    // Fallback when the group resolution returns nothing (e.g. group code only
    // set on this row but filtered out): expose the plan itself.
    const source = groupRows.length > 0 ? groupRows : [plan];

    const pricings = source.map((row) => ({
      id: row.id,
      code: row.code,
      billing_cycle: row.billing_cycle,
      price: row.base_price,
      currency: row.currency,
      // The canonical CYCLE is the row whose code equals the group code (it
      // keeps the base code; the others carry a `-${cycle}` suffix). This is
      // independent of the global `is_default` plan flag.
      is_default: row.code === groupCode,
      state: row.state,
    }));

    return {
      ...plan,
      plan_group_code: groupCode,
      pricings,
    };
  }

  /**
   * Count how many store_subscriptions reference a plan row across any of the
   * plan-pointing columns. Used to decide archive-vs-delete when a billing
   * cycle is removed from a group: a referenced row is never hard-deleted.
   */
  private async countSubscriptionRefs(
    tx: Prisma.TransactionClient,
    planId: number,
  ) {
    return tx.store_subscriptions.count({
      where: {
        OR: [
          { plan_id: planId },
          { paid_plan_id: planId },
          { pending_plan_id: planId },
          { scheduled_plan_id: planId },
          { promotional_plan_id: planId },
        ],
      },
    });
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

    const groupCode = existing.plan_group_code ?? existing.code;
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

    // Fields shared by every row of a multi-cycle group. Excludes per-cycle
    // fields (code, billing_cycle, base_price, currency), the global is_default
    // flag, and the @unique redemption_code — those are handled per row below.
    const sharedData: Prisma.subscription_plansUpdateManyMutationInput = {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      plan_type: nextPlanType as any,
      ...(dto.state && { state: dto.state as any }),
      ...(nextIsFree
        ? { setup_fee: null }
        : dto.setup_fee !== undefined
          ? { setup_fee: dto.setup_fee }
          : {}),
      ...(dto.is_free !== undefined && { is_free: dto.is_free }),
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
      ...(dto.promo_rules !== undefined && {
        promo_rules: dto.promo_rules as any,
      }),
      ...(dto.promo_priority !== undefined && {
        promo_priority: dto.promo_priority,
      }),
      ...(dto.is_popular !== undefined && { is_popular: dto.is_popular }),
      ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
      ...(dto.parent_plan_id !== undefined && {
        parent_plan_id: dto.parent_plan_id,
      }),
      ...(dto.details_md !== undefined && { details_md: dto.details_md }),
      updated_at: new Date(),
    };

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Propagate shared fields to every non-archived row of the group.
        await tx.subscription_plans.updateMany({
          where: { plan_group_code: groupCode, state: { not: 'archived' } },
          data: sharedData,
        });

        // 2. Per-cycle reconciliation when the caller sends a pricings array.
        if (Array.isArray(dto.pricings)) {
          const groupRows = await tx.subscription_plans.findMany({
            where: { plan_group_code: groupCode, state: { not: 'archived' } },
          });
          const wantedCycles = new Set(
            dto.pricings.map((p) => p.billing_cycle),
          );

          // 2a. Upsert each requested cycle.
          for (const pricing of dto.pricings) {
            const price = nextIsFree ? 0 : pricing.price;
            const currency = pricing.currency || existing.currency || 'COP';
            const row = groupRows.find(
              (r) => r.billing_cycle === (pricing.billing_cycle as any),
            );

            if (row) {
              await tx.subscription_plans.update({
                where: { id: row.id },
                data: { base_price: price, currency, updated_at: new Date() },
              });
            } else {
              // New cycle: always non-canonical (the canonical row keeps the
              // group code and is never recreated here).
              const code = this.deriveCycleCode(
                groupCode,
                pricing.billing_cycle,
              );
              const conflict = await tx.subscription_plans.findUnique({
                where: { code },
              });
              if (conflict) {
                throw new VendixHttpException(
                  ErrorCodes.SYS_CONFLICT_001,
                  `Plan code '${code}' already exists`,
                );
              }
              await tx.subscription_plans.create({
                data: {
                  // Derived per-cycle code (e.g. `enterprise-monthly`). Required
                  // by the schema; omitting it makes Prisma reject the insert.
                  code,
                  name: dto.name ?? existing.name,
                  description:
                    dto.description !== undefined
                      ? dto.description
                      : existing.description,
                  plan_type: nextPlanType as any,
                  state: (dto.state as any) ?? existing.state,
                  billing_cycle: pricing.billing_cycle as any,
                  base_price: price,
                  currency,
                  setup_fee: nextIsFree
                    ? null
                    : (dto.setup_fee ?? existing.setup_fee),
                  is_free: nextIsFree,
                  grace_period_soft_days:
                    dto.grace_period_soft_days ??
                    existing.grace_period_soft_days,
                  grace_period_hard_days:
                    dto.grace_period_hard_days ??
                    existing.grace_period_hard_days,
                  suspension_day: dto.suspension_day ?? existing.suspension_day,
                  cancellation_day:
                    dto.cancellation_day ?? existing.cancellation_day,
                  feature_matrix: (dto.feature_matrix ??
                    existing.feature_matrix) as any,
                  ai_feature_flags: (dto.ai_feature_flags ??
                    existing.ai_feature_flags) as any,
                  resellable: dto.resellable ?? existing.resellable,
                  max_partner_margin_pct:
                    dto.max_partner_margin_pct ??
                    existing.max_partner_margin_pct,
                  is_promotional: nextIsPromotional,
                  promo_rules: (dto.promo_rules ?? existing.promo_rules) as any,
                  promo_priority: dto.promo_priority ?? existing.promo_priority,
                  is_popular: dto.is_popular ?? existing.is_popular,
                  sort_order: dto.sort_order ?? existing.sort_order,
                  parent_plan_id: dto.parent_plan_id ?? existing.parent_plan_id,
                  details_md:
                    dto.details_md !== undefined
                      ? dto.details_md
                      : existing.details_md,
                  plan_group_code: groupCode,
                  is_default: false,
                  redemption_code: null,
                  updated_at: new Date(),
                },
              });
            }
          }

          // 2b. Cycles removed from the group: archive if referenced by any
          //     subscription, otherwise hard-delete. NEVER delete a referenced
          //     row (global rule 6 — no silent data loss).
          for (const row of groupRows) {
            if (wantedCycles.has(row.billing_cycle)) continue;
            const refs = await this.countSubscriptionRefs(tx, row.id);
            if (refs > 0) {
              await tx.subscription_plans.update({
                where: { id: row.id },
                data: {
                  state: 'archived',
                  archived_at: new Date(),
                  updated_at: new Date(),
                },
              });
            } else {
              await tx.subscription_plans.delete({ where: { id: row.id } });
            }
          }

          // 2c. Persist the @unique redemption_code on exactly ONE surviving row
          //     of the group: the canonical cycle (code === groupCode), or the
          //     cheapest survivor when that row was archived/deleted above. This
          //     path never reaches the legacy single-row write below, so without
          //     this the code sent by the form was silently dropped (returned
          //     null) for any multi-cycle plan.
          if (redemptionCode !== undefined) {
            const survivors = await tx.subscription_plans.findMany({
              where: { plan_group_code: groupCode, state: { not: 'archived' } },
            });
            const canonical =
              survivors.find((r) => r.code === groupCode) ??
              [...survivors].sort(
                (a, b) => Number(a.base_price) - Number(b.base_price),
              )[0];
            if (canonical) {
              // Clear siblings first so setting the canonical row never trips the
              // @unique constraint within its own group.
              await tx.subscription_plans.updateMany({
                where: {
                  plan_group_code: groupCode,
                  id: { not: canonical.id },
                },
                data: { redemption_code: null },
              });
              await tx.subscription_plans.update({
                where: { id: canonical.id },
                data: {
                  redemption_code: redemptionCode,
                  updated_at: new Date(),
                },
              });
            }
          }
        } else {
          // Legacy single-row path: per-cycle fields apply to the target row.
          await tx.subscription_plans.update({
            where: { id },
            data: {
              ...(dto.code && { code: dto.code }),
              ...(dto.billing_cycle && {
                billing_cycle: dto.billing_cycle as any,
              }),
              ...(nextIsFree
                ? { base_price: 0 }
                : dto.base_price !== undefined
                  ? { base_price: dto.base_price }
                  : {}),
              ...(dto.currency && { currency: dto.currency }),
              ...(dto.is_default !== undefined && {
                is_default: dto.is_default,
              }),
              ...(redemptionCode !== undefined && {
                redemption_code: redemptionCode,
              }),
              updated_at: new Date(),
            },
          });
        }

        return tx.subscription_plans.findMany({
          where: { plan_group_code: groupCode },
          orderBy: { base_price: 'asc' },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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
