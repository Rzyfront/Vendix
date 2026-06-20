import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { CreateVehicleDto } from './dto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  private getStoreId(): number {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  async create(dto: CreateVehicleDto) {
    const store_id = this.getStoreId();
    const user_id = RequestContextService.getContext()?.user_id;

    let attempts = 0;
    while (true) {
      try {
        return await this.prisma.vehicles.create({
          data: {
            store_id,
            plate: dto.plate.toUpperCase(),
            type: dto.type,
            brand: dto.brand,
            model_name: dto.model_name,
            capacity_kg: dto.capacity_kg,
            capacity_units: dto.capacity_units,
            primary_driver_id: dto.primary_driver_id,
            is_active: dto.is_active ?? true,
            notes: dto.notes,
            created_by_user_id: user_id,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          attempts++;
          if (attempts >= 3) {
            throw new ConflictException(
              `Ya existe un vehículo con la placa ${dto.plate} en esta tienda`,
            );
          }
          continue;
        }
        throw error;
      }
    }
  }

  async findAll(query: { page?: number; limit?: number; search?: string; is_active?: boolean }) {
    const store_id = this.getStoreId();
    const { page = 1, limit = 10, search, is_active } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.vehiclesWhereInput = {
      store_id,
      ...(search && {
        OR: [
          { plate: { contains: search, mode: 'insensitive' as any } },
          { brand: { contains: search, mode: 'insensitive' as any } },
          { model_name: { contains: search, mode: 'insensitive' as any } },
        ],
      }),
      ...(is_active !== undefined && { is_active }),
    };

    const [data, total] = await Promise.all([
      this.prisma.vehicles.findMany({
        where,
        skip,
        take: limit,
        orderBy: { plate: 'asc' },
        include: {
          primary_driver: {
            select: { id: true, first_name: true, last_name: true },
          },
        },
      }),
      this.prisma.vehicles.count({ where }),
    ]);

    return { data, pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: number) {
    const store_id = this.getStoreId();
    const vehicle = await this.prisma.vehicles.findFirst({
      where: { id, store_id },
      include: {
        primary_driver: {
          select: { id: true, first_name: true, last_name: true },
        },
      },
    });
    if (!vehicle) throw new NotFoundException(`Vehículo #${id} no encontrado`);
    return vehicle;
  }

  async update(id: number, dto: Partial<CreateVehicleDto>) {
    const store_id = this.getStoreId();
    const vehicle = await this.prisma.vehicles.findFirst({
      where: { id, store_id },
    });
    if (!vehicle) throw new NotFoundException(`Vehículo #${id} no encontrado`);

    return this.prisma.vehicles.update({
      where: { id },
      data: {
        ...(dto.plate && { plate: dto.plate.toUpperCase() }),
        ...(dto.type && { type: dto.type }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.model_name !== undefined && { model_name: dto.model_name }),
        ...(dto.capacity_kg !== undefined && { capacity_kg: dto.capacity_kg }),
        ...(dto.capacity_units !== undefined && { capacity_units: dto.capacity_units }),
        ...(dto.primary_driver_id !== undefined && { primary_driver_id: dto.primary_driver_id }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        updated_at: new Date(),
      },
    });
  }

  async remove(id: number) {
    const store_id = this.getStoreId();
    const vehicle = await this.prisma.vehicles.findFirst({
      where: { id, store_id },
    });
    if (!vehicle) throw new NotFoundException(`Vehículo #${id} no encontrado`);

    // Check if vehicle is used in any non-draft route
    const in_use = await this.prisma.dispatch_routes.count({
      where: { vehicle_id: id, status: { not: 'voided' } },
    });
    if (in_use > 0) {
      throw new BadRequestException(
        `El vehículo está en uso en ${in_use} planilla(s). Marca como inactivo en su lugar.`,
      );
    }
    await this.prisma.vehicles.delete({ where: { id } });
    return { id, deleted: true };
  }
}
