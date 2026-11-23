import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  CreateManufacturingPlantDto,
  ManufacturingPlantManagersQueryDto,
  ManufacturingPlantQueryDto,
  UpdateManufacturingPlantDto,
} from '../dto';

/** Orders still waiting for (or in) production: they block deactivating their plant. */
export const OPEN_ORDER_STATUSES = [
  'draft',
  'released',
  'in_progress',
  'partially_completed',
] as const;

const PLANT_INCLUDE = {
  input_location: { select: { id: true, name: true, code: true } },
  output_location: { select: { id: true, name: true, code: true } },
  manager: { select: { id: true, first_name: true, last_name: true } },
} satisfies Prisma.manufacturing_plantsInclude;

/** Staff only: a user whose only role is `customer` is never a plant manager. */
const STAFF_USER_WHERE = {
  state: 'active',
  user_roles: { some: { roles: { name: { not: 'customer' } } } },
} satisfies Prisma.usersWhereInput;

/**
 * QUI-1013 — production plants of the store. Each plant consumes inputs from
 * its input location and puts finished goods into its output location. Plants
 * are deactivated, never deleted. The "main" plant is the active one with the
 * lowest id (the plant the migration made from the old single configuration).
 */
@Injectable()
export class ManufacturingPlantsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  // ------------------------------------------------------------------- read
  async findAll(query?: ManufacturingPlantQueryDto) {
    this.requireStoreId();
    const plants = await this.prisma.manufacturing_plants.findMany({
      where: query?.include_inactive ? {} : { is_active: true },
      orderBy: { id: 'asc' },
      include: PLANT_INCLUDE,
    });
    const mainId = plants.find((p) => p.is_active)?.id ?? null;
    return plants.map((p) => ({ ...p, is_main: p.id === mainId }));
  }

  async findOne(id: number) {
    this.requireStoreId();
    const plant = await this.prisma.manufacturing_plants.findFirst({
      where: { id },
      include: PLANT_INCLUDE,
    });
    if (!plant) throw new VendixHttpException(ErrorCodes.MFG_PLANT_NOT_FOUND);
    return plant;
  }

  /** Active staff of the store for the "Responsable" picker. */
  async managers(query?: ManufacturingPlantManagersQueryDto) {
    this.requireStoreId();
    const search = query?.search?.trim();
    const rows = await this.prisma.store_users.findMany({
      where: {
        user: {
          ...STAFF_USER_WHERE,
          ...(search && {
            OR: [
              { first_name: { contains: search, mode: 'insensitive' } },
              { last_name: { contains: search, mode: 'insensitive' } },
            ],
          }),
        },
      },
      select: { user: { select: { id: true, first_name: true, last_name: true } } },
      take: query?.limit ?? 50,
      orderBy: { user: { first_name: 'asc' } },
    });
    // store_users is unique per (store, user): one row per person.
    return rows.map((r) => r.user);
  }

  // ------------------------------------------------------------- validation
  private async assertLocation(location_id: number | null | undefined): Promise<void> {
    if (location_id == null) return;
    const location = await this.prisma.inventory_locations.findFirst({
      where: { id: location_id },
      select: { id: true },
    });
    if (!location) throw new VendixHttpException(ErrorCodes.MFG_INVALID_LOCATION);
  }

  private async assertManager(user_id: number | null | undefined): Promise<void> {
    if (user_id == null) return;
    const member = await this.prisma.store_users.findFirst({
      where: { user_id, user: STAFF_USER_WHERE },
      select: { id: true },
    });
    if (!member) throw new VendixHttpException(ErrorCodes.MFG_PLANT_INVALID_MANAGER);
  }

  /** Names are unique per store, case-insensitively (the DB index is case-sensitive). */
  private async assertUniqueName(name: string, exceptId?: number): Promise<void> {
    const clash = await this.prisma.manufacturing_plants.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId != null && { NOT: { id: exceptId } }),
      },
      select: { id: true },
    });
    if (clash) throw new VendixHttpException(ErrorCodes.MFG_PLANT_NAME_DUPLICATE);
  }

  private rethrowDuplicate(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new VendixHttpException(ErrorCodes.MFG_PLANT_NAME_DUPLICATE);
    }
    throw error;
  }

  // ----------------------------------------------------------------- write
  async create(dto: CreateManufacturingPlantDto) {
    const store_id = this.requireStoreId();
    await this.assertUniqueName(dto.name);
    await this.assertLocation(dto.input_location_id);
    await this.assertLocation(dto.output_location_id);
    await this.assertManager(dto.manager_user_id);

    try {
      const created = await this.prisma.manufacturing_plants.create({
        data: {
          store_id,
          name: dto.name,
          input_location_id: dto.input_location_id,
          output_location_id: dto.output_location_id,
          manager_user_id: dto.manager_user_id ?? null,
          is_active: true,
        },
        select: { id: true },
      });
      return this.findOne(created.id);
    } catch (error) {
      this.rethrowDuplicate(error);
    }
  }

  async update(id: number, dto: UpdateManufacturingPlantDto) {
    this.requireStoreId();
    const plant = await this.findOne(id);
    if (dto.name !== undefined) await this.assertUniqueName(dto.name, id);
    await this.assertLocation(dto.input_location_id);
    await this.assertLocation(dto.output_location_id);
    await this.assertManager(dto.manager_user_id);

    if (dto.is_active === false && plant.is_active) {
      const open = await this.prisma.production_orders.count({
        where: { plant_id: id, status: { in: [...OPEN_ORDER_STATUSES] } },
      });
      if (open > 0) {
        throw new VendixHttpException(ErrorCodes.MFG_PLANT_HAS_OPEN_ORDERS, undefined, {
          open_orders: open,
        });
      }
    }

    try {
      // updateMany: scope-safe write (the store filter joins the WHERE).
      await this.prisma.manufacturing_plants.updateMany({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.input_location_id !== undefined && {
            input_location_id: dto.input_location_id,
          }),
          ...(dto.output_location_id !== undefined && {
            output_location_id: dto.output_location_id,
          }),
          ...(dto.manager_user_id !== undefined && {
            manager_user_id: dto.manager_user_id,
          }),
          ...(dto.is_active !== undefined && { is_active: dto.is_active }),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      this.rethrowDuplicate(error);
    }
    return this.findOne(id);
  }

  // ------------------------------------------------------ order assignment
  /**
   * Plant of a new (or edited) manufacturing order:
   * - explicit `plant_id` → must exist in the store and be active;
   * - none and exactly one active plant → that plant (no extra step);
   * - none and no plant → `null` (store keeps today's settings defaults);
   * - none and several active plants → `MFG_PLANT_REQUIRED`.
   */
  async resolveForOrder(plant_id?: number | null): Promise<number | null> {
    this.requireStoreId();
    if (plant_id != null) {
      const plant = await this.prisma.manufacturing_plants.findFirst({
        where: { id: plant_id },
        select: { id: true, is_active: true },
      });
      if (!plant) throw new VendixHttpException(ErrorCodes.MFG_PLANT_NOT_FOUND);
      if (!plant.is_active) throw new VendixHttpException(ErrorCodes.MFG_PLANT_INACTIVE);
      return plant.id;
    }
    const active = await this.prisma.manufacturing_plants.findMany({
      where: { is_active: true },
      orderBy: { id: 'asc' },
      select: { id: true },
      take: 2,
    });
    if (active.length === 0) return null;
    if (active.length === 1) return active[0].id;
    throw new VendixHttpException(ErrorCodes.MFG_PLANT_REQUIRED);
  }
}
