import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { resolveStoreTimezone, zonedWallClockToUtc } from '../../../common/utils/store-timezone.util';
import {
  ClockWindow,
  addDaysToDateString,
  bookingEndDateFor,
  bookingInterval,
  bookingMinuteSpan,
  coverageForDate,
  coversSpan,
  spansOverlap,
} from '../../../common/utils/schedule-window.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { BusinessHoursService } from './business-hours/business-hours.service';

const ACTIVE_STATES = ['held', 'payment_pending', 'confirmed', 'in_service'];
const DEFAULT_OPEN_END_BLOCK_MINUTES = 360;

export interface BookingAllocationInput {
  storeId: number;
  bookingId: number;
  productId: number;
  productVariantId?: number | null;
  stationId?: number | null;
  providerId?: number | null;
  date: string;
  startTime: string;
  /** Required unless `isOpenEnded`. `endTime <= startTime` ends the next day (S21). */
  endTime?: string;
  /** Day the booking ends (`YYYY-MM-DD`); defaults to D+1 when the booking crosses midnight, else D. */
  endDate?: string | null;
  /** Booking without an end (D9): ends at the station close or after `open_end_block_minutes`. */
  isOpenEnded?: boolean;
  expiresAt?: Date | null;
  state?: 'held' | 'payment_pending' | 'confirmed' | 'in_service';
  excludeBookingId?: number;
}

@Injectable()
export class ServiceAllocationCoordinator {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly businessHours: BusinessHoursService,
  ) {}

  async allocateBooking(tx: Prisma.TransactionClient, input: BookingAllocationInput) {
    const product = await tx.products.findFirst({
      where: { id: input.productId, store_id: input.storeId },
      select: { id: true, product_type: true, requires_station: true, booking_mode: true, buffer_minutes: true, service_duration_minutes: true },
    });
    if (!product?.requires_station) return null;
    if (product.product_type !== 'service') throw new VendixHttpException(ErrorCodes.STATION_001);
    const isOpenEnded = !!input.isOpenEnded;
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    const endTime = input.endTime ?? input.startTime;
    if (
      !isDate(input.date) ||
      !this.isTime(input.startTime) ||
      (!isOpenEnded && !this.isTime(input.endTime ?? '')) ||
      (input.endDate != null && !isDate(input.endDate))
    ) {
      throw new VendixHttpException(ErrorCodes.STATION_009);
    }

    const variant = input.productVariantId
      ? await tx.product_variants.findFirst({
          where: { id: input.productVariantId, product_id: input.productId },
          select: { buffer_minutes: true, service_duration_minutes: true },
        })
      : null;
    if (input.productVariantId && !variant) throw new VendixHttpException(ErrorCodes.STATION_001);
    const buffer = Math.max(0, variant?.buffer_minutes ?? product.buffer_minutes ?? 0);
    const duration = variant?.service_duration_minutes ?? product.service_duration_minutes;
    const timezone = await resolveStoreTimezone(this.prisma, input.storeId);
    const now = new Date();
    // S21: `end <= start` (or an explicit `endDate`) puts the end on another day. A booking
    // without an end plans a placeholder block until the station (and its close) is known (D9).
    const planned = bookingInterval(
      { date: input.date, end_date: isOpenEnded ? null : input.endDate, start_time: input.startTime, end_time: isOpenEnded ? input.startTime : endTime },
      timezone,
    );
    let startAt = planned.startAt;
    let serviceEndAt = isOpenEnded ? new Date(startAt.getTime() + DEFAULT_OPEN_END_BLOCK_MINUTES * 60_000) : planned.endAt;
    const requestedMinutes = Math.round((serviceEndAt.getTime() - startAt.getTime()) / 60_000);
    // The end day can never precede the start, and a same-day booking must end after it starts.
    if (!isOpenEnded && requestedMinutes <= 0) throw new VendixHttpException(ErrorCodes.STATION_009);
    let endAt = new Date(serviceEndAt.getTime() + buffer * 60_000);
    if (startAt <= now || endAt <= startAt) throw new VendixHttpException(ErrorCodes.STATION_009);

    // Sin estación elegida: se asigna una elegible; si no hay, el error de siempre.
    const stationId = input.stationId ?? await this.pickStation(tx, { storeId: input.storeId, productId: input.productId, providerId: input.providerId, startAt, endAt });
    if (!stationId) throw new VendixHttpException(ErrorCodes.STATION_012);

    const station = await tx.service_stations.findFirst({
      where: { id: stationId, store_id: input.storeId, status: 'active', capacity: 1 },
      select: { id: true, booking_duration_mode: true, open_end_block_minutes: true, rental_block_minutes: true },
    });
    const stationService = station && await tx.service_station_services.findFirst({
      where: { store_id: input.storeId, station_id: stationId, product_id: input.productId },
      select: { id: true },
    });
    if (!station) throw new VendixHttpException(ErrorCodes.STATION_004);
    if (!stationService) throw new VendixHttpException(ErrorCodes.STATION_001);

    // Duration rule: fixed stations take exactly the service duration; free ones accept any
    // positive duration that is a multiple of the rental block (S1). Open-ended skips it (D9).
    if (!isOpenEnded) {
      if (station.booking_duration_mode === 'free') {
        const block = station.rental_block_minutes;
        if (requestedMinutes <= 0 || (block && requestedMinutes % block !== 0)) throw new VendixHttpException(ErrorCodes.STATION_009);
      } else if (!duration || requestedMinutes !== duration) {
        throw new VendixHttpException(ErrorCodes.STATION_009);
      }
    }

    if (input.providerId) {
      const [stationProvider, providerService, provider] = await Promise.all([
        tx.service_station_providers.findFirst({ where: { store_id: input.storeId, station_id: stationId, provider_id: input.providerId }, select: { id: true } }),
        tx.provider_services.findFirst({ where: { provider_id: input.providerId, product_id: input.productId }, select: { id: true } }),
        tx.service_providers.findFirst({ where: { id: input.providerId, store_id: input.storeId, is_active: true }, select: { id: true } }),
      ]);
      if (!stationProvider || !providerService || !provider) throw new VendixHttpException(ErrorCodes.STATION_001);
    } else if (product.booking_mode === 'provider_required') {
      throw new VendixHttpException(ErrorCodes.STATION_001, 'Selecciona un proveedor compatible para este servicio.');
    }

    const weekday = new Date(`${input.date}T00:00:00.000Z`).getUTCDay();
    const dayBefore = addDaysToDateString(input.date, -1);
    const dayAfter = addDaysToDateString(input.date, 1);
    const [stationRows, storeWindows] = await Promise.all([
      tx.service_station_schedules.findMany({ where: { store_id: input.storeId, station_id: stationId, is_active: true }, select: { weekday: true, start_time: true, end_time: true } }),
      this.businessHours.loadStoreWindows(input.storeId, tx as unknown as StorePrismaService),
    ]);
    const stationWindows = new Map<number, ClockWindow[]>();
    for (const row of stationRows) {
      stationWindows.set(row.weekday, [...(stationWindows.get(row.weekday) ?? []), { start_time: row.start_time, end_time: row.end_time }]);
    }
    const startMinutes = this.minutes(input.startTime);

    // Open-ended (D9): occupies until the covering station block closes or after
    // `open_end_block_minutes`, whichever comes first. Nothing closes it later (D4).
    let endTimeOut = endTime;
    let endDateOut: string | null = isOpenEnded
      ? null
      : (input.endDate && input.endDate !== input.date ? input.endDate : bookingEndDateFor(input.date, input.startTime, endTime));
    if (isOpenEnded) {
      const covering = coverageForDate(stationWindows, weekday).find((span) => startMinutes >= span.startMin && startMinutes < span.endMin);
      if (!covering) throw new VendixHttpException(ErrorCodes.STATION_016);
      const blockMinutes = station.open_end_block_minutes ?? DEFAULT_OPEN_END_BLOCK_MINUTES;
      const endMinute = Math.min(covering.endMin - buffer, startMinutes + blockMinutes);
      if (endMinute <= startMinutes) throw new VendixHttpException(ErrorCodes.STATION_016);
      const dayOffset = Math.floor(endMinute / 1440);
      const minuteOfDay = endMinute % 1440;
      endTimeOut = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
      endDateOut = dayOffset > 0 ? addDaysToDateString(input.date, dayOffset) : null;
      const closed = bookingInterval({ date: input.date, end_date: endDateOut, start_time: input.startTime, end_time: endTimeOut }, timezone);
      startAt = closed.startAt;
      serviceEndAt = closed.endAt;
      endAt = new Date(serviceEndAt.getTime() + buffer * 60_000);
    }

    const stationExceptions = await tx.service_station_exceptions.findMany({ where: { store_id: input.storeId, station_id: stationId, start_at: { lt: endAt }, end_at: { gt: startAt } }, select: { id: true } });
    const serviceSpan = bookingMinuteSpan({ date: input.date, end_date: endDateOut, start_time: input.startTime, end_time: endTimeOut }, input.date);
    const bufferedEndMin = serviceSpan.endMin + buffer;
    if (!coversSpan(stationWindows, weekday, serviceSpan.startMin, bufferedEndMin) || stationExceptions.length > 0) {
      throw new VendixHttpException(ErrorCodes.STATION_016);
    }
    // D2: a station with its own schedule is governed by it, even where the store hours
    // (configured or the legacy working-days fallback) do not cover it, e.g. a Saturday
    // 22:00-02:00 block while the store closes 23:59.
    if (stationRows.length > 0) {
      // Own schedule already validated above.
    } else if (storeWindows.size > 0) {
      if (!coversSpan(storeWindows, weekday, serviceSpan.startMin, bufferedEndMin)) throw new VendixHttpException(ErrorCodes.STATION_016);
    } else {
      const storeSettings = await tx.store_settings.findUnique({ where: { store_id: input.storeId }, select: { settings: true } });
      const rawWorkingDays = (storeSettings?.settings as any)?.availability?.working_days;
      const workingDays = Array.isArray(rawWorkingDays) && rawWorkingDays.length > 0 && rawWorkingDays.every((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6)
        ? rawWorkingDays as number[]
        : [1, 2, 3, 4, 5];
      const fallbackWindow = workingDays.includes(weekday) && serviceSpan.startMin >= 8 * 60 && bufferedEndMin <= 18 * 60;
      if (!fallbackWindow) throw new VendixHttpException(ErrorCodes.STATION_016);
    }

    if (input.providerId) {
      const [schedules, exceptions] = await Promise.all([
        tx.provider_schedules.findMany({ where: { provider_id: input.providerId, is_active: true }, select: { day_of_week: true, start_time: true, end_time: true } }),
        tx.provider_exceptions.findMany({ where: { provider_id: input.providerId, date: { gte: new Date(`${dayBefore}T00:00:00.000Z`), lte: new Date(`${dayAfter}T00:00:00.000Z`) } } }),
      ]);
      // Weekly blocks, replaced per calendar day by that day's exception: an exception on D
      // governs D's own blocks only; the one on D-1 governs the spill (A5).
      const providerWindows = new Map<number, ClockWindow[]>();
      for (const day of [dayBefore, input.date, dayAfter]) {
        const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay();
        const exception = exceptions.find((e: any) => e.date instanceof Date ? e.date.toISOString().slice(0, 10) === day : String(e.date).slice(0, 10) === day);
        if (exception?.is_unavailable) {
          providerWindows.set(dow, []);
        } else if (exception?.custom_start_time && exception.custom_end_time) {
          providerWindows.set(dow, [{ start_time: exception.custom_start_time, end_time: exception.custom_end_time }]);
        } else {
          providerWindows.set(dow, schedules.filter((row: any) => row.day_of_week === dow).map((row: any) => ({ start_time: row.start_time, end_time: row.end_time })));
        }
      }
      if (!coversSpan(providerWindows, weekday, serviceSpan.startMin, bufferedEndMin)) throw new VendixHttpException(ErrorCodes.STATION_003);
    }

    await tx.service_allocations.updateMany({
      where: { store_id: input.storeId, state: { in: ACTIVE_STATES }, expires_at: { lte: now } },
      data: { state: 'expired', updated_at: now },
    });

    const overlaps = await tx.service_allocations.findMany({
      where: {
        store_id: input.storeId,
        state: { in: ACTIVE_STATES },
        ...(input.excludeBookingId ? { booking_id: { not: input.excludeBookingId } } : {}),
        AND: [
          { start_at: { lt: endAt } },
          { end_at: { gt: startAt } },
          { OR: [{ station_id: stationId }, ...(input.providerId ? [{ provider_id: input.providerId }] : [])] },
        ],
      },
      select: { station_id: true, provider_id: true },
    });
    if (overlaps.some((allocation) => allocation.station_id === stationId)) {
      throw new VendixHttpException(ErrorCodes.STATION_002);
    }
    if (input.providerId && overlaps.some((allocation) => allocation.provider_id === input.providerId)) {
      throw new VendixHttpException(ErrorCodes.STATION_003);
    }

    // Legacy bookings predate allocations. Conservatively keep their provider
    // interval exclusive until they are completed or reconciled.
    if (input.providerId) {
      const legacyRows = await tx.bookings.findMany({
        where: {
          store_id: input.storeId,
          provider_id: input.providerId,
          date: { gte: new Date(`${dayBefore}T00:00:00.000Z`), lte: new Date(`${dayAfter}T00:00:00.000Z`) },
          status: { notIn: ['cancelled', 'completed', 'no_show'] },
          service_allocation_id: null,
          ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
        select: { date: true, end_date: true, start_time: true, end_time: true },
      });
      if (legacyRows.some((row: any) => spansOverlap(bookingMinuteSpan(row, input.date), serviceSpan))) {
        throw new VendixHttpException(ErrorCodes.STATION_003);
      }
    }

    let allocation: { id: number };
    try {
      allocation = await tx.service_allocations.create({
        data: {
          store_id: input.storeId,
          station_id: stationId,
          provider_id: input.providerId ?? null,
          booking_id: input.bookingId,
          session_id: null,
          start_at: startAt,
          end_at: endAt,
          expires_at: input.expiresAt ?? null,
          state: input.state ?? (input.expiresAt ? 'held' : 'confirmed'),
        },
        select: { id: true },
      });
    } catch (error) {
      if (this.isExclusionConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_008);
      if (this.isForeignKeyConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_004);
      throw error;
    }
    let linked;
    try {
      linked = await tx.bookings.updateMany({
        where: { id: input.bookingId, store_id: input.storeId },
        data: isOpenEnded
          ? { service_allocation_id: allocation.id, end_time: endTimeOut, end_date: endDateOut ? new Date(`${endDateOut}T00:00:00.000Z`) : null, is_open_ended: true }
          : { service_allocation_id: allocation.id },
      });
    } catch (error) {
      if (this.isForeignKeyConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_004);
      throw error;
    }
    if (linked.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_001);
    return { id: allocation.id, station_id: stationId, provider_id: input.providerId ?? null, start_at: startAt, end_at: endAt, end_time: endTimeOut, end_date: endDateOut, is_open_ended: isOpenEnded };
  }

  /**
   * Estación elegible cuando la reserva o el walk-in no indica una: activa, de la tienda,
   * con el servicio asignado (y el proveedor, si viene) y sin asignación vigente que se
   * cruce con [startAt, endAt). `requireIdle` (walk-in que empieza ya) descarta además las
   * estaciones con una atención abierta o pausada; `excludeStationIds`, las ya intentadas.
   * Desempate determinista: menos atenciones abiertas y luego el id más bajo. `null` si no
   * hay ninguna; el llamador mantiene su error de siempre.
   */
  async pickStation(
    db: Pick<Prisma.TransactionClient, 'service_stations'>,
    input: { storeId: number; productId: number; providerId?: number | null; startAt: Date; endAt: Date; requireIdle?: boolean; excludeStationIds?: number[] },
  ): Promise<number | null> {
    const now = new Date();
    const candidates = await db.service_stations.findMany({
      where: {
        store_id: input.storeId,
        status: 'active',
        capacity: 1,
        ...(input.excludeStationIds?.length ? { id: { notIn: input.excludeStationIds } } : {}),
        service_station_services_station_fkey: { some: { product_id: input.productId } },
        ...(input.providerId ? { service_station_providers_station_fkey: { some: { provider_id: input.providerId } } } : {}),
        ...(input.requireIdle ? { service_sessions_station_fkey: { none: { status: { in: ['open', 'paused'] } } } } : {}),
        service_allocations_station_fkey: {
          none: {
            state: { in: ACTIVE_STATES },
            start_at: { lt: input.endAt },
            end_at: { gt: input.startAt },
            OR: [{ expires_at: null }, { expires_at: { gt: now } }],
          },
        },
      },
      select: {
        id: true,
        _count: { select: { service_sessions_station_fkey: { where: { status: { in: ['open', 'paused'] } } } } },
      },
    });
    candidates.sort((a, b) =>
      a._count.service_sessions_station_fkey - b._count.service_sessions_station_fkey || a.id - b.id,
    );
    return candidates[0]?.id ?? null;
  }

  async transferBookingToSession(
    tx: Prisma.TransactionClient,
    input: { storeId: number; bookingId: number; allocationId: number; sessionId: number; startAt: Date },
  ) {
    try {
      const claimed = await tx.service_allocations.updateMany({
        where: { id: input.allocationId, store_id: input.storeId, booking_id: input.bookingId, session_id: null, state: { in: ['confirmed', 'in_service'] } },
        data: { booking_id: null, session_id: input.sessionId, start_at: input.startAt, state: 'in_service', expires_at: null, updated_at: new Date() },
      });
      if (claimed.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_005);
    } catch (error) {
      if (this.isExclusionConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_008);
      throw error;
    }
  }

  async allocateSession(
    tx: Prisma.TransactionClient,
    input: { storeId: number; sessionId: number; stationId: number; providerId: number | null; startAt: Date; endAt: Date },
  ) {
    const now = new Date();
    await tx.service_allocations.updateMany({
      where: { store_id: input.storeId, state: { in: ['held', 'payment_pending', 'confirmed'] }, expires_at: { lte: now } },
      data: { state: 'expired', updated_at: now },
    });
    const overlap = await tx.service_allocations.findFirst({
      where: {
        store_id: input.storeId,
        state: { in: ACTIVE_STATES },
        start_at: { lt: input.endAt },
        end_at: { gt: input.startAt },
        OR: [{ station_id: input.stationId }, ...(input.providerId ? [{ provider_id: input.providerId }] : [])],
      },
      select: { station_id: true, provider_id: true },
    });
    if (overlap?.station_id === input.stationId) throw new VendixHttpException(ErrorCodes.STATION_002);
    if (input.providerId && overlap?.provider_id === input.providerId) throw new VendixHttpException(ErrorCodes.STATION_003);
    try {
      return await tx.service_allocations.create({
        data: { store_id: input.storeId, station_id: input.stationId, provider_id: input.providerId, booking_id: null, session_id: input.sessionId, start_at: input.startAt, end_at: input.endAt, state: 'in_service', updated_at: now },
      });
    } catch (error) {
      if (this.isExclusionConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_008);
      if (this.isForeignKeyConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_004);
      throw error;
    }
  }

  async releaseBooking(tx: Prisma.TransactionClient, storeId: number, bookingId: number, state: 'released' | 'expired' | 'cancelled' = 'released') {
    await tx.service_allocations.updateMany({
      where: { store_id: storeId, booking_id: bookingId, state: { in: ACTIVE_STATES } },
      data: { state, expires_at: null, updated_at: new Date() },
    });
  }

  isExclusionConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { code?: string } } }; cause?: { code?: string } };
    return value.code === '23P01' || value.meta?.code === '23P01' || value.meta?.driverAdapterError?.cause?.code === '23P01' || value.cause?.code === '23P01';
  }

  private isForeignKeyConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const value = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { code?: string } } }; cause?: { code?: string } };
    return value.code === 'P2003' || value.code === '23503' || value.meta?.code === '23503' || value.meta?.driverAdapterError?.cause?.code === '23503' || value.cause?.code === '23503';
  }

  private isTime(value: string) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  private minutes(value: string) {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }
}
