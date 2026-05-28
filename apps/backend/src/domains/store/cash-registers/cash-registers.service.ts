import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { UpdateCashRegisterDto } from './dto/update-cash-register.dto';

@Injectable()
export class CashRegistersService {
  constructor(private readonly prisma: StorePrismaService) {}

  async findAll() {
    return this.prisma.cash_registers.findMany({
      where: { is_active: true },
      include: {
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

    return this.prisma.cash_registers.create({
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        is_active: dto.is_active ?? true,
        default_opening_amount: dto.default_opening_amount,
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
