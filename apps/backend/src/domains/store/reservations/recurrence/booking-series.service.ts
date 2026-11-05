import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { booking_status_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import {
  addDaysToDateString,
  bookingEndDateFor,
  bookingInterval,
} from '@common/utils/schedule-window.util';
import { ReservationsService } from '../reservations.service';
import { AvailabilityService } from '../availability.service';
import { ServiceAllocationCoordinator } from '../service-allocation-coordinator.service';
import { CreateBookingDto } from '../dto/create-booking.dto';
import { CreateBookingSeriesDto } from './create-booking-series.dto';

export interface SeriesPreviewRow {
  index: number;
  date: string;
  end_date: string | null;
  status: 'ok' | 'conflict';
  code?: string;
  message?: string;
}

export interface SeriesConflict {
  index: number;
  date: string;
  code: string;
  message: string;
}

export interface SeriesCreateResult {
  series_id: number;
  created: { index: number; booking_id: number; booking_number: string; date: string }[];
  conflicts: SeriesConflict[];
}

export interface SeriesCancelResult {
  index: number;
  booking_id: number;
  result: 'cancelled' | 'skipped' | 'failed';
  status?: string;
  message?: string;
}

/** Codes that mean "this slot is taken" (A19); anything else is a real failure. */
const CONFLICT_CODES: ReadonlySet<string> = new Set([
  ErrorCodes.STATION_002.code,
  ErrorCodes.STATION_003.code,
  ErrorCodes.STATION_008.code,
]);
const GENERIC_CONFLICT_CODE = 'CONFLICT';
/** Upper bound of the "walk the eligible stations" loop of the preview. */
const MAX_STATION_PROBES = 50;
const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  booking_status_enum.cancelled,
  booking_status_enum.completed,
  booking_status_enum.no_show,
]);

/** S19: recurring bookings. Each occurrence is a normal booking created by `ReservationsService.create`. */
@Injectable()
export class BookingSeriesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reservations: ReservationsService,
    private readonly availability: AvailabilityService,
    private readonly coordinator: ServiceAllocationCoordinator,
  ) {}

  /** Dates of the series with their (optional) next-day end date. */
  private buildDates(dto: CreateBookingSeriesDto): { index: number; date: string; end_date: string | null }[] {
    const stepDays = (dto.frequency === 'weekly' ? 7 : 1) * (dto.interval_count ?? 1);
    return Array.from({ length: dto.occurrences }, (_, index) => {
      const date = addDaysToDateString(dto.start_date, index * stepDays);
      return { index, date, end_date: bookingEndDateFor(date, dto.start_time, dto.end_time) };
    });
  }

  async preview(dto: CreateBookingSeriesDto): Promise<SeriesPreviewRow[]> {
    const storeId = this.requireStoreId();
    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: { id: true, requires_station: true },
    });
    if (!product) throw new NotFoundException('Producto/servicio no encontrado');
    const tz = await resolveStoreTimezone(this.prisma, storeId);

    const rows: SeriesPreviewRow[] = [];
    for (const occ of this.buildDates(dto)) {
      const conflict = await this.detectConflict(dto, occ, product.requires_station, storeId, tz);
      rows.push({ ...occ, status: conflict ? 'conflict' : 'ok', ...(conflict ?? {}) });
    }
    return rows;
  }

  private async detectConflict(
    dto: CreateBookingSeriesDto,
    occ: { date: string; end_date: string | null },
    requiresStation: boolean,
    storeId: number,
    tz: string,
  ): Promise<{ code: string; message: string } | null> {
    if (requiresStation) {
      const { startAt, endAt } = bookingInterval(
        { date: occ.date, end_date: occ.end_date, start_time: dto.start_time, end_time: dto.end_time },
        tz,
      );
      const free = await this.isStationFree(dto, storeId, startAt, endAt);
      return free
        ? null
        : { code: ErrorCodes.STATION_002.code, message: 'La estación no está disponible en esta fecha' };
    }
    if (dto.provider_id) {
      const ok = await this.availability.isSlotAvailable(
        dto.product_id,
        occ.date,
        dto.start_time,
        dto.end_time,
        dto.provider_id,
      );
      if (!ok) {
        return { code: ErrorCodes.STATION_003.code, message: 'El proveedor no está disponible en esta fecha' };
      }
    }
    return null;
  }

  /** Reuses the coordinator's read-only picker: with a station, walk the eligible ones until it shows up. */
  private async isStationFree(dto: CreateBookingSeriesDto, storeId: number, startAt: Date, endAt: Date) {
    const tried: number[] = [];
    for (let i = 0; i < MAX_STATION_PROBES; i += 1) {
      const picked = await this.coordinator.pickStation(this.prisma, {
        storeId,
        productId: dto.product_id,
        providerId: dto.provider_id ?? null,
        startAt,
        endAt,
        excludeStationIds: tried,
      });
      if (picked == null) return false;
      if (!dto.station_id || picked === dto.station_id) return true;
      tried.push(picked);
    }
    return false;
  }

  /** A18: no series on stations that charge to book or require a deposit. */
  private async assertSeriesAllowed(dto: CreateBookingSeriesDto, storeId: number): Promise<void> {
    const stations = dto.station_id
      ? [await this.prisma.service_stations.findFirst({
          where: { id: dto.station_id, store_id: storeId },
          select: { id: true, booking_prepay_mode: true, deposit_policy: true },
        })]
      : await this.prisma.service_stations.findMany({
          where: {
            store_id: storeId,
            status: 'active',
            service_station_services_station_fkey: { some: { product_id: dto.product_id } },
          },
          select: { id: true, booking_prepay_mode: true, deposit_policy: true },
        });
    const blocked = stations.some(
      (s) => s && (s.booking_prepay_mode !== 'none' || s.deposit_policy === 'required'),
    );
    if (blocked) {
      throw new VendixHttpException(ErrorCodes.STATION_BOOKING_011);
    }
  }

  async create(dto: CreateBookingSeriesDto): Promise<SeriesCreateResult> {
    const storeId = this.requireStoreId();
    await this.assertSeriesAllowed(dto, storeId);
    const skipConflicts = dto.skip_conflicts ?? true;

    const series = await this.prisma.booking_series.create({
      data: {
        store_id: storeId,
        customer_id: dto.customer_id ?? null,
        product_id: dto.product_id,
        product_variant_id: dto.product_variant_id ?? null,
        station_id: dto.station_id ?? null,
        frequency: dto.frequency,
        interval_count: dto.interval_count ?? 1,
        start_date: new Date(dto.start_date),
        start_time: dto.start_time,
        end_time: dto.end_time,
        occurrences: dto.occurrences,
        created_by_user_id: RequestContextService.getContext()?.user_id ?? null,
      },
    });

    const result: SeriesCreateResult = { series_id: series.id, created: [], conflicts: [] };
    for (const occ of this.buildDates(dto)) {
      const bookingDto: CreateBookingDto = {
        customer_id: dto.customer_id,
        product_id: dto.product_id,
        product_variant_id: dto.product_variant_id,
        station_id: dto.station_id,
        provider_id: dto.provider_id,
        date: occ.date,
        start_time: dto.start_time,
        end_time: dto.end_time,
        notes: dto.notes,
        channel: dto.channel,
      };
      try {
        const booking = await this.reservations.create(bookingDto);
        await this.prisma.bookings.update({
          where: { id: booking.id },
          data: { series_id: series.id, series_index: occ.index },
        });
        result.created.push({
          index: occ.index,
          booking_id: booking.id,
          booking_number: booking.booking_number,
          date: occ.date,
        });
      } catch (error) {
        const conflict = this.asConflict(error);
        if (!conflict) throw error;
        result.conflicts.push({ index: occ.index, date: occ.date, ...conflict });
        if (!skipConflicts) break;
      }
    }
    return result;
  }

  private asConflict(error: unknown): { code: string; message: string } | null {
    if (error instanceof VendixHttpException && CONFLICT_CODES.has(error.errorCode)) {
      return { code: error.errorCode, message: this.messageOf(error) };
    }
    if (error instanceof ConflictException) {
      return { code: GENERIC_CONFLICT_CODE, message: this.messageOf(error) };
    }
    return null;
  }

  private messageOf(error: ConflictException | VendixHttpException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    return typeof message === 'string' ? message : error.message;
  }

  /** Cancels each future occurrence (index >= `fromIndex`) one by one with the regular `cancel`. */
  async cancelFrom(seriesId: number, fromIndex = 0, _reason?: string): Promise<SeriesCancelResult[]> {
    await this.requireSeries(seriesId);
    const bookings = await this.prisma.bookings.findMany({
      where: { series_id: seriesId, series_index: { gte: fromIndex } },
      select: { id: true, series_index: true, status: true },
      orderBy: { series_index: 'asc' },
    });
    const results: SeriesCancelResult[] = [];
    for (const b of bookings) {
      const index = b.series_index as number;
      if (index < fromIndex) continue;
      if (CLOSED_STATUSES.has(b.status)) {
        results.push({ index, booking_id: b.id, result: 'skipped', status: b.status });
        continue;
      }
      try {
        await this.reservations.cancel(b.id);
        results.push({ index, booking_id: b.id, result: 'cancelled' });
      } catch (error) {
        results.push({
          index,
          booking_id: b.id,
          result: 'failed',
          message: error instanceof Error ? error.message : 'No se pudo cancelar la reserva',
        });
      }
    }
    return results;
  }

  async findOne(seriesId: number) {
    const series = await this.prisma.booking_series.findFirst({
      where: { id: seriesId },
      include: {
        bookings: {
          orderBy: { series_index: 'asc' },
          select: {
            id: true,
            booking_number: true,
            date: true,
            end_date: true,
            start_time: true,
            end_time: true,
            status: true,
            series_index: true,
          },
        },
      },
    });
    if (!series) throw new NotFoundException('Serie de reservas no encontrada');
    return series;
  }

  private async requireSeries(seriesId: number) {
    const series = await this.prisma.booking_series.findFirst({ where: { id: seriesId }, select: { id: true } });
    if (!series) throw new NotFoundException('Serie de reservas no encontrada');
    return series;
  }

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) throw new NotFoundException('No se encontro contexto de tienda');
    return storeId;
  }
}
