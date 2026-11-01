import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  ProviderScheduleItemDto,
  SCHEDULE_TIME_PATTERN,
} from './dto/upsert-provider-schedule.dto';
import { CreateProviderExceptionDto } from './dto/create-provider-exception.dto';

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

@Injectable()
export class ProviderScheduleService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getSchedule(providerId: number) {
    return this.prisma.provider_schedules.findMany({
      where: { provider_id: providerId },
      orderBy: [{ day_of_week: 'asc' }, { block_order: 'asc' }],
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

    // Validate + normalize BEFORE touching the DB: an invalid payload
    // fails with 400 while the current schedule stays intact (QUI-968).
    const rows = this.normalizeScheduleItems(items ?? []);

    return this.prisma.$transaction(async (tx: any) => {
      // Delete existing schedules
      await tx.provider_schedules.deleteMany({
        where: { provider_id: providerId },
      });

      // Create new schedules. The frontend sends one item per
      // (day_of_week, block_order) pair; items without `block_order`
      // were already assigned per-day counters above so multiple
      // blocks on the same day never collide.
      if (rows.length > 0) {
        try {
          await tx.provider_schedules.createMany({
            data: rows.map((item) => ({
              provider_id: providerId,
              day_of_week: item.day_of_week,
              block_order: item.block_order as number,
              start_time: item.start_time,
              end_time: item.end_time,
              is_active: item.is_active ?? true,
            })),
          });
        } catch (error) {
          // Last line of defense (e.g. two concurrent saves racing the
          // delete+recreate): surface a clear 400 instead of a 500.
          const code = (error as { code?: string })?.code;
          if (code === 'P2002' || code === 'P2000') {
            throw new BadRequestException(
              'Los bloques del horario están duplicados o tienen un formato inválido. Revisa los bloques de cada día e inténtalo de nuevo.',
            );
          }
          throw error;
        }
      }

      return tx.provider_schedules.findMany({
        where: { provider_id: providerId },
        orderBy: [{ day_of_week: 'asc' }, { block_order: 'asc' }],
      });
    });
  }

  /**
   * Validates schedule items and resolves missing `block_order` values
   * with per-day counters. Throws `BadRequestException` (never a raw
   * Prisma error) on: bad time format, end <= start, or a duplicated
   * (day_of_week, block_order) pair within the payload.
   */
  private normalizeScheduleItems(
    items: ProviderScheduleItemDto[],
  ): ProviderScheduleItemDto[] {
    const usedByDay = new Map<number, Set<number>>();

    return items.map((item) => {
      const dayName = DAY_NAMES[item.day_of_week] ?? `día ${item.day_of_week}`;

      if (
        typeof item.start_time !== 'string' ||
        !SCHEDULE_TIME_PATTERN.test(item.start_time)
      ) {
        throw new BadRequestException(
          `La hora de inicio del ${dayName} no es válida (usa HH:mm, 00:00-23:59)`,
        );
      }
      if (
        typeof item.end_time !== 'string' ||
        !SCHEDULE_TIME_PATTERN.test(item.end_time)
      ) {
        throw new BadRequestException(
          `La hora de fin del ${dayName} no es válida (usa HH:mm, 00:00-23:59)`,
        );
      }
      const startMin = this.timeToMinutes(item.start_time);
      const endMin = this.timeToMinutes(item.end_time);
      if (endMin <= startMin) {
        throw new BadRequestException(
          `El bloque del ${dayName} (${item.start_time}–${item.end_time}) termina antes de empezar`,
        );
      }

      const used = usedByDay.get(item.day_of_week) ?? new Set<number>();
      let order = item.block_order;
      if (order === undefined || order === null) {
        order = 0;
        while (used.has(order)) order += 1;
      }
      if (used.has(order)) {
        throw new BadRequestException(
          `El ${dayName} trae dos bloques con el mismo orden (${order})`,
        );
      }
      used.add(order);
      usedByDay.set(item.day_of_week, used);

      return { ...item, block_order: order };
    });
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
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
