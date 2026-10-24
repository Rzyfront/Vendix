import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateServiceStationExceptionDto,
  ReplaceServiceStationSchedulesDto,
} from './dto/service-station-calendar.dto';

const minuteOfDay = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};
const asTime = (value: string) => new Date(`1970-01-01T${value}:00.000Z`);

@Injectable()
export class ServiceStationCalendarService {
  constructor(private readonly prisma: StorePrismaService) {}

  private get storeId(): number {
    const id = RequestContextService.getContext()?.store_id;
    if (!id) throw new VendixHttpException(ErrorCodes.SYS_UNAUTHORIZED_001);
    return id;
  }

  async read(stationId: number) {
    const storeId = this.storeId;
    await this.requireStation(stationId, storeId);
    const from = new Date();
    const through = new Date(from.getTime() + 180 * 24 * 60 * 60_000);
    const [schedules, exceptions] = await Promise.all([
      this.prisma.service_station_schedules.findMany({
        where: { store_id: storeId, station_id: stationId },
        orderBy: [{ weekday: 'asc' }, { start_time: 'asc' }],
      }),
      this.prisma.service_station_exceptions.findMany({
        where: { store_id: storeId, station_id: stationId, end_at: { gt: from }, start_at: { lt: through } },
        orderBy: { start_at: 'asc' },
      }),
    ]);
    return { station_id: stationId, time_zone: (await this.requireStation(stationId, storeId)).time_zone, schedules, exceptions };
  }

  async replaceSchedules(stationId: number, dto: ReplaceServiceStationSchedulesDto) {
    const storeId = this.storeId;
    await this.requireStation(stationId, storeId);
    this.validateScheduleWindows(dto);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.service_station_schedules.deleteMany({ where: { store_id: storeId, station_id: stationId } });
        if (dto.schedules.length) {
          await tx.service_station_schedules.createMany({
            data: dto.schedules.map((window) => ({
              store_id: storeId,
              station_id: stationId,
              weekday: window.weekday,
              start_time: asTime(window.start_time),
              end_time: asTime(window.end_time),
            })),
          });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return this.read(stationId);
    } catch (error) {
      if (this.isExclusionViolation(error)) throw new VendixHttpException(ErrorCodes.STATION_008);
      throw error;
    }
  }

  async createException(stationId: number, dto: CreateServiceStationExceptionDto) {
    const storeId = this.storeId;
    await this.requireStation(stationId, storeId);
    if (!dto.start_at?.endsWith('Z') || !dto.end_at?.endsWith('Z')) {
      throw new BadRequestException('El cierre debe tener un intervalo UTC válido con terminación Z.');
    }
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || startAt >= endAt) {
      throw new BadRequestException('El cierre debe tener un intervalo UTC vÃ¡lido con inicio anterior al fin.');
    }
    if (endAt.getTime() - startAt.getTime() > 366 * 24 * 60 * 60_000) {
      throw new BadRequestException('El cierre no puede superar 366 dÃ­as.');
    }
    return this.prisma.service_station_exceptions.create({
      data: { store_id: storeId, station_id: stationId, start_at: startAt, end_at: endAt },
    });
  }

  async removeException(stationId: number, exceptionId: number) {
    const storeId = this.storeId;
    await this.requireStation(stationId, storeId);
    const removed = await this.prisma.service_station_exceptions.deleteMany({
      where: { id: exceptionId, store_id: storeId, station_id: stationId },
    });
    if (removed.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_004);
    return { id: exceptionId, deleted: true };
  }

  private async requireStation(id: number, storeId: number) {
    const station = await this.prisma.service_stations.findFirst({
      where: { id, store_id: storeId },
      select: { id: true, time_zone: true },
    });
    if (!station) throw new VendixHttpException(ErrorCodes.STATION_004);
    return station;
  }

  private validateScheduleWindows(dto: ReplaceServiceStationSchedulesDto): void {
    const byDay = new Map<number, Array<{ start: number; end: number }>>();
    for (const row of dto.schedules) {
      const start = minuteOfDay(row.start_time);
      const end = minuteOfDay(row.end_time);
      if (start >= end) throw new BadRequestException('Cada jornada debe iniciar antes de terminar y no puede cruzar medianoche.');
      const windows = byDay.get(row.weekday) ?? [];
      windows.push({ start, end });
      byDay.set(row.weekday, windows);
    }
    for (const windows of byDay.values()) {
      windows.sort((a, b) => a.start - b.start);
      for (let i = 1; i < windows.length; i++) {
        if (windows[i].start < windows[i - 1].end) {
          throw new BadRequestException('Los horarios semanales no pueden superponerse.');
        }
      }
    }
  }

  private isExclusionViolation(error: unknown): boolean {
    let current: any = error;
    for (let depth = 0; current && depth < 5; depth++, current = current.cause ?? current.meta?.driverAdapterError?.cause) {
      if (current.code === '23P01') return true;
    }
    return false;
  }
}