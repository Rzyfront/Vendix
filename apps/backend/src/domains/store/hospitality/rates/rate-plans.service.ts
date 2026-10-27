import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateRatePlanDto, RatePriceDto, UpdateRatePlanDto } from './dto';
import { hasBasePrice, RatePriceRow } from './lodging-rate-resolver';

const PLAN_INCLUDE = {
  prices: {
    select: { id: true, unit_type_id: true, day_of_week: true, price: true },
    orderBy: [{ unit_type_id: 'asc' }, { day_of_week: 'asc' }],
  },
} satisfies Prisma.lodging_rate_plansInclude;

type RatesClient = Pick<StorePrismaService, 'lodging_rate_plans' | 'lodging_rate_prices'>;

export interface PlanPricing {
  plan: { id: number; name: string };
  prices: RatePriceRow[];
}

/**
 * Prices of one plan for one room type. Every filter names the store, so it
 * also works inside `$transaction` (where the client is not store-scoped).
 * `allowInactive` lets an already sold room keep its plan after the plan is
 * switched off (room changes reprice with it).
 */
export async function loadPlanPricing(
  client: RatesClient,
  store_id: number,
  rate_plan_id: number,
  unit_type: { id: number; name: string },
  allowInactive = false,
): Promise<PlanPricing> {
  const plan = await client.lodging_rate_plans.findFirst({
    where: { id: rate_plan_id, store_id },
    select: { id: true, name: true, is_active: true },
  });
  if (!plan) {
    throw new VendixHttpException(ErrorCodes.LODGING_RATE_PLAN_FIND_001);
  }
  if (!plan.is_active && !allowInactive) {
    throw new VendixHttpException(
      ErrorCodes.LODGING_RATE_PLAN_INACTIVE_001,
      `El plan ${plan.name} está inactivo`,
    );
  }
  const prices = await client.lodging_rate_prices.findMany({
    where: { store_id, rate_plan_id, unit_type_id: unit_type.id },
    select: { day_of_week: true, price: true },
  });
  if (!hasBasePrice(prices)) {
    throw new VendixHttpException(
      ErrorCodes.LODGING_RATE_PLAN_UNPRICED_001,
      `El plan ${plan.name} no tiene precio para ${unit_type.name}`,
    );
  }
  return { plan: { id: plan.id, name: plan.name }, prices };
}

/**
 * Checks the price rows of a plan: one base price per room type (required as
 * soon as the type has any row) and at most one price per weekday.
 */
export function assertValidPrices(prices: readonly RatePriceDto[]): void {
  const seen = new Set<string>();
  const withBase = new Set<number>();
  for (const row of prices) {
    const day = row.day_of_week ?? null;
    const key = `${row.unit_type_id}:${day ?? 'base'}`;
    if (seen.has(key)) {
      throw new VendixHttpException(ErrorCodes.LODGING_RATE_PLAN_PRICES_001);
    }
    seen.add(key);
    if (day === null) withBase.add(row.unit_type_id);
  }
  if (prices.some((row) => !withBase.has(row.unit_type_id))) {
    throw new VendixHttpException(ErrorCodes.LODGING_RATE_PLAN_PRICES_001);
  }
}

/**
 * Hospitality Suite (H2.1) — rate plans ("Solo alojamiento", "Con desayuno")
 * with a nightly price per room type and weekday. Saving a plan replaces its
 * price rows; sold nights keep their own snapshot, so edits never change
 * existing reservations. One plan per store is the default.
 */
@Injectable()
export class LodgingRatePlansService {
  constructor(private readonly prisma: StorePrismaService) {}

  findAll() {
    return this.prisma.lodging_rate_plans.findMany({
      include: PLAN_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: number) {
    const plan = await this.prisma.lodging_rate_plans.findFirst({
      where: { id },
      include: PLAN_INCLUDE,
    });
    if (!plan) {
      throw new VendixHttpException(ErrorCodes.LODGING_RATE_PLAN_FIND_001);
    }
    return plan;
  }

  /**
   * Active plans to choose when booking, with the room types each one prices
   * (a plan without price for a type is not offered for it). Default first.
   */
  async findSellable() {
    const plans = await this.prisma.lodging_rate_plans.findMany({
      where: { is_active: true },
      select: {
        id: true,
        name: true,
        meal_plan: true,
        is_default: true,
        prices: { where: { day_of_week: null }, select: { unit_type_id: true } },
      },
      orderBy: [{ is_default: 'desc' }, { sort_order: 'asc' }, { name: 'asc' }],
    });
    return plans.map(({ prices, ...plan }) => ({
      ...plan,
      unit_type_ids: prices.map((p) => p.unit_type_id),
    }));
  }

  async create(dto: CreateRatePlanDto) {
    const store_id = this.requireStoreId();
    assertValidPrices(dto.prices);
    await this.assertTypesInStore(dto.prices);
    const is_active = dto.is_active ?? true;
    const id = await this.save(store_id, async (tx, now) => {
      // The first active plan of the store becomes its default.
      const hasDefault = await tx.lodging_rate_plans.count({
        where: { store_id, is_default: true },
      });
      const is_default = is_active && (dto.is_default ?? hasDefault === 0);
      if (is_default) await this.clearDefault(tx, store_id, now);
      const plan = await tx.lodging_rate_plans.create({
        data: {
          store_id,
          name: dto.name,
          code: dto.code || null,
          meal_plan: dto.meal_plan ?? 'room_only',
          is_default,
          is_active,
          sort_order: dto.sort_order ?? 0,
          updated_at: now,
        },
      });
      await this.writePrices(tx, store_id, plan.id, dto.prices, now);
      return plan.id;
    });
    return this.findOne(id);
  }

  async update(id: number, dto: UpdateRatePlanDto) {
    const store_id = this.requireStoreId();
    const current = await this.findOne(id);
    if (dto.prices) {
      assertValidPrices(dto.prices);
      await this.assertTypesInStore(dto.prices);
    }
    const is_active = dto.is_active ?? current.is_active;
    // An inactive plan cannot stay the default.
    const is_default = is_active && (dto.is_default ?? current.is_default);
    await this.save(store_id, async (tx, now) => {
      if (is_default && !current.is_default) await this.clearDefault(tx, store_id, now);
      await tx.lodging_rate_plans.update({
        where: { id: current.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.code !== undefined ? { code: dto.code || null } : {}),
          ...(dto.meal_plan !== undefined ? { meal_plan: dto.meal_plan } : {}),
          ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
          is_active,
          is_default,
          updated_at: now,
        },
      });
      if (dto.prices) {
        await tx.lodging_rate_prices.deleteMany({
          where: { store_id, rate_plan_id: current.id },
        });
        await this.writePrices(tx, store_id, current.id, dto.prices, now);
      }
      return current.id;
    });
    return this.findOne(id);
  }

  /** Runs a plan write in a transaction; a duplicate name becomes a 409. */
  private async save(
    store_id: number,
    work: (tx: Prisma.TransactionClient, now: Date) => Promise<number>,
  ): Promise<number> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // One writer per store: the default flag and names stay consistent.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_rate_plans:${store_id}`}))`;
        return work(tx, new Date());
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.LODGING_RATE_PLAN_DUP_001);
      }
      throw error;
    }
  }

  private clearDefault(tx: Prisma.TransactionClient, store_id: number, now: Date) {
    return tx.lodging_rate_plans.updateMany({
      where: { store_id, is_default: true },
      data: { is_default: false, updated_at: now },
    });
  }

  private async writePrices(
    tx: Prisma.TransactionClient,
    store_id: number,
    rate_plan_id: number,
    prices: readonly RatePriceDto[],
    now: Date,
  ) {
    if (prices.length === 0) return;
    await tx.lodging_rate_prices.createMany({
      data: prices.map((row) => ({
        store_id,
        rate_plan_id,
        unit_type_id: row.unit_type_id,
        day_of_week: row.day_of_week ?? null,
        price: new Prisma.Decimal(row.price),
        updated_at: now,
      })),
    });
  }

  /** Every priced room type must belong to the store (scoped lookup). */
  private async assertTypesInStore(prices: readonly RatePriceDto[]) {
    const ids = [...new Set(prices.map((row) => row.unit_type_id))];
    if (ids.length === 0) return;
    const found = await this.prisma.lodging_unit_types.count({ where: { id: { in: ids } } });
    if (found !== ids.length) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);
    }
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}
