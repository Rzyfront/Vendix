import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { resolveStoreTimezone, zonedWallClockToUtc } from '../../../common/utils/store-timezone.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { BusinessHoursService } from './business-hours/business-hours.service';

const ACTIVE_STATES = ['held', 'payment_pending', 'confirmed', 'in_service'];

export interface BookingAllocationInput {
  storeId: number;
  bookingId: number;
  productId: number;
  productVariantId?: number | null;
  stationId?: number | null;
  providerId?: number | null;
  date: string;
  startTime: string;
  endTime: string;
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !this.isTime(input.startTime) || !this.isTime(input.endTime) || input.endTime <= input.startTime) {
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
    const requestedMinutes = this.minutes(input.endTime) - this.minutes(input.startTime);
    if (!duration || requestedMinutes !== duration) throw new VendixHttpException(ErrorCodes.STATION_009);
    const timezone = await resolveStoreTimezone(this.prisma, input.storeId);
    const [year, month, day] = input.date.split('-').map(Number);
    const [startHour, startMinute] = input.startTime.split(':').map(Number);
    const [endHour, endMinute] = input.endTime.split(':').map(Number);
    const startAt = zonedWallClockToUtc(year, month, day, startHour, startMinute, 0, 0, timezone);
    const serviceEndAt = zonedWallClockToUtc(year, month, day, endHour, endMinute, 0, 0, timezone);
    const endAt = new Date(serviceEndAt.getTime() + buffer * 60_000);
    const now = new Date();
    if (startAt <= now || endAt <= startAt) throw new VendixHttpException(ErrorCodes.STATION_009);

    // Sin estación elegida: se asigna una elegible; si no hay, el error de siempre.
    const stationId = input.stationId ?? await this.pickStation(tx, { storeId: input.storeId, productId: input.productId, providerId: input.providerId, startAt, endAt });
    if (!stationId) throw new VendixHttpException(ErrorCodes.STATION_012);

    const station = await tx.service_stations.findFirst({
      where: { id: stationId, store_id: input.storeId, status: 'active', capacity: 1 },
      select: { id: true },
    });
    const stationService = station && await tx.service_station_services.findFirst({
      where: { store_id: input.storeId, station_id: stationId, product_id: input.productId },
      select: { id: true },
    });
    if (!station) throw new VendixHttpException(ErrorCodes.STATION_004);
    if (!stationService) throw new VendixHttpException(ErrorCodes.STATION_001);

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
    const [stationSchedules, stationExceptions, storeWindows] = await Promise.all([
      tx.service_station_schedules.findMany({ where: { store_id: input.storeId, station_id: stationId, weekday, is_active: true }, select: { start_time: true, end_time: true } }),
      tx.service_station_exceptions.findMany({ where: { store_id: input.storeId, station_id: stationId, start_at: { lt: endAt }, end_at: { gt: startAt } }, select: { id: true } }),
      this.businessHours.loadStoreWindows(input.storeId, tx as unknown as StorePrismaService),
    ]);
    const startMinutes = this.minutes(input.startTime);
    const endWithBufferMinutes = this.minutes(input.endTime) + buffer;
    const inside = (windows: Array<{ start_time: string; end_time: string }>) => endWithBufferMinutes <= 24 * 60 && windows.some((window) =>
      startMinutes >= this.minutes(window.start_time) && endWithBufferMinutes <= this.minutes(window.end_time),
    );
    if (!inside(stationSchedules) || stationExceptions.length > 0) throw new VendixHttpException(ErrorCodes.STATION_002);
    const storeHours = storeWindows.get(weekday) ?? [];
    if (storeWindows.size > 0) {
      if (!inside(storeHours)) throw new VendixHttpException(ErrorCodes.STATION_002);
    } else {
      const storeSettings = await tx.store_settings.findUnique({ where: { store_id: input.storeId }, select: { settings: true } });
      const rawWorkingDays = (storeSettings?.settings as any)?.availability?.working_days;
      const workingDays = Array.isArray(rawWorkingDays) && rawWorkingDays.length > 0 && rawWorkingDays.every((d: unknown) => Number.isInteger(d) && Number(d) >= 0 && Number(d) <= 6)
        ? rawWorkingDays as number[]
        : [1, 2, 3, 4, 5];
      const fallbackWindow = workingDays.includes(weekday) && startMinutes >= 8 * 60 && endWithBufferMinutes <= 18 * 60;
      if (!fallbackWindow) throw new VendixHttpException(ErrorCodes.STATION_002);
    }

    if (input.providerId) {
      const [schedules, exception] = await Promise.all([
        tx.provider_schedules.findMany({ where: { provider_id: input.providerId, day_of_week: weekday, is_active: true }, select: { start_time: true, end_time: true } }),
        tx.provider_exceptions.findFirst({ where: { provider_id: input.providerId, date: new Date(`${input.date}T00:00:00.000Z`) } }),
      ]);
      const providerWindows = exception?.custom_start_time && exception.custom_end_time
        ? [{ start_time: exception.custom_start_time, end_time: exception.custom_end_time }]
        : schedules;
      if (!providerWindows.length || exception?.is_unavailable || !inside(providerWindows)) throw new VendixHttpException(ErrorCodes.STATION_003);
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
      const legacyOverlap = await tx.bookings.findFirst({
        where: {
          store_id: input.storeId,
          provider_id: input.providerId,
          date: new Date(`${input.date}T00:00:00.000Z`),
          status: { notIn: ['cancelled', 'completed', 'no_show'] },
          service_allocation_id: null,
          ...(input.excludeBookingId ? { id: { not: input.excludeBookingId } } : {}),
          start_time: { lt: input.endTime },
          end_time: { gt: input.startTime },
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
        select: { id: true },
      });
      if (legacyOverlap) throw new VendixHttpException(ErrorCodes.STATION_003);
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
        data: { service_allocation_id: allocation.id },
      });
    } catch (error) {
      if (this.isForeignKeyConflict(error)) throw new VendixHttpException(ErrorCodes.STATION_004);
      throw error;
    }
    if (linked.count !== 1) throw new VendixHttpException(ErrorCodes.STATION_001);
    return { id: allocation.id, station_id: stationId, provider_id: input.providerId ?? null, start_at: startAt, end_at: endAt };
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
