import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { validateRateWindows } from '../../../../common/utils/rate-window.util';
import { SetStationRateWindowsDto } from '../dto/station-rates.dto';

@Injectable()
export class RateWindowsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private get storeId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new BadRequestException('No se encontró contexto de tienda');
    return store_id;
  }

  private async assertStation(stationId: number) {
    const station = await this.prisma.service_stations.findFirst({
      where: { id: stationId, store_id: this.storeId },
      select: { id: true },
    });
    if (!station) throw new NotFoundException('Estación no encontrada');
  }

  async getRateWindows(stationId: number) {
    await this.assertStation(stationId);
    return this.prisma.service_station_rate_windows.findMany({
      where: { store_id: this.storeId, station_id: stationId },
      orderBy: [{ weekday: 'asc' }, { block_order: 'asc' }],
    });
  }

  /** Replace-all: the posted set becomes the station's whole rate-window set. */
  async setRateWindows(stationId: number, dto: SetStationRateWindowsDto) {
    await this.assertStation(stationId);
    const invalid = validateRateWindows(dto.windows);
    if (invalid) {
      throw new BadRequestException(
        invalid.reason === 'overlap'
          ? `Las franjas del día ${invalid.day} no pueden superponerse`
          : 'Cada franja debe tener horas con formato HH:mm',
      );
    }
    const storeId = this.storeId;
    const byWeekday = new Map<number, typeof dto.windows>();
    for (const w of dto.windows) {
      const list = byWeekday.get(w.weekday) ?? [];
      list.push(w);
      byWeekday.set(w.weekday, list);
    }
    const rows: Array<{
      store_id: number;
      station_id: number;
      weekday: number;
      block_order: number;
      start_time: string;
      end_time: string;
      block_price: number;
      is_active: boolean;
    }> = [];
    for (const [weekday, list] of byWeekday) {
      // Chronological order per weekday; block_order is rewritten 0..n-1.
      list.sort((a, b) => a.start_time.localeCompare(b.start_time));
      list.forEach((w, i) =>
        rows.push({
          store_id: storeId,
          station_id: stationId,
          weekday,
          block_order: i,
          start_time: w.start_time,
          end_time: w.end_time,
          block_price: w.block_price,
          is_active: w.is_active ?? true,
        }),
      );
    }
    await this.prisma.$transaction(async (tx: any) => {
      await tx.service_station_rate_windows.deleteMany({ where: { store_id: storeId, station_id: stationId } });
      if (rows.length) await tx.service_station_rate_windows.createMany({ data: rows });
    });
    return this.getRateWindows(stationId);
  }
}
