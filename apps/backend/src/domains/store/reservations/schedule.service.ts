import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ScheduleItemDto, CreateExceptionDto } from './dto';

@Injectable()
export class ScheduleService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Obtiene los horarios activos de un servicio/producto
   */
  async getSchedulesForService(product_id: number) {
    return this.prisma.service_schedules.findMany({
      where: { product_id, is_active: true },
      orderBy: { day_of_week: 'asc' },
    });
  }

  /**
   * Upsert masivo del horario semanal de un servicio.
   * Elimina los horarios existentes y crea los nuevos en una transaccion.
   */
  async upsertSchedule(product_id: number, items: ScheduleItemDto[]) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    return this.prisma.$transaction(async (tx) => {
      // Eliminar horarios existentes para este producto
      await tx.service_schedules.deleteMany({
        where: { product_id, store_id },
      });

      // Crear nuevos horarios
      const schedules = items.map((item) => ({
        store_id: store_id!,
        product_id,
        day_of_week: item.day_of_week,
        start_time: item.start_time,
        end_time: item.end_time,
        slot_duration_minutes: item.slot_duration_minutes,
        capacity: item.capacity ?? 1,
        buffer_minutes: item.buffer_minutes ?? 0,
        is_active: item.is_active ?? true,
      }));

      return tx.service_schedules.createMany({ data: schedules });
    });
  }

  /**
   * Obtiene las excepciones de horario de un servicio en un rango de fechas
   */
  async getExceptions(
    product_id?: number,
    date_from?: string,
    date_to?: string,
  ) {
    const where: any = {};
    if (product_id) where.product_id = product_id;
    if (date_from || date_to) {
      where.date = {};
      if (date_from) where.date.gte = new Date(date_from);
      if (date_to) where.date.lte = new Date(date_to);
    }

    return this.prisma.schedule_exceptions.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Crea una excepcion de horario (dia festivo, horario especial, etc.)
   */
  async createException(dto: CreateExceptionDto) {
    const context = RequestContextService.getContext();

    return this.prisma.schedule_exceptions.create({
      data: {
        store_id: context!.store_id!,
        product_id: dto.product_id,
        date: new Date(dto.date),
        is_closed: dto.is_closed ?? false,
        custom_start_time: dto.custom_start_time,
        custom_end_time: dto.custom_end_time,
        custom_capacity: dto.custom_capacity,
        reason: dto.reason,
      },
    });
  }

  /**
   * Elimina una excepcion de horario
   */
  async deleteException(id: number) {
    return this.prisma.schedule_exceptions.delete({ where: { id } });
  }
}
