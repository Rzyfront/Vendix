import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { ProviderScheduleItemDto } from './dto/upsert-provider-schedule.dto';
import { CreateProviderExceptionDto } from './dto/create-provider-exception.dto';

@Injectable()
export class ProviderScheduleService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getSchedule(providerId: number) {
    return this.prisma.provider_schedules.findMany({
      where: { provider_id: providerId },
      orderBy: { day_of_week: 'asc' },
    });
  }

  async upsertSchedule(providerId: number, items: ProviderScheduleItemDto[]) {
    // Validate provider exists
    const provider = await this.prisma.service_providers.findFirst({
      where: { id: providerId },
    });

    if (!provider) {
      throw new NotFoundException(`Proveedor #${providerId} no encontrado`);
    }

    return this.prisma.$transaction(async (tx: any) => {
      // Delete existing schedules
      await tx.provider_schedules.deleteMany({
        where: { provider_id: providerId },
      });

      // Create new schedules
      if (items.length > 0) {
        await tx.provider_schedules.createMany({
          data: items.map((item) => ({
            provider_id: providerId,
            day_of_week: item.day_of_week,
            start_time: item.start_time,
            end_time: item.end_time,
            is_active: item.is_active ?? true,
          })),
        });
      }

      return tx.provider_schedules.findMany({
        where: { provider_id: providerId },
        orderBy: { day_of_week: 'asc' },
      });
    });
  }

  async getExceptions(providerId: number, dateFrom?: string, dateTo?: string) {
    const where: any = { provider_id: providerId };

    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(dateFrom);
      if (dateTo) where.date.lte = new Date(dateTo);
    }

    return this.prisma.provider_exceptions.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async createException(providerId: number, dto: CreateProviderExceptionDto) {
    const provider = await this.prisma.service_providers.findFirst({
      where: { id: providerId },
    });

    if (!provider) {
      throw new NotFoundException(`Proveedor #${providerId} no encontrado`);
    }

    return this.prisma.provider_exceptions.create({
      data: {
        provider_id: providerId,
        date: new Date(dto.date),
        is_unavailable: dto.is_unavailable ?? true,
        custom_start_time: dto.custom_start_time,
        custom_end_time: dto.custom_end_time,
        reason: dto.reason,
      },
    });
  }

  async deleteException(exceptionId: number) {
    const exception = await this.prisma.provider_exceptions.findFirst({
      where: { id: exceptionId },
    });

    if (!exception) {
      throw new NotFoundException(`Excepcion #${exceptionId} no encontrada`);
    }

    await this.prisma.provider_exceptions.delete({
      where: { id: exceptionId },
    });
  }
}
