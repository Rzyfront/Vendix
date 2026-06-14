import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { UpdateCashRegisterDto } from './dto/update-cash-register.dto';

@Injectable()
export class CashRegistersService {
  constructor(private readonly prisma: StorePrismaService) {}

  private get storeId(): number {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  /**
   * Defense-in-depth: ensure the warehouse override belongs to the current
   * store. The FK to inventory_locations does not guarantee store isolation
   * (a malicious or buggy payload could reference another store's warehouse).
   */
  private async assertLocationBelongsToStore(
    location_id: number,
  ): Promise<void> {
    const location = await this.prisma.inventory_locations.findFirst({
      where: { id: location_id, store_id: this.storeId },
      select: { id: true },
    });
    if (!location) {
      throw new VendixHttpException(
        ErrorCodes.INV_LOC_001,
        'Bodega no encontrada para esta tienda',
      );
    }
  }

  async findAll() {
    return this.prisma.cash_registers.findMany({
      where: { is_active: true },
      include: {
        location: { select: { id: true, name: true, is_default: true } },
        sessions: {
          where: { status: 'open' },
          include: {
            opened_by_user: {
              select: { id: true, first_name: true, last_name: true },
            },
          },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const register = await this.prisma.cash_registers.findFirst({
      where: { id },
      include: {
        location: { select: { id: true, name: true, is_default: true } },
        sessions: {
          where: { status: 'open' },
          include: {
            opened_by_user: {
              select: { id: true, first_name: true, last_name: true },
            },
          },
          take: 1,
        },
      },
    });

    if (!register) {
      throw new NotFoundException('Caja registradora no encontrada');
    }

    return register;
  }

  async create(dto: CreateCashRegisterDto) {
    // Check unique code constraint
    const existing = await this.prisma.cash_registers.findFirst({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe una caja registradora con el código "${dto.code}"`,
      );
    }

    // Validate warehouse override belongs to this store (multi-tenant guard)
    if (dto.location_id != null) {
      await this.assertLocationBelongsToStore(dto.location_id);
    }

    return this.prisma.cash_registers.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        is_active: dto.is_active ?? true,
        default_opening_amount: dto.default_opening_amount,
        location_id: dto.location_id ?? null,
      },
    });
  }

  async update(id: number, dto: UpdateCashRegisterDto) {
    await this.findOne(id);

    if (dto.code) {
      const existing = await this.prisma.cash_registers.findFirst({
        where: { code: dto.code, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException(
          `Ya existe una caja registradora con el código "${dto.code}"`,
        );
      }
    }

    // Validate warehouse override belongs to this store (multi-tenant guard)
    if (dto.location_id != null) {
      await this.assertLocationBelongsToStore(dto.location_id);
    }

    const updated = await this.prisma.cash_registers.updateMany({
      where: { id },
      data: dto,
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Caja registradora no encontrada');
    }

    return this.findOne(id);
  }

  async remove(id: number) {
    await this.findOne(id);

    // Soft delete — deactivate instead of deleting
    const updated = await this.prisma.cash_registers.updateMany({
      where: { id },
      data: { is_active: false },
    });
    if (updated.count !== 1) {
      throw new NotFoundException('Caja registradora no encontrada');
    }

    return this.findOne(id);
  }
}
