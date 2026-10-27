import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateUnitDto, CreateUnitsBulkDto, UpdateUnitDto } from './dto';

const UNIT_INCLUDE = {
  unit_type: { select: { id: true, name: true } },
} satisfies Prisma.lodging_unitsInclude;

/** H6.1 — the iCal feed secret is only shown under Canales (channels:manage). */
const UNIT_OMIT = { ical_export_token: true } satisfies Prisma.lodging_unitsOmit;

/**
 * Hospitality Suite (H0.3) — physical rooms. Each room belongs to one room
 * type; active rooms are the sellable inventory counted on the type. Room
 * numbers are unique per store, case-insensitive.
 */
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async findAll(unit_type_id?: number) {
    return this.prisma.lodging_units.findMany({
      where: unit_type_id ? { unit_type_id } : undefined,
      include: UNIT_INCLUDE,
      omit: UNIT_OMIT,
      orderBy: [{ code: 'asc' }],
    });
  }

  async findOne(id: number) {
    const unit = await this.prisma.lodging_units.findFirst({
      where: { id },
      include: UNIT_INCLUDE,
      omit: UNIT_OMIT,
    });
    if (!unit) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);
    }
    return unit;
  }

  async create(dto: CreateUnitDto) {
    const [unit] = await this.createMany([dto.code], dto);
    return unit;
  }

  async createBulk(dto: CreateUnitsBulkDto) {
    return this.createMany(dto.codes, dto);
  }

  async update(id: number, dto: UpdateUnitDto) {
    const current = await this.findOne(id);
    if (dto.unit_type_id !== undefined && dto.unit_type_id !== current.unit_type_id) {
      await this.assertUnitTypeExists(dto.unit_type_id);
    }
    if (dto.code !== undefined && dto.code !== current.code) {
      await this.assertCodesAvailable([dto.code], id);
    }
    try {
      await this.prisma.lodging_units.update({
        where: { id },
        data: {
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.unit_type_id !== undefined && { unit_type_id: dto.unit_type_id }),
          ...(dto.floor !== undefined && { floor: dto.floor || null }),
          ...(dto.zone !== undefined && { zone: dto.zone || null }),
          ...(dto.is_active !== undefined && { is_active: dto.is_active }),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
    return this.findOne(id);
  }

  private async createMany(
    rawCodes: string[],
    common: { unit_type_id: number; floor?: string; zone?: string },
  ) {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const codes = rawCodes.map((c) => c.trim());
    const lowered = codes.map((c) => c.toLowerCase());
    if (new Set(lowered).size !== lowered.length) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_DUP_001);
    }
    await this.assertUnitTypeExists(common.unit_type_id);
    await this.assertCodesAvailable(codes);

    const now = new Date();
    try {
      await this.prisma.lodging_units.createMany({
        data: codes.map((code) => ({
          store_id,
          unit_type_id: common.unit_type_id,
          code,
          floor: common.floor || null,
          zone: common.zone || null,
          updated_at: now,
        })),
      });
    } catch (error) {
      throw this.mapUniqueViolation(error);
    }
    return this.prisma.lodging_units.findMany({
      where: { code: { in: codes } },
      include: UNIT_INCLUDE,
      omit: UNIT_OMIT,
      orderBy: [{ code: 'asc' }],
    });
  }

  private async assertUnitTypeExists(unit_type_id: number) {
    const unitType = await this.prisma.lodging_unit_types.findFirst({
      where: { id: unit_type_id },
      select: { id: true },
    });
    if (!unitType) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_TYPE_FIND_001);
    }
  }

  private async assertCodesAvailable(codes: string[], excludeId?: number) {
    const existing = await this.prisma.lodging_units.findMany({
      where: {
        OR: codes.map((code) => ({
          code: { equals: code, mode: 'insensitive' as const },
        })),
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { code: true },
    });
    if (existing.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_UNIT_DUP_001,
        codes.length > 1
          ? `Ya existe una habitación con ese número: ${existing.map((u) => u.code).join(', ')}`
          : undefined,
      );
    }
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new VendixHttpException(ErrorCodes.LODGING_UNIT_DUP_001);
    }
    return error;
  }
}
