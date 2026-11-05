import { Injectable, BadRequestException } from '@nestjs/common';
import { stationChargesOnline } from '../service-stations/station-online-charge.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { booking_status_enum, booking_mode_enum } from '@prisma/client';
import { BusinessHoursService } from './business-hours/business-hours.service';
import {
  resolveStoreTimezone,
  localCivil,
  zonedWallClockToUtc,
} from '@common/utils/store-timezone.util';
import {
  ClockWindow,
  Span,
  addDaysToDateString,
  bookingMinuteSpan,
  coverageForDate,
  intersectSpans,
  isOvernight,
  spansOverlap,
  toMinutes,
  windowSpan,
} from '@common/utils/schedule-window.util';

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface AvailableProvider {
  id: number;
  display_name: string;
  avatar_url?: string | null;
}

export interface AvailabilitySlot {
  date: string;
  start_time: string;
  end_time: string;
  available_providers: AvailableProvider[];
  total_available: number;
  /** Total providers offering the service for this product (denominator). */
  total_capacity?: number;
  /** Bookings overlapping this slot that are NOT in cancelled status. */
  booked_count?: number;
  is_booked?: boolean;
  /** Day the slot ends when it crosses midnight (S21); absent when it ends the same day. */
  end_date?: string;
  /** Station is present only for services that require an assigned station. */
  station_id?: number;
  station_name?: string;
  /** The station requires a deposit or a payment to book: online, it is booked by hold + payment page. */
  charges_online?: boolean;
}

@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly businessHoursService: BusinessHoursService,
  ) {}

  /**
   * Genera los slots disponibles para un producto/servicio en un rango de fechas.
   * Algoritmo basado en providers: consulta provider_schedules y provider_exceptions.
   */
  async getAvailableSlots(
    product_id: number,
    date_from: string,
    date_to: string,
    options: { provider_id?: number; product_variant_id?: number; station_id?: number; include_booked?: boolean; prisma?: StorePrismaService } = {},
  ): Promise<AvailabilitySlot[]> {
    const { provider_id, product_variant_id, station_id, include_booked } = options;
    const queryPrisma = options.prisma ?? this.prisma;
    // 1. Obtener producto con duracion y booking_mode
    const product = await queryPrisma.products.findFirst({
      where: { id: product_id },
      select: {
        id: true,
        store_id: true,
        service_duration_minutes: true,
        buffer_minutes: true,
        booking_mode: true,
        requires_station: true,
      },
    });

    if (!product) return [];

    // Solo los productos con estaciones exigen formato estricto y maximo 62 dias.
    if (product.requires_station) this.assertAvailabilityRange(date_from, date_to);

    // Resolve the store's business-hours master calendar once per call.
    // Empty Map = store never configured their hours (legacy fallback).
    const storeHoursMap = await this.businessHoursService.loadStoreHours(
      product.store_id,
      queryPrisma,
    );
    // Same rule as the booking validator (ServiceAllocationCoordinator): configured store
    // hours decide the open days; `working_days` (Mon-Fri default, no UI) only backs the
    // legacy 08:00-18:00 window of a store that never configured its hours.
    const stationWorkingDays = product.requires_station
      ? storeHoursMap.size > 0
        ? [0, 1, 2, 3, 4, 5, 6]
        : await this.getStoreWorkingDays(product_id, queryPrisma)
      : undefined;

    // Resolve variant-specific duration/buffer if applicable
    let variant: {
      service_duration_minutes: number | null;
      buffer_minutes: number | null;
    } | null = null;
    if (product_variant_id) {
      variant = await queryPrisma.product_variants.findFirst({
        where: { id: product_variant_id, product_id },
        select: { service_duration_minutes: true, buffer_minutes: true },
      });
      // Solo los servicios con estación exigen variante válida; fuera de
      // estación se mantiene el contrato anterior (se ignora y se usa la
      // duración del producto).
      if (!variant && product.requires_station) {
        throw new BadRequestException('La variante no pertenece al servicio solicitado');
      }
    }

    const duration =
      variant?.service_duration_minutes ??
      product.service_duration_minutes ??
      60;
    const buffer = variant?.buffer_minutes ?? product.buffer_minutes ?? 0;
    const isFreeBooking =
      product.booking_mode === booking_mode_enum.free_booking;

    if (product.requires_station) {
      return this.getStationAvailableSlots(product, date_from, date_to, duration, buffer, {
        provider_id,
        station_id,
        include_booked,
      }, queryPrisma, stationWorkingDays ?? [1, 2, 3, 4, 5]);
    }

    if (station_id) return [];

    if (provider_id && isFreeBooking) {
      return [];
    }

    let providers: {
      id: number;
      display_name: string;
      avatar_url: string | null;
    }[] = [];

    if (!isFreeBooking) {
      const providerWhere: any = {
        is_active: true,
        services: { some: { product_id } },
      };

      if (provider_id) {
        providerWhere.id = provider_id;
      }

      providers = await this.prisma.service_providers.findMany({
        where: providerWhere,
        select: {
          id: true,
          display_name: true,
          avatar_url: true,
        },
      });
    }

    if (isFreeBooking) {
      return this.generateGenericSlots(
        product_id,
        date_from,
        date_to,
        duration,
        buffer,
      );
    }

    // provider_required with no active providers offering the service:
    // no generic fallback — store-hour slots with no professional
    // behind them would look bookable and the booking gate would have
    // to reject them later (QUI-969).
    if (providers.length === 0) {
      return [];
    }

    const providerIds = providers.map((p) => p.id);

    // 4. Obtener horarios de todos los proveedores relevantes
    const schedules = await this.prisma.provider_schedules.findMany({
      where: {
        provider_id: { in: providerIds },
        is_active: true,
      },
    });

    // 5. Obtener excepciones en el rango de fechas
    // S21: a block belongs to the day it starts, so the day before `date_from`
    // can still produce slots that start after midnight inside the range, and
    // bookings of the days around the range can overlap them.
    const scanFrom = addDaysToDateString(date_from, -1);
    const scanTo = addDaysToDateString(date_to, 1);
    const exceptions = await this.prisma.provider_exceptions.findMany({
      where: {
        provider_id: { in: providerIds },
        date: {
          gte: new Date(scanFrom),
          lte: new Date(date_to),
        },
      },
    });

    // 6. Obtener bookings existentes (no canceladas) en el rango
    const existingBookings = await this.prisma.bookings.findMany({
      where: {
        product_id,
        date: {
          gte: new Date(scanFrom),
          lte: new Date(scanTo),
        },
        status: { notIn: [booking_status_enum.cancelled] },
      },
      select: {
        date: true,
        end_date: true,
        start_time: true,
        end_time: true,
        provider_id: true,
      },
    });

    // 7. Generar slots por fecha de inicio del bloque y provider
    const slots: AvailabilitySlot[] = [];
    const dates = this.getDatesInRange(scanFrom, date_to);

    // "Ahora" en horario local del store. Se usa SOLO para descartar slots
    // cuyo start_time ya pasó cuando la fecha es hoy — mantiene coherente
    // el calendario de reservas (admin y ecommerce) y el grid de slots.
    const timezone = await resolveStoreTimezone(
      this.prisma,
      product.store_id,
    );
    const nowLocal = localCivil(new Date(), timezone);
    const todayLocal = `${nowLocal.year}-${pad2(nowLocal.month)}-${pad2(nowLocal.day)}`;
    const nowHHMM = `${pad2(nowLocal.hour)}:${pad2(nowLocal.minute)}`;

    // Agrupar datos para acceso rapido
    const schedulesByProvider = new Map<number, typeof schedules>();
    for (const s of schedules) {
      if (!schedulesByProvider.has(s.provider_id)) {
        schedulesByProvider.set(s.provider_id, []);
      }
      schedulesByProvider.get(s.provider_id)!.push(s);
    }

    const exceptionsByProvider = new Map<number, typeof exceptions>();
    for (const e of exceptions) {
      if (!exceptionsByProvider.has(e.provider_id)) {
        exceptionsByProvider.set(e.provider_id, []);
      }
      exceptionsByProvider.get(e.provider_id)!.push(e);
    }

    // Mapa temporal para agrupar providers por slot (date+start+end)
    const slotMap = new Map<
      string,
      {
        date: string;
        start_time: string;
        end_time: string;
        end_date?: string;
        providers: AvailableProvider[];
        is_booked: boolean;
      }
    >();

    for (const currentDate of dates) {
      const dayOfWeek = currentDate.getUTCDay();
      // `dateStr` is the day the BLOCK starts (A5); each slot carries its own date.
      const dateStr = this.formatDate(currentDate);
      const storeCoverage = coverageForDate(storeHoursMap, dayOfWeek);
      if (storeCoverage.length === 0) continue;

      for (const provider of providers) {
        const provSchedules = schedulesByProvider.get(provider.id) || [];
        // Get ALL blocks for this day (supports multiple blocks per day)
        const dayBlocks = provSchedules.filter((s) => s.day_of_week === dayOfWeek);
        if (dayBlocks.length === 0) continue;

        // Verificar excepciones para este provider en este dia
        const provExceptions = exceptionsByProvider.get(provider.id) || [];
        const exception = provExceptions.find(
          (e) => this.formatDate(new Date(e.date)) === dateStr,
        );

        // Si el provider no esta disponible este dia, saltar
        if (exception?.is_unavailable) continue;

        // Process each block for this day
        for (const schedule of dayBlocks) {
          // Determinar horario efectivo (exception overrides entire day if set)
          const effectiveStart =
            exception?.custom_start_time || schedule.start_time;
          const effectiveEnd = exception?.custom_end_time || schedule.end_time;

          // Intersectar con horario maestro de la tienda
          const clamps = intersectSpans(
            windowSpan({ start_time: effectiveStart, end_time: effectiveEnd }),
            storeCoverage,
          );

          for (const clamp of clamps) {
            for (const slot of this.generateSlotSpans(clamp, duration, buffer)) {
              const expanded = this.expandSlot(dateStr, slot);
              if (expanded.date < date_from || expanded.date > date_to) continue;
              // Filtra los slots cuyo start_time ya pasó (solo HOY). Comparación
              // lexicográfica válida porque `HH:mm` está zero-padded.
              if (expanded.date === todayLocal && expanded.start_time < nowHHMM) continue;

              // Verificar si este provider ya tiene booking que se superpone con este slot.
              // Intervalos semiabiertos estrictos: reservas pegadas (8:00-8:20 + slot
              // 8:20-8:40) NO se bloquean. Las reservas nocturnas se comparan por su
              // intervalo real (`end_date`).
              const providerBooked = existingBookings.some(
                (b) =>
                  b.provider_id === provider.id &&
                  spansOverlap(bookingMinuteSpan(b, dateStr), slot),
              );

              if (providerBooked) {
                // The slot is blocked by an existing booking on this provider.
                // We still emit it (with total_available=0 and is_booked=true)
                // so the ecommerce UI can render it in red with an X and the
                // customer sees WHY that time is not selectable.
                const blockedKey = `${expanded.date}|${expanded.start_time}|${expanded.end_time}`;
                if (!slotMap.has(blockedKey)) {
                  slotMap.set(blockedKey, {
                    ...expanded,
                    providers: [],
                    is_booked: true,
                  });
                }
                continue;
              }

              const key = `${expanded.date}|${expanded.start_time}|${expanded.end_time}`;
              if (!slotMap.has(key)) {
                slotMap.set(key, {
                  ...expanded,
                  providers: [],
                  is_booked: false,
                });
              }
              slotMap.get(key)!.providers.push({
                id: provider.id,
                display_name: provider.display_name || '',
                avatar_url: provider.avatar_url,
              });
            }
          }
        }
      }
    }

    // Convertir mapa a array ordenado
    for (const entry of slotMap.values()) {
      // Si `include_booked === false`, descartamos los slots que
      // quedaron marcados como `is_booked: true` así el caller
      // (ej. el modal de reagendar del admin) solo ve huecos libres.
      // Por defecto (`true`), conservamos todos para que el frontend
      // pueda mostrar la franja completa con OCUPADO标记.
      if (include_booked === false && entry.is_booked) continue;
      slots.push({
        date: entry.date,
        start_time: entry.start_time,
        end_time: entry.end_time,
        ...(entry.end_date ? { end_date: entry.end_date } : {}),
        available_providers: entry.providers,
        total_available: entry.providers.length,
        is_booked: entry.is_booked,
      });
    }

    // Ordenar por fecha y hora
    slots.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.start_time.localeCompare(b.start_time);
    });

    // NOTE (QUI-969): no generic fallback here. When the providers
    // offering this service have no schedules covering the range, the
    // truthful answer is "no availability" — generic store-hour slots
    // used to appear bookable with no professional behind them.
    return slots;
  }

  /**
   * Station-required services use the intersection of store, station and
   * provider calendars. Occupancy is read from allocations (the durable
   * resource contract); legacy bookings remain a provider-side fallback
   * while existing reservations are reconciled by the reservation writer.
   */
  private async getStationAvailableSlots(
    product: { id: number; store_id: number; booking_mode?: booking_mode_enum | null },
    dateFrom: string,
    dateTo: string,
    duration: number,
    buffer: number,
    options: { provider_id?: number; station_id?: number; include_booked?: boolean },
    prisma: StorePrismaService = this.prisma,
    workingDays: number[] = [1, 2, 3, 4, 5],
  ): Promise<AvailabilitySlot[]> {
    const { provider_id, station_id, include_booked } = options;
    const stationServices = await prisma.service_station_services.findMany({
      where: { store_id: product.store_id, product_id: product.id },
      select: { station_id: true },
    });
    const stations = await prisma.service_stations.findMany({
      where: {
        store_id: product.store_id,
        status: 'active',
        id: {
          in: stationServices
            .map((relation) => relation.station_id)
            .filter((id) => !station_id || id === station_id),
        },
      },
      select: { id: true, name: true, capacity: true, deposit_policy: true, booking_prepay_mode: true },
      orderBy: { id: 'asc' },
    });
    if (!stations.length) return [];
    const stationIds = stations.map((station) => station.id);
    const stationProviders = await prisma.service_station_providers.findMany({
      where: { store_id: product.store_id, station_id: { in: stationIds } },
      select: { station_id: true, provider_id: true },
    });
    const providers = await prisma.service_providers.findMany({
      where: {
        is_active: true,
        services: { some: { product_id: product.id } },
        id: {
          in: stationProviders
            .map((row) => row.provider_id)
            .filter((id) => !provider_id || id === provider_id),
        },
      },
      select: { id: true, display_name: true, avatar_url: true },
    });
    // A13: a station without providers (e.g. a cava) has its own online slots unless
    // the service demands a provider. A provider filter always needs providers.
    const stationOnlyIds = new Set<number>(
      product.booking_mode === booking_mode_enum.provider_required || provider_id
        ? []
        : stations
            .filter((station) => !stationProviders.some((row) => row.station_id === station.id))
            .map((station) => station.id),
    );
    if (!providers.length && stationOnlyIds.size === 0) return [];

    const compatibleProviders = new Map<number, typeof providers>();
    for (const station of stations) {
      const stationProviderIds = new Set(
        stationProviders.filter((row) => row.station_id === station.id).map((row) => row.provider_id),
      );
      compatibleProviders.set(station.id, providers.filter((provider) => stationProviderIds.has(provider.id)));
    }
    const providerIds = providers.map((provider) => provider.id);
    const schedules = await prisma.provider_schedules.findMany({
      where: { provider_id: { in: providerIds }, is_active: true },
    });
    // S21: blocks belong to the day they start; scan one day before and after the range.
    const scanFrom = addDaysToDateString(dateFrom, -1);
    const scanTo = addDaysToDateString(dateTo, 1);
    const providerExceptions = await prisma.provider_exceptions.findMany({
      where: { provider_id: { in: providerIds }, date: { gte: new Date(scanFrom), lte: new Date(dateTo) } },
    });
    const stationSchedules = await prisma.service_station_schedules.findMany({
      where: { store_id: product.store_id, station_id: { in: stationIds }, is_active: true },
    });
    const stationExceptions = await prisma.service_station_exceptions.findMany({
      where: {
        store_id: product.store_id,
        station_id: { in: stationIds },
        // The date range is store-local while these columns are UTC instants;
        // the two-day pad safely covers every supported IANA offset/DST edge.
        start_at: { lt: new Date(new Date(`${dateTo}T23:59:59.999Z`).getTime() + 2 * 86_400_000) },
        end_at: { gt: new Date(new Date(`${dateFrom}T00:00:00.000Z`).getTime() - 2 * 86_400_000) },
      },
    });
    const now = new Date();
    const allocations = await prisma.service_allocations.findMany({
      where: {
        store_id: product.store_id,
        state: { in: ['held', 'payment_pending', 'confirmed', 'in_service'] },
        AND: [
          { OR: [{ station_id: { in: stationIds } }, { provider_id: { in: providerIds } }] },
          { OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
        ],
      },
      select: { station_id: true, provider_id: true, start_at: true, end_at: true },
    });
    const existingBookings = await prisma.bookings.findMany({
      where: {
        store_id: product.store_id,
        provider_id: { in: providerIds },
        date: { gte: new Date(scanFrom), lte: new Date(scanTo) },
        status: { notIn: [booking_status_enum.cancelled] },
      },
      select: { date: true, end_date: true, start_time: true, end_time: true, provider_id: true, expires_at: true },
    });
    const configuredHours = await this.businessHoursService.loadStoreHours(product.store_id, prisma);
    // A store that never configured its hours keeps the legacy 08:00-18:00 window.
    const storeHours: Map<number, ClockWindow[]> = configuredHours.size === 0
      ? new Map(Array.from({ length: 7 }, (_, day) => [day, [{ start_time: '08:00', end_time: '18:00' }]] as [number, ClockWindow[]]))
      : configuredHours;
    const timezone = await resolveStoreTimezone(prisma, product.store_id);
    const nowLocal = localCivil(now, timezone);
    const today = `${nowLocal.year}-${pad2(nowLocal.month)}-${pad2(nowLocal.day)}`;
    const nowHHMM = `${pad2(nowLocal.hour)}:${pad2(nowLocal.minute)}`;
    // A block belongs to the day it starts (A5): scan from the day before the range.
    const dates = this.getDatesInRange(scanFrom, dateTo);
    const slotMap = new Map<string, AvailabilitySlot>();
    const instantAt = (day: string, minutes: number) => {
      const target = addDaysToDateString(day, Math.floor(minutes / 1440));
      const minuteOfDay = minutes % 1440;
      return zonedWallClockToUtc(
        Number(target.slice(0, 4)),
        Number(target.slice(5, 7)),
        Number(target.slice(8, 10)),
        Math.floor(minuteOfDay / 60),
        minuteOfDay % 60,
        0,
        0,
        timezone,
      );
    };

    for (const date of dates) {
      const dateStr = this.formatDate(date);
      const weekday = date.getUTCDay();
      if (!workingDays.includes(weekday)) continue;
      const storeCoverage = coverageForDate(storeHours, weekday);
      if (!storeCoverage.length) continue;
      for (const station of stations) {
        const stationBlocks = stationSchedules.filter((row) => row.station_id === station.id && row.weekday === weekday);
        if (!stationBlocks.length) continue;
        // Exceptions are instants: overlap is decided per slot below.
        const stationDayExceptions = stationExceptions.filter((exception) => exception.station_id === station.id);
        const stationWindows = stationBlocks.flatMap((block) =>
          intersectSpans(windowSpan({ start_time: block.start_time, end_time: block.end_time }), storeCoverage),
        );
        if (!stationWindows.length) continue;

        const emit = (
          slot: Span,
          providerOf: { id: number; display_name: string | null; avatar_url: string | null } | null,
          busy: boolean,
        ) => {
          const expanded = this.expandSlot(dateStr, slot);
          const key = `${station.id}|${expanded.date}|${expanded.start_time}|${expanded.end_time}`;
          let result = slotMap.get(key);
          if (!result) {
            result = {
              station_id: station.id,
              station_name: station.name,
              charges_online: stationChargesOnline(station),
              ...expanded,
              available_providers: [],
              total_available: 0,
              total_capacity: providerOf ? (compatibleProviders.get(station.id)?.length ?? 0) : 1,
              is_booked: busy,
            };
            slotMap.set(key, result);
          }
          if (!busy && providerOf && !result.available_providers.some((item) => item.id === providerOf.id)) {
            result.available_providers.push({ id: providerOf.id, display_name: providerOf.display_name || '', avatar_url: providerOf.avatar_url });
            result.total_available = result.available_providers.length;
          }
          // A station without providers has a single seat: free means 1 available.
          if (!busy && !providerOf) result.total_available = 1;
          if (busy) result.is_booked = true;
        };
        const inRange = (slot: Span) => {
          const expanded = this.expandSlot(dateStr, slot);
          if (expanded.date < dateFrom || expanded.date > dateTo) return false;
          // Past slots of today are skipped (compared on the store-local clock).
          return !(expanded.date === today && expanded.start_time < nowHHMM);
        };
        const stationBusyAt = (slot: Span) => {
          const slotStart = instantAt(dateStr, slot.startMin);
          const slotEnd = instantAt(dateStr, slot.endMin);
          return {
            slotStart,
            slotEnd,
            exceptionBlocked: stationDayExceptions.some((exception) => new Date(exception.start_at) < slotEnd && new Date(exception.end_at) > slotStart),
            stationBusy: allocations.some((allocation) => allocation.station_id === station.id && allocation.start_at < slotEnd && allocation.end_at > slotStart),
          };
        };

        if (stationOnlyIds.has(station.id)) {
          for (const window of stationWindows) {
            for (const slot of this.generateSlotSpans(window, duration, buffer)) {
              if (!inRange(slot)) continue;
              const { exceptionBlocked, stationBusy } = stationBusyAt(slot);
              if (exceptionBlocked) continue;
              if (stationBusy && include_booked === false) continue;
              emit(slot, null, stationBusy);
            }
          }
          continue;
        }

        for (const provider of compatibleProviders.get(station.id) ?? []) {
          const providerBlocks = schedules.filter((row) => row.provider_id === provider.id && row.day_of_week === weekday);
          const providerException = providerExceptions.find((row) => row.provider_id === provider.id && this.formatDate(new Date(row.date)) === dateStr);
          if (!providerBlocks.length || providerException?.is_unavailable) continue;
          for (const stationWindow of stationWindows) {
            for (const providerBlock of providerBlocks) {
              const effectiveStart = providerException?.custom_start_time ?? providerBlock.start_time;
              const effectiveEnd = providerException?.custom_end_time ?? providerBlock.end_time;
              const providerWindows = intersectSpans(windowSpan({ start_time: effectiveStart, end_time: effectiveEnd }), storeCoverage);
              for (const providerWindow of providerWindows) {
                const window: Span = {
                  startMin: Math.max(stationWindow.startMin, providerWindow.startMin),
                  endMin: Math.min(stationWindow.endMin, providerWindow.endMin),
                };
                if (window.endMin <= window.startMin) continue;
                for (const slot of this.generateSlotSpans(window, duration, buffer)) {
                  if (!inRange(slot)) continue;
                  const { slotStart, slotEnd, exceptionBlocked, stationBusy } = stationBusyAt(slot);
                  if (exceptionBlocked) continue;
                  const providerBusy = allocations.some((allocation) => allocation.provider_id === provider.id && allocation.start_at < slotEnd && allocation.end_at > slotStart)
                    || existingBookings.some((booking) => booking.provider_id === provider.id && (!booking.expires_at || booking.expires_at > now) && spansOverlap(bookingMinuteSpan(booking, dateStr), slot));
                  const busy = stationBusy || providerBusy;
                  if (busy && include_booked === false) continue;
                  emit(slot, provider, busy);
                }
              }
            }
          }
        }
      }
    }
    return [...slotMap.values()]
      .map((slot) => ({ ...slot, is_booked: slot.total_available === 0 }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time) || (a.station_id ?? 0) - (b.station_id ?? 0));
  }

  /**
   * Verifica si un slot especifico esta disponible
   */
  async isSlotAvailable(
    product_id: number,
    date: string,
    start_time: string,
    end_time: string,
    provider_id?: number,
    exclude_booking_id?: number,
  ): Promise<boolean> {
    // Obtener booking_mode del producto
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { booking_mode: true },
    });

    if (!product) return false;

    // free_booking siempre esta disponible
    if (product.booking_mode === booking_mode_enum.free_booking) {
      return true;
    }

    if (provider_id) {
      // Verificar solo este provider
      return this.isProviderAvailableForSlot(
        provider_id,
        product_id,
        date,
        start_time,
        end_time,
        exclude_booking_id,
      );
    }

    // Verificar si ALGUN provider esta disponible
    const availableProviders = await this.getAvailableProvidersForSlot(
      product_id,
      date,
      start_time,
      end_time,
      exclude_booking_id,
    );
    return availableProviders.length > 0;
  }

  /**
   * Retorna la lista de providers disponibles para un slot especifico
   */
  async getAvailableProvidersForSlot(
    product_id: number,
    date: string,
    start_time: string,
    end_time: string,
    exclude_booking_id?: number,
  ): Promise<AvailableProvider[]> {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getUTCDay();
    const dateStr = this.formatDate(targetDate);

    // Resolve the store_id from the product so we can consult the master
    // business-hours calendar. The store-hours window is the upper bound:
    // a provider can't be available if the venue is closed that day.
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    if (!product) return [];
    const storeHoursMap = await this.businessHoursService.loadStoreHours(
      product.store_id,
    );
    const storeCoverage = coverageForDate(storeHoursMap, dayOfWeek);
    // No business-hours coverage for this day → store closed → no providers available.
    if (storeCoverage.length === 0) return [];
    const slot = this.slotSpanFor(start_time, end_time);

    // Obtener providers activos que ofrecen este servicio
    const providers = await this.prisma.service_providers.findMany({
      where: {
        is_active: true,
        services: { some: { product_id } },
      },
      select: { id: true, display_name: true, avatar_url: true },
    });

    const available: AvailableProvider[] = [];

    for (const provider of providers) {
      if (
        !(await this.providerFitsSlot(
          provider.id,
          dateStr,
          dayOfWeek,
          slot,
          storeCoverage,
          exclude_booking_id,
        ))
      ) {
        continue;
      }
      available.push({
        id: provider.id,
        display_name: provider.display_name || '',
        avatar_url: provider.avatar_url,
      });
    }

    return available;
  }

  /**
   * Valida que el cliente no tenga reservas superpuestas
   */
  async validateNoOverlapForCustomer(
    customer_id: number,
    date: string,
    start_time: string,
    end_time: string,
    exclude_booking_id?: number,
  ): Promise<void> {
    // DISABLED — el check de overlap por cliente estaba bloqueando
    // casos legítimos como "el cliente reserva para sí mismo Y para un
    // familiar en el mismo horario" (ej. padre e hijo en paralelo)
    // o auto-reagendadas que se solapan temporalmente durante el flujo.
    // El doble-booking real lo evita `isProviderAvailableForSlot`
    // a nivel de provider — si el provider está ocupado a esa hora,
    // no hay slots disponibles. El check por cliente era ruido de UX.
    //
    // Si en el futuro se quiere reintroducir, considerar:
    //   - Solo para el MISMO logged-in user (no para guest checkout
    //     donde "el mismo customer" puede ser ambiguo)
    //   - Permitir solapamiento entre customer_id distintos
    //     (reservas para familiares con el mismo email)
    void customer_id;
    void date;
    void start_time;
    void end_time;
    void exclude_booking_id;
    return;
  }

  // --- Helpers privados ---

  private async isProviderAvailableForSlot(
    provider_id: number,
    product_id: number,
    date: string,
    start_time: string,
    end_time: string,
    exclude_booking_id?: number,
  ): Promise<boolean> {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getUTCDay();

    // Verificar que el provider ofrece este servicio
    const assignment = await this.prisma.provider_services.findFirst({
      where: { provider_id, product_id },
    });

    if (!assignment) return false;

    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    if (!product) return false;
    const storeHoursMap = await this.businessHoursService.loadStoreHours(
      product.store_id,
    );
    const storeCoverage = coverageForDate(storeHoursMap, dayOfWeek);

    return this.providerFitsSlot(
      provider_id,
      this.formatDate(targetDate),
      dayOfWeek,
      this.slotSpanFor(start_time, end_time),
      storeCoverage,
      exclude_booking_id,
    );
  }

  /** Slot span in minutes from 00:00 of its start day; `end <= start` ends the next day. */
  private slotSpanFor(start_time: string, end_time: string): Span {
    const startMin = toMinutes(start_time);
    let endMin = toMinutes(end_time);
    if (endMin <= startMin) endMin += 1440;
    return { startMin, endMin };
  }

  /**
   * True when `slot` (minutes from 00:00 of `dateStr`) fits one provider block
   * inside the store coverage and no booking of the provider overlaps it.
   * Blocks belong to the day they start (A5), so the slot may also sit in the
   * overnight spill of the previous day (block span shifted by -1440).
   */
  private async providerFitsSlot(
    provider_id: number,
    dateStr: string,
    dayOfWeek: number,
    slot: Span,
    storeCoverage: Span[],
    exclude_booking_id?: number,
  ): Promise<boolean> {
    const prevDay = (dayOfWeek + 6) % 7;
    const rows = (
      await this.prisma.provider_schedules.findMany({
        where: {
          provider_id,
          day_of_week: { in: [dayOfWeek, prevDay] },
          is_active: true,
        },
        orderBy: { block_order: 'asc' },
      })
    ).filter((row) => row.day_of_week === dayOfWeek || row.day_of_week === prevDay);
    const ownBlocks = rows.filter((row) => row.day_of_week === dayOfWeek);
    const spillBlocks = rows.filter(
      (row) =>
        row.day_of_week === prevDay &&
        row.day_of_week !== dayOfWeek &&
        isOvernight(row),
    );
    if (ownBlocks.length === 0 && spillBlocks.length === 0) return false;

    const candidates: Span[] = [];
    if (ownBlocks.length > 0) {
      const exception = await this.prisma.provider_exceptions.findFirst({
        where: { provider_id, date: new Date(dateStr) },
      });
      if (!exception?.is_unavailable) {
        for (const schedule of ownBlocks) {
          candidates.push(
            windowSpan({
              start_time: exception?.custom_start_time || schedule.start_time,
              end_time: exception?.custom_end_time || schedule.end_time,
            }),
          );
        }
      }
    }
    if (spillBlocks.length > 0) {
      const prevDate = addDaysToDateString(dateStr, -1);
      const exception = await this.prisma.provider_exceptions.findFirst({
        where: { provider_id, date: new Date(prevDate) },
      });
      if (!exception?.is_unavailable) {
        for (const schedule of spillBlocks) {
          const span = windowSpan({
            start_time: exception?.custom_start_time || schedule.start_time,
            end_time: exception?.custom_end_time || schedule.end_time,
          });
          candidates.push({ startMin: span.startMin - 1440, endMin: span.endMin - 1440 });
        }
      }
    }

    const insideBlock = candidates.some(
      (c) => slot.startMin >= c.startMin && slot.endMin <= c.endMin,
    );
    const insideStore = storeCoverage.some(
      (c) => slot.startMin >= c.startMin && slot.endMin <= c.endMin,
    );
    if (!insideBlock || !insideStore) return false;

    // Overlapping bookings of the provider, compared on their real interval.
    const bookings = await this.prisma.bookings.findMany({
      where: {
        provider_id,
        date: {
          gte: new Date(addDaysToDateString(dateStr, -1)),
          lte: new Date(addDaysToDateString(dateStr, 1)),
        },
        status: { notIn: [booking_status_enum.cancelled] },
        ...(exclude_booking_id ? { id: { not: exclude_booking_id } } : {}),
      },
      select: { date: true, end_date: true, start_time: true, end_time: true },
    });
    return !bookings.some((b) =>
      spansOverlap(bookingMinuteSpan(b, dateStr), slot),
    );
  }

  /**
   * Slot grid inside a window, anchored at the window start (minutes from the
   * start day 00:00; the end may exceed 1440 for blocks that cross midnight).
   */
  private generateSlotSpans(window: Span, duration: number, buffer: number): Span[] {
    const slots: Span[] = [];
    if (duration <= 0) return slots;
    let current = window.startMin;
    while (current + duration <= window.endMin) {
      slots.push({ startMin: current, endMin: current + duration });
      current += duration + buffer;
    }
    return slots;
  }

  /**
   * Turns a slot expressed relative to the block start day into its calendar
   * shape: it belongs to the day it STARTS, and carries `end_date` (D+1) only
   * when it ends on another day.
   */
  private expandSlot(
    blockDay: string,
    slot: Span,
  ): { date: string; start_time: string; end_time: string; end_date?: string } {
    const startDay = Math.floor(slot.startMin / 1440);
    const endDay = Math.floor(slot.endMin / 1440);
    const date = addDaysToDateString(blockDay, startDay);
    return {
      date,
      start_time: this.minutesToTime(slot.startMin % 1440),
      end_time: this.minutesToTime(slot.endMin % 1440),
      ...(endDay !== startDay ? { end_date: addDaysToDateString(blockDay, endDay) } : {}),
    };
  }

  private minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60)
      .toString()
      .padStart(2, '0');
    const m = (minutes % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  private getDatesInRange(from: string, to: string): Date[] {
    const dates: Date[] = [];
    const current = new Date(from);
    const end = new Date(to);
    while (current <= end) {
      dates.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  private assertAvailabilityRange(from: string, to: string): void {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateOnly.test(from) || !dateOnly.test(to)) {
      throw new BadRequestException('date_from y date_to deben usar YYYY-MM-DD');
    }
    const start = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      this.formatDate(start) !== from ||
      this.formatDate(end) !== to ||
      start > end
    ) {
      throw new BadRequestException('El rango de disponibilidad no es válido');
    }
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 62) {
      throw new BadRequestException('El rango de disponibilidad no puede exceder 62 días');
    }
  }

  private formatDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = date.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Resolves the working-days mask for the store that owns `product_id`.
   *
   * Reads `store_settings.settings.availability.working_days` (Mon-Fri by
   * default). Falls back to `[1, 2, 3, 4, 5]` when the setting is missing,
   * the row doesn't exist, or `availability.working_days` is malformed —
   * matching the historic hardcoded skip-weekend behavior so existing
   * stores are unaffected.
   */
  private async getStoreWorkingDays(
    product_id: number,
    prisma: StorePrismaService = this.prisma,
  ): Promise<number[]> {
    const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5] as const;

    const product = await prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    if (!product?.store_id) {
      return [...DEFAULT_WORKING_DAYS];
    }

    const storeSettings = await prisma.store_settings.findUnique({
      where: { store_id: product.store_id },
      select: { settings: true },
    });

    const raw = (storeSettings?.settings as any)?.availability?.working_days;
    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ) {
      return raw as number[];
    }

    return [...DEFAULT_WORKING_DAYS];
  }

  private async generateGenericSlots(
    product_id: number,
    date_from: string,
    date_to: string,
    duration: number,
    buffer: number,
  ): Promise<AvailabilitySlot[]> {
    const slots: AvailabilitySlot[] = [];
    // S21: blocks belong to the day they start; scan one day before the range.
    const scanFrom = addDaysToDateString(date_from, -1);
    const dates = this.getDatesInRange(scanFrom, date_to);

    const existingBookings = await this.prisma.bookings.findMany({
      where: {
        product_id,
        date: {
          gte: new Date(scanFrom),
          lte: new Date(date_to),
        },
        status: { notIn: [booking_status_enum.cancelled] },
      },
      select: { date: true, end_date: true, start_time: true, end_time: true },
    });

    // Resolve the store's working-days setting. Default (Mon-Fri) matches
    // the historic hardcoded skip-weekend behavior so existing stores are
    // unaffected. Stores that open weekends override via
    // `store_settings.settings.availability.working_days`.
    const workingDays = await this.getStoreWorkingDays(product_id);

    // Resolve the store's business-hours master calendar. When the store
    // has configured hours we use those windows instead of the legacy
    // hardcoded 08:00–18:00 default. A day with no configured window keeps
    // the 08:00–18:00 fallback to preserve legacy behavior.
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    const storeHoursMap = product
      ? await this.businessHoursService.loadStoreHours(product.store_id)
      : new Map<number, ClockWindow[]>();

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();

      if (!workingDays.includes(dayOfWeek)) continue;

      const dayWindows = storeHoursMap.get(dayOfWeek);
      const blocks: ClockWindow[] = dayWindows?.length
        ? dayWindows
        : [{ start_time: '08:00', end_time: '18:00' }];

      for (const block of blocks) {
        for (const slot of this.generateSlotSpans(windowSpan(block), duration, buffer)) {
          const expanded = this.expandSlot(dateStr, slot);
          if (expanded.date < date_from || expanded.date > date_to) continue;
          const bookedCount = existingBookings.filter(
            (b) =>
              this.formatDate(new Date(b.date)) === expanded.date &&
              b.start_time === expanded.start_time &&
              b.end_time === expanded.end_time,
          ).length;

          slots.push({
            ...expanded,
            available_providers: [],
            total_available: Math.max(10 - bookedCount, 0),
          });
        }
      }
    }

    return slots;
  }

  /**
   * Returns dates within a range where the provider has active schedule
   * blocks, along with the count of existing bookings per date.
   * Used by the reschedule modal to show only available days.
   */
  async getProviderDatesWithBookings(
    providerId: number,
    dateFrom: string,
    dateTo: string,
    productId?: number,
  ): Promise<
    Array<{
      date: string;
      day_of_week: number;
      has_schedule: boolean;
      booking_count: number;
      bookings: Array<{
        id: number;
        start_time: string;
        end_time: string;
        status: string;
        customer_name: string;
        service_name: string;
      }>;
    }>
  > {
    // 1. Get the provider's active schedule blocks
    const schedules = await this.prisma.provider_schedules.findMany({
      where: { provider_id: providerId, is_active: true },
    });

    // Group by day_of_week for quick lookup
    const blocksByDay = new Map<number, typeof schedules>();
    for (const s of schedules) {
      if (!blocksByDay.has(s.day_of_week)) {
        blocksByDay.set(s.day_of_week, []);
      }
      blocksByDay.get(s.day_of_week)!.push(s);
    }

    // 2. Get exceptions for this provider in the date range
    const exceptions = await this.prisma.provider_exceptions.findMany({
      where: {
        provider_id: providerId,
        date: {
          gte: new Date(dateFrom),
          lte: new Date(dateTo),
        },
      },
    });

    const exceptionsByDate = new Map<
      string,
      (typeof exceptions)[number]
    >();
    for (const e of exceptions) {
      exceptionsByDate.set(this.formatDate(new Date(e.date)), e);
    }

    // 3. Get existing bookings for this provider in the date range
    const bookingWhere: any = {
      provider_id: providerId,
      date: {
        gte: new Date(dateFrom),
        lte: new Date(dateTo),
      },
      status: {
        notIn: [booking_status_enum.cancelled],
      },
    };
    if (productId) {
      bookingWhere.product_id = productId;
    }

    const existingBookings = await this.prisma.bookings.findMany({
      where: bookingWhere,
      select: {
        id: true,
        date: true,
        start_time: true,
        end_time: true,
        status: true,
        product: { select: { name: true } },
        customer: { select: { first_name: true, last_name: true } },
      },
      orderBy: { start_time: 'asc' },
    });

    // Group bookings by date
    const bookingsByDate = new Map<
      string,
      typeof existingBookings
    >();
    for (const b of existingBookings) {
      const dateStr = this.formatDate(new Date(b.date));
      if (!bookingsByDate.has(dateStr)) {
        bookingsByDate.set(dateStr, []);
      }
      bookingsByDate.get(dateStr)!.push(b);
    }

    // 4. Build result for each date in range
    const dates = this.getDatesInRange(dateFrom, dateTo);
    const result: Array<{
      date: string;
      day_of_week: number;
      has_schedule: boolean;
      booking_count: number;
      bookings: Array<{
        id: number;
        start_time: string;
        end_time: string;
        status: string;
        customer_name: string;
        service_name: string;
      }>;
    }> = [];

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();

      // Check if provider has blocks for this day
      const dayBlocks = blocksByDay.get(dayOfWeek) || [];
      let hasSchedule = dayBlocks.length > 0;

      // Check exceptions: if marked as unavailable, override
      const exception = exceptionsByDate.get(dateStr);
      if (exception?.is_unavailable) {
        hasSchedule = false;
      }

      // Format bookings for this date
      const dayBookings = (bookingsByDate.get(dateStr) || []).map((b) => ({
        id: b.id,
        start_time: b.start_time,
        end_time: b.end_time,
        status: b.status,
        customer_name: `${b.customer?.first_name || ''} ${b.customer?.last_name || ''}`.trim(),
        service_name: b.product?.name || '',
      }));

      result.push({
        date: dateStr,
        day_of_week: dayOfWeek,
        has_schedule: hasSchedule,
        booking_count: dayBookings.length,
        bookings: dayBookings,
      });
    }

    return result;
  }

  /**
   * Public-facing day-by-day overview used by the BookingCalendarComponent
   * to paint the green/red calendar. For each day in [date_from, date_to]
   * returns whether there is at least one slot available (after applying
   * provider_schedules, provider_exceptions, store_business_hours and
   * existing bookings).
   *
   * Used by GET /ecommerce/reservations/availability-overview/:productId
   * which is @Public — so this implementation uses withoutScope() for all
   * queries (the default `this.prisma` is StorePrismaService which requires
   * a store_id in the request context, throwing 403 on public calls).
   *
   * Cheap: O(days) queries, each scoped to one day.
   */
  async getDayAvailabilityOverview(
    product_id: number,
    date_from: string,
    date_to: string,
    provider_id?: number,
    station_id?: number,
    product_variant_id?: number,
  ): Promise<Array<{ date: string; has_slots: boolean; slots_count: number }>> {
    // Use withoutScope() — this method is called from a @Public endpoint
    // and there is no store_id in the request context.
    const db = this.prisma.withoutScope();

    const product = await db.products.findFirst({
      where: { id: product_id },
      select: { id: true, store_id: true, requires_station: true },
    });
    if (!product) return [];

    if (product.requires_station) {
      this.assertAvailabilityRange(date_from, date_to);
      const slots = await this.getAvailableSlots(product_id, date_from, date_to, {
        provider_id,
        station_id,
        product_variant_id,
        prisma: db as unknown as StorePrismaService,
      });
      return this.getDatesInRange(date_from, date_to).map((date) => {
        const dateKey = this.formatDate(date);
        const count = new Set(slots.filter((slot) => slot.date === dateKey).map((slot) => `${slot.station_id}|${slot.start_time}`)).size;
        return { date: dateKey, has_slots: count > 0, slots_count: count };
      });
    }

    const dates = this.getDatesInRange(date_from, date_to);
    const result: Array<{ date: string; has_slots: boolean; slots_count: number }> = [];

    // Resolve "today" + current HH:mm in the store's local timezone once per
    // call. We use it only for the day that matches `todayLocal` so past-time
    // slots on HOY get excluded from the count, painting HOY as red on the
    // calendar when the business has already closed.
    const timezone = await resolveStoreTimezone(
      db as unknown as StorePrismaService,
      product.store_id,
    );
    const nowLocal = localCivil(new Date(), timezone);
    const todayLocal = `${nowLocal.year}-${pad2(nowLocal.month)}-${pad2(nowLocal.day)}`;
    const nowHHMM = `${pad2(nowLocal.hour)}:${pad2(nowLocal.minute)}`;

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();
      const minStartTime = dateStr === todayLocal ? nowHHMM : undefined;

      // Skip days the store is closed (master calendar).
      const storeHoursMap = await this.businessHoursService.loadStoreHours(
        product.store_id,
        db as unknown as StorePrismaService,
      );
      const storeCoverage = coverageForDate(storeHoursMap, dayOfWeek);
      if (storeCoverage.length === 0) {
        result.push({ date: dateStr, has_slots: false, slots_count: 0 });
        continue;
      }

      // Compute slots for this single day using withoutScope(). Mirrors the
      // core logic of getAvailableSlots but stays unscoped so the public
      // endpoint works.
      try {
        const slotsCount = await this.computeDaySlotsUnscoped(
          db,
          product,
          dateStr,
          dayOfWeek,
          storeCoverage,
          provider_id,
          minStartTime,
        );
        result.push({
          date: dateStr,
          has_slots: slotsCount > 0,
          slots_count: slotsCount,
        });
      } catch {
        result.push({ date: dateStr, has_slots: false, slots_count: 0 });
      }
    }

    return result;
  }

  /**
   * Computes the number of available slots for a single day, using the
   * provided unscoped Prisma client. Mirrors getAvailableSlots for the
   * relevant subset (no provider-exception filter — we approximate by
   * intersecting the provider schedule with the store window).
   *
   * Today-only behavior (`minStartTime` provided): también consulta
   * reservas existentes para descontar slots ya ocupados. Si después de
   * restar reservas previas y slots pasados no queda ningún slot
   * realmente disponible, devuelve 0 → el día se pinta rojo en el
   * calendario ecommerce como "no quedan cupos para hoy".
   *
   * Semántica de "está todo reservado hoy" según modo:
   *   - `free_booking`: cada booking ocupa 1 slot del inventario único.
   *     Si bookedCount >= total → 0.
   *   - provider-based: un slot sigue disponible si AL MENOS uno de los
   *     providers activos del producto no tiene booking que lo solape.
   *     "Todo reservado" = cada slot-start del rango está ocupado para
   *     cada provider.
   */
  private async computeDaySlotsUnscoped(
    db: any,
    product: { id: number; store_id: number },
    dateStr: string,
    dayOfWeek: number,
    storeCoverage: Span[],
    provider_id?: number,
    minStartTime?: string,
  ): Promise<number> {
    const productFull = await db.products.findFirst({
      where: { id: product.id },
      select: {
        service_duration_minutes: true,
        buffer_minutes: true,
        booking_mode: true,
      },
    });
    if (!productFull) return 0;
    const duration = productFull.service_duration_minutes ?? 60;
    const buffer = productFull.buffer_minutes ?? 0;
    const isToday = !!minStartTime;

    // free_booking
    if (productFull.booking_mode === 'free_booking') {
      const total = storeCoverage.reduce(
        (sum, span) =>
          sum + this.countTimeSlots(span, duration, buffer, minStartTime),
        0,
      );
      if (total === 0) return 0;
      if (!isToday) return total;
      return await this.countFreeBookingToday(
        db,
        product,
        dateStr,
        storeCoverage,
        total,
      );
    }

    // Provider-based
    const providers = await db.service_providers.findMany({
      where: {
        store_id: product.store_id,
        is_active: true,
        services: { some: { product_id: product.id } },
        ...(provider_id ? { id: provider_id } : {}),
      },
      select: { id: true },
    });
    if (providers.length === 0) return 0;
    const providerIds = providers.map((p) => p.id);

    const schedules = await db.provider_schedules.findMany({
      where: { provider_id: { in: providerIds }, day_of_week: dayOfWeek, is_active: true },
    });
    if (schedules.length === 0) return 0;

    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    const exception = await db.provider_exceptions.findFirst({
      where: {
        provider_id: { in: providerIds },
        date: targetDate,
        is_unavailable: true,
      },
    });
    if (exception) return 0;

    // Itera sobre los bloques. Si para ALGUN bloque queda al menos 1 slot
    // libre (teniendo en cuenta reservas previas en HOY), devolvemos el total.
    // El calendario solo necesita saber "hay / no hay" slots. Los slots que
    // empiezan después de medianoche pertenecen al día en que empieza el bloque.
    for (const s of schedules) {
      for (const clamped of intersectSpans(windowSpan(s), storeCoverage)) {
        const total = this.countTimeSlots(clamped, duration, buffer, minStartTime);
        if (total === 0) continue;
        if (!isToday) return total;
        const stillFree = await this.hasAnyProviderSlotFreeToday(
          db,
          product,
          dateStr,
          providerIds,
          clamped,
          total,
        );
        if (stillFree) return total;
      }
    }
    return 0;
  }

  /** Bookings that can overlap `dateStr`: the ones that start the day before or that day. */
  private async loadBookingsAround(
    db: any,
    where: Record<string, unknown>,
    dateStr: string,
    select: Record<string, boolean>,
  ): Promise<any[]> {
    return db.bookings.findMany({
      where: {
        ...where,
        date: {
          gte: new Date(`${addDaysToDateString(dateStr, -1)}T00:00:00.000Z`),
          lte: new Date(`${dateStr}T00:00:00.000Z`),
        },
        status: { notIn: [booking_status_enum.cancelled] },
      },
      select: { date: true, end_date: true, start_time: true, end_time: true, ...select },
    });
  }

  /**
   * Modo `free_booking` para HOY: cada booking ocupa UN slot del inventario
   * único. Devuelve `Math.max(total - bookedCount, 0)`.
   */
  private async countFreeBookingToday(
    db: any,
    product: { id: number; store_id: number },
    dateStr: string,
    windows: Span[],
    total: number,
  ): Promise<number> {
    const bookings = await this.loadBookingsAround(
      db,
      { product_id: product.id },
      dateStr,
      {},
    );
    const blocked = new Set<string>();
    for (const b of bookings) {
      const span = bookingMinuteSpan(b, dateStr);
      // Solo cuentan reservas que caen dentro del rango horario del día.
      if (!windows.some((w) => spansOverlap(span, w))) continue;
      blocked.add(`${span.startMin}`);
    }
    return Math.max(total - blocked.size, 0);
  }

  /**
   * Modo provider para HOY: devuelve true si al menos un provider
   * del conjunto conserva al menos 1 slot del rango SIN booking que lo
   * solape. Si todos los providers están ocupados para todos los slots,
   * devuelve false → `has_slots: false` para ese día.
   */
  private async hasAnyProviderSlotFreeToday(
    db: any,
    product: { id: number; store_id: number },
    dateStr: string,
    providerIds: number[],
    window: Span,
    totalSlots: number,
  ): Promise<boolean> {
    const bookings = await this.loadBookingsAround(
      db,
      { product_id: product.id, provider_id: { in: providerIds } },
      dateStr,
      { provider_id: true },
    );
    // Bookings agrupadas por provider.
    const byProvider = new Map<number, Span[]>();
    for (const b of bookings) {
      const span = bookingMinuteSpan(b, dateStr);
      if (!spansOverlap(span, window)) continue;
      const list = byProvider.get(b.provider_id) ?? [];
      list.push(span);
      byProvider.set(b.provider_id, list);
    }
    // Aproximamos caminando de 30 en 30 minutos (no recibimos la duración
    // aquí): cualquier hueco libre real se proyecta como slot verde.
    const step = 30;
    for (let t = window.startMin; t + 60 <= window.endMin; t += step) {
      const candidate: Span = { startMin: t, endMin: t + 60 };
      for (const pid of providerIds) {
        const provBookings = byProvider.get(pid);
        if (!provBookings || provBookings.length === 0) return true; // provider sin bookings = libre
        if (!provBookings.some((pb) => spansOverlap(pb, candidate))) return true;
      }
    }
    // Todos los slotStart están solapados para TODOS los providers del día.
    void totalSlots;
    return false;
  }

  /** Count how many slots of `duration`+`buffer` fit in `window` and START on its day
   *  (before 24:00). When `minStart` is provided, the cursor starts at
   *  `max(window.startMin, minStart)` so slots whose start_time is already in the
   *  past (today, post-clock) are excluded. */
  private countTimeSlots(
    window: Span,
    duration: number,
    buffer: number,
    minStart?: string,
  ): number {
    let cur = window.startMin;
    if (minStart) {
      const floor = toMinutes(minStart);
      if (floor > cur) cur = floor;
    }
    if (duration <= 0 || window.endMin <= cur) return 0;
    let count = 0;
    while (cur + duration <= window.endMin && cur < 1440) {
      count++;
      cur += duration + buffer;
    }
    return count;
  }
}
