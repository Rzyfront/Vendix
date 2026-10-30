import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { booking_status_enum, booking_mode_enum, Prisma } from '@prisma/client';
import { BusinessHoursService } from './business-hours/business-hours.service';
import {
  resolveStoreTimezone,
  localCivil,
} from '@common/utils/store-timezone.util';
import {
  isSlotEndInPast,
  isValidCivilDate,
  isValidTimeRange,
  slotFitsOneWindow,
  StoreWindow,
  StoreWindowsMap,
} from './booking-time.util';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Fixed number of simultaneous bookings a `free_booking` service accepts per
 * time range (QUI-966 L2: "Mantener 10 fijo"). Every non-cancelled booking
 * that OVERLAPS the range consumes one seat.
 */
export const FREE_BOOKING_CAPACITY = 10;

/**
 * Prisma `where` for the non-cancelled bookings of a `free_booking` product
 * that overlap [start_time, end_time) on `date` (QUI-966 S5). Shared by the
 * availability pre-check and the in-transaction re-check of create.
 */
export function freeBookingOverlapWhere(
  product_id: number,
  date: string,
  start_time: string,
  end_time: string,
  exclude_booking_id?: number,
): Prisma.bookingsWhereInput {
  return {
    product_id,
    date: new Date(date),
    start_time: { lt: end_time },
    end_time: { gt: start_time },
    ...slotHoldingBookingWhere(),
    ...(exclude_booking_id ? { id: { not: exclude_booking_id } } : {}),
  };
}

/**
 * Prisma `where` fragment for the bookings that still hold their slot
 * (QUI-966 T3 advisory A): not cancelled, and not an ecommerce hold that
 * already expired (`pending` + `expires_at` in the past). Nothing purges
 * expired holds, so without this they kept seats and providers busy forever.
 * Spread it into every availability count/grid query; it owns the `status`
 * and `OR` keys.
 */
export function slotHoldingBookingWhere(
  now: Date = new Date(),
): Prisma.bookingsWhereInput {
  return {
    status: { notIn: [booking_status_enum.cancelled] },
    OR: [
      { status: { not: booking_status_enum.pending } },
      { expires_at: null },
      { expires_at: { gte: now } },
    ],
  };
}

/** True when [aStart, aEnd) and [bStart, bEnd) overlap (`HH:mm` strings). */
export function timeRangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

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
    options: { provider_id?: number; product_variant_id?: number; include_booked?: boolean } = {},
  ): Promise<AvailabilitySlot[]> {
    const { provider_id, product_variant_id, include_booked } = options;
    // 1. Obtener producto con duracion y booking_mode
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: {
        id: true,
        store_id: true,
        service_duration_minutes: true,
        buffer_minutes: true,
        booking_mode: true,
      },
    });

    if (!product) return [];

    // Resolve the store's business-hours master calendar once per call:
    // every open block per day (QUI-966 S15, the lunch gap stays closed).
    // Empty Map = store never configured their hours (legacy fallback).
    const storeWindowsMap = await this.businessHoursService.loadStoreWindows(
      product.store_id,
    );

    // Resolve variant-specific duration/buffer if applicable
    let variant: {
      service_duration_minutes: number | null;
      buffer_minutes: number | null;
    } | null = null;
    if (product_variant_id) {
      variant = await this.prisma.product_variants.findFirst({
        where: { id: product_variant_id, product_id },
        select: { service_duration_minutes: true, buffer_minutes: true },
      });
    }

    const duration =
      variant?.service_duration_minutes ??
      product.service_duration_minutes ??
      60;
    const buffer = variant?.buffer_minutes ?? product.buffer_minutes ?? 0;
    const isFreeBooking =
      product.booking_mode === booking_mode_enum.free_booking;

    if (provider_id && isFreeBooking) {
      return [];
    }

    if (isFreeBooking) {
      return this.generateGenericSlots(
        product_id,
        date_from,
        date_to,
        duration,
        buffer,
        storeWindowsMap,
      );
    }

    const activeProvidersWhere: Prisma.service_providersWhereInput = {
      is_active: true,
      services: { some: { product_id } },
    };
    const providers = await this.prisma.service_providers.findMany({
      where: provider_id
        ? { ...activeProvidersWhere, id: provider_id }
        : activeProvidersWhere,
      select: {
        id: true,
        display_name: true,
        avatar_url: true,
      },
    });

    if (providers.length === 0) {
      // QUI-966 (L20): generic provider-less slots are only the legacy
      // fallback of a service with ZERO active providers (same rule as
      // `create`'s `countActiveProviders`). When the service has providers
      // (and only the requested one is missing) there is nothing to offer.
      const activeProviders = provider_id
        ? await this.prisma.service_providers.count({
            where: activeProvidersWhere,
          })
        : 0;
      if (activeProviders > 0) return [];
      return this.generateGenericSlots(
        product_id,
        date_from,
        date_to,
        duration,
        buffer,
        storeWindowsMap,
      );
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
    const exceptions = await this.prisma.provider_exceptions.findMany({
      where: {
        provider_id: { in: providerIds },
        date: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
      },
    });

    // 6. Bookings that keep these providers busy in the range, for ANY
    // service (QUI-966 S15): a provider attending another service is not
    // free, same rule as `isSlotAvailable`.
    const existingBookings = await this.prisma.bookings.findMany({
      where: {
        provider_id: { in: providerIds },
        date: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
        ...slotHoldingBookingWhere(),
      },
      select: {
        date: true,
        start_time: true,
        end_time: true,
        provider_id: true,
      },
    });

    // 7. Generar slots por fecha y provider
    const slots: AvailabilitySlot[] = [];
    const dates = this.getDatesInRange(date_from, date_to);

    // "Ahora" en horario local del store. Se usa SOLO para descartar los
    // slots de HOY que ya TERMINARON (misma noción de "pasado" que el gate
    // de reservas, `isSlotEndInPast`, y que la ruta free_booking): un slot
    // en curso se sigue ofreciendo para que el POS pueda reservarlo.
    const { todayLocal, nowHHMM } = await this.storeNow(product.store_id);

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
        providers: AvailableProvider[];
        is_booked: boolean;
      }
    >();

    for (const currentDate of dates) {
      const dayOfWeek = currentDate.getUTCDay();
      const dateStr = this.formatDate(currentDate);
      // QUI-966: nunca se ofrecen fechas pasadas (día de la tienda).
      if (dateStr < todayLocal) continue;
      // Si la fecha es HOY en horario local del store, descartamos los
      // slots que ya terminaron (QUI-966 L20: misma regla en ambas rutas).
      const isToday = dateStr === todayLocal;
      const storeWindows = storeWindowsMap.get(dayOfWeek);

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

          // Intersectar con CADA bloque del horario maestro de la tienda:
          // un slot cabe completo en un bloque del profesional y en uno de
          // la tienda (QUI-966 S15, el hueco del almuerzo queda cerrado).
          let timeSlots = this.intersectWithStoreWindows(
            effectiveStart,
            effectiveEnd,
            storeWindows,
          ).flatMap((w) =>
            this.generateTimeSlots(w.start, w.end, duration, buffer),
          );
          if (isToday) {
            // Oculta los slots que ya terminaron. Comparación lexicográfica
            // válida porque `HH:mm` está zero-padded.
            timeSlots = timeSlots.filter((s) => s.end_time > nowHHMM);
          }

          for (const slot of timeSlots) {
            // Verificar si este provider ya tiene booking que se superpone con este slot.
            // Usamos `<` y `>` (strict half-open intervals) — el slot solo se
            // bloquea si su rango INTERIOR se solapa con el de la reserva.
            // Slots adyacentes (booking 8:00-8:20 + slot 8:20-8:40) NO se
            // bloquean: el cliente puede reservar back-to-back si lo desea.
            // Si quieres buffer entre clientes, configura `buffer_minutes`
            // en el producto y se aplicará automáticamente.
            const providerBooked = existingBookings.some(
              (b) =>
                this.formatDate(new Date(b.date)) === dateStr &&
                b.provider_id === provider.id &&
                b.start_time < slot.end_time &&
                b.end_time > slot.start_time,
            );

            if (providerBooked) {
              // The slot is blocked by an existing booking on this provider.
              // We still emit it (with total_available=0 and is_booked=true)
              // so the ecommerce UI can render it in red with an X and the
              // customer sees WHY that time is not selectable. Previously
              // we `continue`d which hid the slot entirely.
              const blockedKey = `${dateStr}|${slot.start_time}|${slot.end_time}`;
              if (!slotMap.has(blockedKey)) {
                slotMap.set(blockedKey, {
                  date: dateStr,
                  start_time: slot.start_time,
                  end_time: slot.end_time,
                  providers: [],
                  is_booked: true,
                });
              }
              continue;
            }

            const key = `${dateStr}|${slot.start_time}|${slot.end_time}`;
            if (!slotMap.has(key)) {
              slotMap.set(key, {
                date: dateStr,
                start_time: slot.start_time,
                end_time: slot.end_time,
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

    // Convertir mapa a array ordenado
    for (const entry of slotMap.values()) {
      // Si `include_booked === false`, descartamos los slots que
      // quedaron marcados como `is_booked: true` así el caller
      // (ej. el modal de reagendar del admin) solo ve huecos libres.
      // Por defecto (`true`), conservamos todos para que el frontend
      // pueda mostrar la franja completa con OCUPADO标记.
      // A slot is booked only when NO provider is free for it: another
      // provider free at the same time keeps it selectable.
      const isBooked = entry.providers.length === 0;
      if (include_booked === false && isBooked) continue;
      slots.push({
        date: entry.date,
        start_time: entry.start_time,
        end_time: entry.end_time,
        available_providers: entry.providers,
        total_available: entry.providers.length,
        is_booked: isBooked,
      });
    }

    // Ordenar por fecha y hora
    slots.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.start_time.localeCompare(b.start_time);
    });

    // QUI-966 (L20): no generic provider-less fallback here. The service
    // has active providers, so an empty grid means none of them works in
    // the range (or it is already past) — offering slots without a provider
    // would let a provider_required service be booked unattended.
    return slots;
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
    // QUI-966 (S4): a malformed date, an empty/inverted range or a slot
    // already elapsed in the store timezone is never bookable.
    if (!isValidCivilDate(date) || !isValidTimeRange(start_time, end_time)) {
      return false;
    }

    // Obtener booking_mode del producto
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { booking_mode: true, store_id: true },
    });

    if (!product) return false;

    const timezone = await resolveStoreTimezone(this.prisma, product.store_id);
    if (isSlotEndInPast({ date, end_time }, timezone)) return false;

    // free_booking: hasta FREE_BOOKING_CAPACITY reservas solapadas (QUI-966 S5).
    if (product.booking_mode === booking_mode_enum.free_booking) {
      const overlapping = await this.prisma.bookings.count({
        where: freeBookingOverlapWhere(
          product_id,
          date,
          start_time,
          end_time,
          exclude_booking_id,
        ),
      });
      return overlapping < FREE_BOOKING_CAPACITY;
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
    const storeWindowsMap = await this.businessHoursService.loadStoreWindows(
      product.store_id,
    );
    const storeWindows = storeWindowsMap.get(dayOfWeek);
    // No business-hours block for this day → store closed → no providers available.
    if (!storeWindows?.length) return [];

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
      // Get ALL blocks for this day (supports multiple blocks per day)
      const dayBlocks = await this.prisma.provider_schedules.findMany({
        where: {
          provider_id: provider.id,
          day_of_week: dayOfWeek,
          is_active: true,
        },
        orderBy: { block_order: 'asc' },
      });

      if (dayBlocks.length === 0) continue;

      // Verificar excepciones
      const exception = await this.prisma.provider_exceptions.findFirst({
        where: { provider_id: provider.id, date: targetDate },
      });

      if (exception?.is_unavailable) continue;

      // Check if the slot falls within ANY of the provider's blocks for this day
      let slotIsWithinBlock = false;
      for (const schedule of dayBlocks) {
        // Verificar que el slot cae dentro del horario efectivo del provider
        // Y dentro de la ventana maestra de la tienda
        const providerStart =
          exception?.custom_start_time || schedule.start_time;
        const providerEnd =
          exception?.custom_end_time || schedule.end_time;
        if (
          this.slotFitsProviderBlock(
            start_time,
            end_time,
            providerStart,
            providerEnd,
            storeWindows,
          )
        ) {
          slotIsWithinBlock = true;
          break;
        }
      }

      if (!slotIsWithinBlock) continue;

      // Verificar si ya tiene booking que se superponga con este slot
      const where: any = {
        provider_id: provider.id,
        date: targetDate,
        start_time: { lt: end_time },
        end_time: { gt: start_time },
        ...slotHoldingBookingWhere(),
      };
      if (exclude_booking_id) {
        where.id = { not: exclude_booking_id };
      }
      const booked = await this.prisma.bookings.count({ where });

      if (booked === 0) {
        available.push({
          id: provider.id,
          display_name: provider.display_name || '',
          avatar_url: provider.avatar_url,
        });
      }
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

    // Verificar schedule - get ALL blocks for this day
    const dayBlocks = await this.prisma.provider_schedules.findMany({
      where: { provider_id, day_of_week: dayOfWeek, is_active: true },
      orderBy: { block_order: 'asc' },
    });

    if (dayBlocks.length === 0) return false;

    // Verificar excepciones
    const exception = await this.prisma.provider_exceptions.findFirst({
      where: { provider_id, date: targetDate },
    });

    if (exception?.is_unavailable) return false;

    // Verificar horario efectivo del provider - check if slot falls within ANY block
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    if (!product) return false;
    const storeWindowsMap = await this.businessHoursService.loadStoreWindows(
      product.store_id,
    );
    const storeWindows = storeWindowsMap.get(dayOfWeek);

    let slotIsWithinBlock = false;
    for (const schedule of dayBlocks) {
      const effectiveStart = exception?.custom_start_time || schedule.start_time;
      const effectiveEnd = exception?.custom_end_time || schedule.end_time;
      if (
        this.slotFitsProviderBlock(
          start_time,
          end_time,
          effectiveStart,
          effectiveEnd,
          storeWindows,
        )
      ) {
        slotIsWithinBlock = true;
        break;
      }
    }

    if (!slotIsWithinBlock) return false;

    // Verificar si ya tiene booking que se superponga
    const where: any = {
      provider_id,
      date: targetDate,
      start_time: { lt: end_time },
      end_time: { gt: start_time },
      ...slotHoldingBookingWhere(),
    };
    if (exclude_booking_id) {
      where.id = { not: exclude_booking_id };
    }
    const booked = await this.prisma.bookings.count({ where });

    return booked === 0;
  }

  private generateTimeSlots(
    start: string,
    end: string,
    duration: number,
    buffer: number,
  ): Array<{ start_time: string; end_time: string }> {
    const slots: Array<{ start_time: string; end_time: string }> = [];
    let current = this.timeToMinutes(start);
    const endMinutes = this.timeToMinutes(end);

    while (current + duration <= endMinutes) {
      const slot_start = this.minutesToTime(current);
      const slot_end = this.minutesToTime(current + duration);
      slots.push({ start_time: slot_start, end_time: slot_end });
      current += duration + buffer;
    }

    return slots;
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
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
  private async getStoreWorkingDays(product_id: number): Promise<number[]> {
    const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5] as const;

    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    if (!product?.store_id) {
      return [...DEFAULT_WORKING_DAYS];
    }

    const storeSettings = await this.prisma.store_settings.findUnique({
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

  /** Today (`YYYY-MM-DD`) and `HH:mm` now, in the store timezone. */
  private async storeNow(
    store_id: number,
  ): Promise<{ todayLocal: string; nowHHMM: string }> {
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const nowLocal = localCivil(new Date(), timezone);
    return {
      todayLocal: `${nowLocal.year}-${pad2(nowLocal.month)}-${pad2(nowLocal.day)}`,
      nowHHMM: `${pad2(nowLocal.hour)}:${pad2(nowLocal.minute)}`,
    };
  }

  private async generateGenericSlots(
    product_id: number,
    date_from: string,
    date_to: string,
    duration: number,
    buffer: number,
    storeWindowsMap: StoreWindowsMap,
  ): Promise<AvailabilitySlot[]> {
    const slots: AvailabilitySlot[] = [];
    const dates = this.getDatesInRange(date_from, date_to);

    const existingBookings = await this.prisma.bookings.findMany({
      where: {
        product_id,
        date: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
        ...slotHoldingBookingWhere(),
      },
      select: { date: true, start_time: true, end_time: true },
    });

    // Resolve the store's working-days setting. Default (Mon-Fri) matches
    // the historic hardcoded skip-weekend behavior so existing stores are
    // unaffected. Stores that open weekends override via
    // `store_settings.settings.availability.working_days`.
    const workingDays = await this.getStoreWorkingDays(product_id);

    // The store's business-hours master calendar (every block per day)
    // comes from the caller. When the store configured its hours we use
    // those blocks instead of the legacy hardcoded 08:00–18:00 default; a
    // store with no hours at all keeps the 08:00–18:00 fallback.
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    // QUI-966: "now" in the store timezone. Past dates and today's slots
    // that already ENDED (end <= now) are never offered; a slot in
    // progress still is (same notion of "past" as the booking gate,
    // `isSlotEndInPast`).
    const now = product ? await this.storeNow(product.store_id) : null;

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();

      if (!workingDays.includes(dayOfWeek)) continue;
      if (now && dateStr < now.todayLocal) continue;
      const isToday = now !== null && dateStr === now.todayLocal;

      // One run of slots per open block (QUI-966 S15: no slot straddles
      // the lunch gap). A configured store with no block this day is
      // closed (same as the booking gate); a store that never configured
      // its hours keeps the legacy 08:00–18:00 window.
      const dayWindows: StoreWindow[] =
        storeWindowsMap.size === 0
          ? [{ start_time: '08:00', end_time: '18:00' }]
          : (storeWindowsMap.get(dayOfWeek) ?? []);

      const timeSlots = dayWindows.flatMap((w) =>
        this.generateTimeSlots(w.start_time, w.end_time, duration, buffer),
      );

      for (const slot of timeSlots) {
        if (isToday && slot.end_time <= now!.nowHHMM) continue;
        // QUI-966 S5: every overlapping booking consumes a seat, not only
        // the ones with identical start/end.
        const bookedCount = existingBookings.filter(
          (b) =>
            this.formatDate(new Date(b.date)) === dateStr &&
            timeRangesOverlap(
              b.start_time,
              b.end_time,
              slot.start_time,
              slot.end_time,
            ),
        ).length;

        slots.push({
          date: dateStr,
          start_time: slot.start_time,
          end_time: slot.end_time,
          available_providers: [],
          total_available: Math.max(FREE_BOOKING_CAPACITY - bookedCount, 0),
        });
      }
    }

    return slots;
  }

  /**
   * Intersects an effective provider block with EACH block of the store's
   * master calendar for the day. Returns one interval per non-empty
   * intersection (empty when the store is closed that day or the provider
   * works outside store hours). QUI-966 S15: the gap between store blocks
   * is never part of any interval.
   */
  private intersectWithStoreWindows(
    providerStart: string,
    providerEnd: string,
    storeWindows: ReadonlyArray<StoreWindow> | undefined,
  ): Array<{ start: string; end: string }> {
    if (!storeWindows?.length) return [];
    const ps = this.timeToMinutes(providerStart);
    const pe = this.timeToMinutes(providerEnd);
    const out: Array<{ start: string; end: string }> = [];
    for (const w of storeWindows) {
      const start = Math.max(ps, this.timeToMinutes(w.start_time));
      const end = Math.min(pe, this.timeToMinutes(w.end_time));
      if (end > start) {
        out.push({
          start: this.minutesToTime(start),
          end: this.minutesToTime(end),
        });
      }
    }
    return out;
  }

  /**
   * True when the slot fits entirely inside the provider block AND inside
   * ONE store block (QUI-966 S15). Used by getAvailableProvidersForSlot
   * and isProviderAvailableForSlot.
   */
  private slotFitsProviderBlock(
    start_time: string,
    end_time: string,
    providerStart: string,
    providerEnd: string,
    storeWindows: ReadonlyArray<StoreWindow> | undefined,
  ): boolean {
    const intervals = this.intersectWithStoreWindows(
      providerStart,
      providerEnd,
      storeWindows,
    ).map((i) => ({ start_time: i.start, end_time: i.end }));
    return slotFitsOneWindow(start_time, end_time, intervals);
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
      ...slotHoldingBookingWhere(),
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
  ): Promise<Array<{ date: string; has_slots: boolean; slots_count: number }>> {
    // Use withoutScope() — this method is called from a @Public endpoint
    // and there is no store_id in the request context.
    const db = this.prisma.withoutScope();

    const product = await db.products.findFirst({
      where: { id: product_id },
      select: { id: true, store_id: true },
    });
    if (!product) return [];

    const dates = this.getDatesInRange(date_from, date_to);
    const result: Array<{ date: string; has_slots: boolean; slots_count: number }> = [];

    // Resolve "today" + current HH:mm in the store's local timezone once per
    // call. We use it only for the day that matches `todayLocal` so the slots
    // of HOY that already ENDED get excluded from the count (a slot in
    // progress still counts, same "past" rule as the grid and the booking
    // gate, QUI-966 T8), painting HOY as red once the business closed.
    const timezone = await resolveStoreTimezone(
      db as unknown as StorePrismaService,
      product.store_id,
    );
    const nowLocal = localCivil(new Date(), timezone);
    const todayLocal = `${nowLocal.year}-${pad2(nowLocal.month)}-${pad2(nowLocal.day)}`;
    const nowHHMM = `${pad2(nowLocal.hour)}:${pad2(nowLocal.minute)}`;

    // Every open block per day of the master calendar (QUI-966 S15).
    const storeWindowsMap = await this.businessHoursService.loadStoreWindows(
      product.store_id,
    );

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();
      const endedBy = dateStr === todayLocal ? nowHHMM : undefined;

      // Skip days the store is closed (master calendar).
      const storeWindows = storeWindowsMap.get(dayOfWeek);
      if (!storeWindows?.length) {
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
          storeWindows,
          provider_id,
          endedBy,
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
   * Today-only behavior (`endedBy` provided): también consulta
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
    storeWindows: StoreWindow[],
    provider_id?: number,
    endedBy?: string,
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
    const isToday = !!endedBy;

    // free_booking
    if (productFull.booking_mode === 'free_booking') {
      // One run of slots per store block (the lunch gap offers nothing).
      let count = 0;
      for (const w of storeWindows) {
        const total = this.countTimeSlots(
          w.start_time,
          w.end_time,
          duration,
          buffer,
          endedBy,
        );
        if (total === 0) continue;
        count += isToday
          ? await this.countFreeBookingToday(
              db,
              product,
              dateStr,
              w.start_time,
              w.end_time,
              total,
            )
          : total;
      }
      return count;
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

    // Itera sobre los bloques. Si para ALGUN bloque queda хотя бы 1 slot
    // libre (teniendo en cuenta reservas previas en HOY), devolvemos 1.
    // Devolver el conteo exacto aquí daría más precisión pero dispararía
    // el costo para future days (que dominan el render del calendario
    // mensual); el calendario solo necesita saber "hay / no hay" slots.
    const blocks = schedules.flatMap((s) =>
      this.intersectWithStoreWindows(s.start_time, s.end_time, storeWindows),
    );
    for (const clamped of blocks) {
      const total = this.countTimeSlots(
        clamped.start,
        clamped.end,
        duration,
        buffer,
        endedBy,
      );
      if (total === 0) continue;
      if (!isToday) return total;
      const stillFree = await this.hasAnyProviderSlotFreeToday(
        db,
        product,
        dateStr,
        providerIds,
        clamped.start,
        clamped.end,
        total,
      );
      if (stillFree) return total;
    }
    return 0;
  }

  /**
   * Modo `free_booking` para HOY: cada booking ocupa UN slot del inventario
   * único. Devuelve `Math.max(total - bookedCount, 0)`.
   */
  private async countFreeBookingToday(
    db: any,
    product: { id: number; store_id: number },
    dateStr: string,
    windowStart: string,
    windowEnd: string,
    total: number,
  ): Promise<number> {
    const ws = this.timeToMinutes(windowStart);
    const we = this.timeToMinutes(windowEnd);
    const bookings = await db.bookings.findMany({
      where: {
        product_id: product.id,
        date: new Date(`${dateStr}T00:00:00.000Z`),
        ...slotHoldingBookingWhere(),
      },
      select: { start_time: true, end_time: true },
    });
    const blocked = new Set<string>();
    for (const b of bookings) {
      const bs = this.timeToMinutes(b.start_time);
      const be = this.timeToMinutes(b.end_time);
      // Solo cuentan reservas que caen dentro del rango horario del día.
      if (be <= ws || bs >= we) continue;
      blocked.add(b.start_time.substring(0, 5));
    }
    return Math.max(total - blocked.size, 0);
  }

  /**
   * Modo provider para HOY: devuelve true si хотя бы один provider
   * del conjunto conserva хотя бы 1 slot del rango SIN booking que lo
   * solape. Si todos los providers están ocupados para todos los slots,
   * devuelve false → `has_slots: false` para ese día.
   *
   * Implementación O(P * B + P * S): para cada provider cruzamos sus
   * bookings con los slots del rango (Set de start_times). Si el set
   * "slots del rango sin booking del provider" no está vacío, ganamos.
   * El día pinta verde.
   */
  private async hasAnyProviderSlotFreeToday(
    db: any,
    product: { id: number; store_id: number },
    dateStr: string,
    providerIds: number[],
    windowStart: string,
    windowEnd: string,
    totalSlots: number,
  ): Promise<boolean> {
    const ws = this.timeToMinutes(windowStart);
    const we = this.timeToMinutes(windowEnd);
    // Bookings of these providers for ANY service keep them busy
    // (QUI-966 S15, same rule as the slot grid and `isSlotAvailable`).
    const bookings = await db.bookings.findMany({
      where: {
        provider_id: { in: providerIds },
        date: new Date(`${dateStr}T00:00:00.000Z`),
        ...slotHoldingBookingWhere(),
      },
      select: { provider_id: true, start_time: true, end_time: true },
    });
    // Bookings agrupadas por provider.
    const byProvider = new Map<number, Array<{ s: number; e: number }>>();
    for (const b of bookings) {
      const bs = this.timeToMinutes(b.start_time);
      const be = this.timeToMinutes(b.end_time);
      if (be <= ws || bs >= we) continue;
      const list = byProvider.get(b.provider_id) ?? [];
      list.push({ s: bs, e: be });
      byProvider.set(b.provider_id, list);
    }
    // Para cada slot-start del rango (cada `service_duration + buffer`
    // minutos, estimado con duration=60 / buffer=0 ya que no tenemos
    // esos valores aquí). Aproximamos caminando de 1-min en 1-min y
    // mirando si ese instante está libre para AL MENOS un provider.
    // Como no recibimos duration aquí, usamos una granularidad gruesa
    // de 30 minutos (suficiente para el calendario mensual: cualquier
    // hueco libre real se proyecta como slot verde).
    const step = 30;
    for (let t = ws; t + 60 <= we; t += step) {
      const slotStart = t;
      const slotEnd = t + 60;
      for (const pid of providerIds) {
        const provBookings = byProvider.get(pid);
        if (!provBookings || provBookings.length === 0) return true; // provider sin bookings = libre
        const overlaps = provBookings.some(
          (pb) => pb.s < slotEnd && pb.e > slotStart,
        );
        if (!overlaps) return true; // este provider tiene este slot libre
      }
    }
    // Llegamos aquí solo si cada slotStart está solapado para TODOS
    // los providers del día → todo reservado.
    // (Guardamos `totalSlots` solo para legibilidad; no se usa en el bucle
    // porque la granularidad del escaneo no necesita igualarlo.)
    void totalSlots;
    // `product` no longer filters the bookings (a provider is busy for any
    // service); kept in the signature for the call site.
    void product;
    return false;
  }

  /** Count how many slots of `duration`+`buffer` fit between start..end,
   *  on the block's own grid (starting at `start`). When `endedBy` (HH:mm,
   *  store-local "now" for today) is provided, slots that already ENDED
   *  (`end <= endedBy`) are not counted; a slot in progress still is
   *  (QUI-966 T8 — same rule as the grid and `isSlotEndInPast`). */
  private countTimeSlots(
    start: string,
    end: string,
    duration: number,
    buffer: number,
    endedBy?: string,
  ): number {
    let cur = this.timeToMinutes(start);
    const endMin = this.timeToMinutes(end);
    const nowMin = endedBy ? this.timeToMinutes(endedBy) : null;
    if (duration <= 0 || endMin <= cur) return 0;
    let count = 0;
    while (cur + duration <= endMin) {
      if (nowMin === null || cur + duration > nowMin) count++;
      cur += duration + buffer;
    }
    return count;
  }
}
