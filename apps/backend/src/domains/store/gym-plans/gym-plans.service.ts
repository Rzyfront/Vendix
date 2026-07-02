import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateGymPlanDto, UpdateGymPlanDto, GymPlanQueryDto } from './dto';

/**
 * GymPlansService
 *
 * Store-scoped CRUD for gym membership plans (`gym_plans`). A plan is a dynamic
 * tariff: price (base value, without tax), billing period (`duration_days`),
 * optional per-period access/class caps, optional feature flags, and an
 * optional backing catalog product used at renewal/checkout.
 *
 * Tenant scope:
 *   The `gym_plans` model is registered in `store_scoped_models` but the public
 *   scoped getter is not yet exposed on `StorePrismaService`. Until that getter
 *   exists, this service reaches the base client via `withoutScope()` and adds
 *   an EXPLICIT `store_id` predicate to every read/write so cross-store access
 *   is impossible. Once `get gym_plans()` is added to `StorePrismaService`,
 *   switch `this.gymPlans`/`this.gymMemberships` to the auto-scoped client and
 *   drop the manual `store_id` filters. See final report / blocker note.
 */
@Injectable()
export class GymPlansService {
  constructor(private prisma: StorePrismaService) {}

  // ------------------------------------------------------------------ Helpers

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  /** Base-client delegate for gym_plans (manual store_id scoping applies). */
  private get gymPlans() {
    return this.prisma.withoutScope().gym_plans;
  }

  /** Base-client delegate for gym_memberships (referential integrity checks). */
  private get gymMemberships() {
    return this.prisma.withoutScope().gym_memberships;
  }

  // ------------------------------------------------------------------ CRUD

  async create(dto: CreateGymPlanDto) {
    const storeId = this.requireStoreId();

    // Unique (store_id, code).
    const dup = await this.gymPlans.findFirst({
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
      return await this.gymPlans.create({
        data: {
          store_id: storeId,
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          price: new Prisma.Decimal(dto.price ?? 0),
          currency: dto.currency ?? 'COP',
          duration_days: dto.duration_days ?? 30,
          access_limit_per_period: dto.access_limit_per_period ?? null,
          class_limit_per_period: dto.class_limit_per_period ?? null,
          features: dto.features ?? Prisma.JsonNull,
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

  async findAll(query: GymPlanQueryDto) {
    const storeId = this.requireStoreId();
    const { page = 1, limit = 10, search, is_active } = query ?? {};
    const skip = (page - 1) * limit;

    const where: Prisma.gym_plansWhereInput = {
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
      this.gymPlans.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ sort_order: 'asc' }, { id: 'desc' }],
      }),
      this.gymPlans.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number) {
    const storeId = this.requireStoreId();
    const plan = await this.gymPlans.findFirst({
      where: { id, store_id: storeId },
    });
    if (!plan) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Plan de gimnasio no encontrado',
      );
    }
    return plan;
  }

  async update(id: number, dto: UpdateGymPlanDto) {
    const storeId = this.requireStoreId();
    const existing = await this.findOne(id);

    // Re-check uniqueness only when the code actually changes.
    if (dto.code !== undefined && dto.code !== existing.code) {
      const dup = await this.gymPlans.findFirst({
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

    const data: Prisma.gym_plansUpdateInput = {
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.price !== undefined && { price: new Prisma.Decimal(dto.price) }),
      ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.duration_days !== undefined && {
        duration_days: dto.duration_days,
      }),
      ...(dto.access_limit_per_period !== undefined && {
        access_limit_per_period: dto.access_limit_per_period,
      }),
      ...(dto.class_limit_per_period !== undefined && {
        class_limit_per_period: dto.class_limit_per_period,
      }),
      ...(dto.features !== undefined && { features: dto.features }),
      ...(dto.product_id !== undefined && { product_id: dto.product_id }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
    };

    // Guarded write: tenant filter kept in the predicate via updateMany.
    await this.gymPlans.updateMany({ where: { id, store_id: storeId }, data });
    return this.findOne(id);
  }

  /**
   * Delete a plan. Soft-delete (`is_active=false`) when memberships reference
   * it; hard-delete only when no membership points to the plan.
   */
  async remove(id: number) {
    const storeId = this.requireStoreId();
    await this.findOne(id);

    const referencing = await this.gymMemberships.count({
      where: { store_id: storeId, gym_plan_id: id },
    });

    if (referencing > 0) {
      await this.gymPlans.updateMany({
        where: { id, store_id: storeId },
        data: { is_active: false },
      });
      return {
        deleted: false,
        deactivated: true,
        referencing_memberships: referencing,
      };
    }

    await this.gymPlans.deleteMany({ where: { id, store_id: storeId } });
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
