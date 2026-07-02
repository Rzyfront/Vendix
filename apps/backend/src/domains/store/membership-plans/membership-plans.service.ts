import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateMembershipPlanDto,
  UpdateMembershipPlanDto,
  MembershipPlanQueryDto,
} from './dto';

/**
 * MembershipPlansService
 *
 * Store-scoped CRUD for membership plans (`membership_plans`). A plan is a
 * dynamic tariff: price (base value, without tax), billing period
 * (`duration_days`), optional feature flags, and an optional backing catalog
 * product used at renewal/checkout.
 *
 * Per-period caps (`access_limit_per_period`, `class_limit_per_period`) are NOT
 * dedicated columns — they live inside the `features` Json blob so any industry
 * can carry its own limits without a schema change. The DTO still accepts them
 * as flat fields for convenience and the service folds them into `features`.
 *
 * Tenant scope:
 *   The `membership_plans` model is registered in `store_scoped_models`. This
 *   service reaches the base client via `withoutScope()` and adds an EXPLICIT
 *   `store_id` predicate to every read/write so cross-store access is
 *   impossible.
 */
@Injectable()
export class MembershipPlansService {
  constructor(private prisma: StorePrismaService) {}

  // ------------------------------------------------------------------ Helpers

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  /** Base-client delegate for membership_plans (manual store_id scoping applies). */
  private get membershipPlans() {
    return this.prisma.withoutScope().membership_plans;
  }

  /** Base-client delegate for memberships (referential integrity checks). */
  private get memberships() {
    return this.prisma.withoutScope().memberships;
  }

  /**
   * Fold the flat per-period caps into the `features` Json blob. Returns a plain
   * object suitable for a Prisma Json write, or `Prisma.JsonNull` when there is
   * nothing to persist. `base` seeds the merge (existing features on update).
   */
  private buildFeatures(
    dto: { features?: Record<string, any>; access_limit_per_period?: number; class_limit_per_period?: number },
    base?: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    const seed =
      dto.features !== undefined
        ? { ...(dto.features ?? {}) }
        : base && typeof base === 'object' && !Array.isArray(base)
          ? { ...(base as Record<string, any>) }
          : {};
    if (dto.access_limit_per_period !== undefined) {
      seed['access_limit_per_period'] = dto.access_limit_per_period;
    }
    if (dto.class_limit_per_period !== undefined) {
      seed['class_limit_per_period'] = dto.class_limit_per_period;
    }
    return Object.keys(seed).length > 0
      ? (seed as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  }

  // ------------------------------------------------------------------ CRUD

  async create(dto: CreateMembershipPlanDto) {
    const storeId = this.requireStoreId();

    // Unique (store_id, code).
    const dup = await this.membershipPlans.findFirst({
      where: { store_id: storeId, code: dto.code },
      select: { id: true },
    });
    if (dup) {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        `Ya existe un plan con el código "${dto.code}" en esta tienda`,
      );
    }

    // Optional backing product must belong to the same store.
    if (dto.product_id != null) {
      await this.assertProductInStore(dto.product_id, storeId);
    }

    try {
      return await this.membershipPlans.create({
        data: {
          store_id: storeId,
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          price: new Prisma.Decimal(dto.price ?? 0),
          currency: dto.currency ?? 'COP',
          duration_days: dto.duration_days ?? 30,
          features: this.buildFeatures(dto),
          product_id: dto.product_id ?? null,
          is_active: dto.is_active ?? true,
          sort_order: dto.sort_order ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `Ya existe un plan con el código "${dto.code}" en esta tienda`,
        );
      }
      throw error;
    }
  }

  async findAll(query: MembershipPlanQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 10, search, is_active } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.membership_plansWhereInput = {
      store_id: storeId,
      ...(is_active !== undefined && { is_active }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      this.membershipPlans.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sort_order: 'asc' }, { id: 'desc' }],
      }),
      this.membershipPlans.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const storeId = this.requireStoreId();
    const plan = await this.membershipPlans.findFirst({
      where: { id, store_id: storeId },
    });
    if (!plan) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Plan de membresía no encontrado',
      );
    }
    return plan;
  }

  async update(id: number, dto: UpdateMembershipPlanDto) {
    const storeId = this.requireStoreId();
    const existing = await this.findOne(id);

    // Re-check uniqueness only when the code actually changes.
    if (dto.code !== undefined && dto.code !== existing.code) {
      const dup = await this.membershipPlans.findFirst({
        where: { store_id: storeId, code: dto.code, id: { not: id } },
        select: { id: true },
      });
      if (dup) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `Ya existe un plan con el código "${dto.code}" en esta tienda`,
        );
      }
    }

    if (dto.product_id != null && dto.product_id !== existing.product_id) {
      await this.assertProductInStore(dto.product_id, storeId);
    }

    // Per-period caps + free-form features all live in the `features` Json.
    // Recompute only when any of them is provided, merging onto the existing
    // blob so a partial update never clobbers unrelated feature keys.
    const featuresChanged =
      dto.features !== undefined ||
      dto.access_limit_per_period !== undefined ||
      dto.class_limit_per_period !== undefined;
    const featuresUpdate = featuresChanged
      ? this.buildFeatures(dto, existing.features)
      : undefined;

    const data: Prisma.membership_plansUpdateInput = {
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.price !== undefined && { price: new Prisma.Decimal(dto.price) }),
      ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.duration_days !== undefined && {
        duration_days: dto.duration_days,
      }),
      ...(featuresUpdate !== undefined && { features: featuresUpdate }),
      ...(dto.product_id !== undefined && { product_id: dto.product_id }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
    };

    // Guarded write: tenant filter kept in the predicate via updateMany.
    await this.membershipPlans.updateMany({ where: { id, store_id: storeId }, data });
    return this.findOne(id);
  }

  /**
   * Delete a plan. Soft-delete (`is_active=false`) when memberships reference
   * it; hard-delete only when no membership points to the plan.
   */
  async remove(id: number) {
    const storeId = this.requireStoreId();
    await this.findOne(id);

    const referencing = await this.memberships.count({
      where: { store_id: storeId, plan_id: id },
    });

    if (referencing > 0) {
      await this.membershipPlans.updateMany({
        where: { id, store_id: storeId },
        data: { is_active: false },
      });
      return {
        deleted: false,
        deactivated: true,
        referencing_memberships: referencing,
      };
    }

    await this.membershipPlans.deleteMany({ where: { id, store_id: storeId } });
    return { deleted: true, deactivated: false, referencing_memberships: 0 };
  }

  // ------------------------------------------------------------------ Internals

  private async assertProductInStore(productId: number, storeId: number) {
    const product = await this.prisma.withoutScope().products.findFirst({
      where: { id: productId, store_id: storeId },
      select: { id: true },
    });
    if (!product) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El producto asociado al plan no existe en esta tienda',
      );
    }
  }
}
