import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { booking_status_enum, booking_mode_enum } from '@prisma/client';
import { BusinessHoursService } from './business-hours/business-hours.service';

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
    options: { provider_id?: number; product_variant_id?: number } = {},
  ): Promise<AvailabilitySlot[]> {
    const { provider_id, product_variant_id } = options;
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

    // Resolve the store's business-hours master calendar once per call.
    // Empty Map = store never configured their hours (legacy fallback).
    const storeHoursMap = await this.businessHoursService.loadStoreHours(
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

    if (isFreeBooking || providers.length === 0) {
      return this.generateGenericSlots(
        product_id,
        date_from,
        date_to,
        duration,
        buffer,
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

    // 6. Obtener bookings existentes (no canceladas) en el rango
    const existingBookings = await this.prisma.bookings.findMany({
      where: {
        product_id,
        date: {
          gte: new Date(date_from),
          lte: new Date(date_to),
        },
        status: { notIn: [booking_status_enum.cancelled] },
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
      }
    >();

    for (const currentDate of dates) {
      const dayOfWeek = currentDate.getUTCDay();
      const dateStr = this.formatDate(currentDate);

      for (const provider of providers) {
        const provSchedules = schedulesByProvider.get(provider.id) || [];
        const schedule = provSchedules.find((s) => s.day_of_week === dayOfWeek);
        if (!schedule) continue;

        // Verificar excepciones para este provider en este dia
        const provExceptions = exceptionsByProvider.get(provider.id) || [];
        const exception = provExceptions.find(
          (e) => this.formatDate(new Date(e.date)) === dateStr,
        );

        // Si el provider no esta disponible este dia, saltar
        if (exception?.is_unavailable) continue;

        // Determinar horario efectivo
        const effectiveStart =
          exception?.custom_start_time || schedule.start_time;
        const effectiveEnd = exception?.custom_end_time || schedule.end_time;

        // Intersectar con horario maestro de la tienda. Si la tienda está
        // cerrada ese día (no hay fila en store_business_hours o está
        // inactiva) o el horario del provider cae fuera de la ventana del
        // store, ese provider no ofrece slots ese día.
        const storeWindow = storeHoursMap.get(dayOfWeek);
        const clamped = this.clampToStoreHours(
          effectiveStart,
          effectiveEnd,
          storeWindow,
        );
        if (!clamped) continue;

        // Generar time slots
        const timeSlots = this.generateTimeSlots(
          clamped.start,
          clamped.end,
          duration,
          buffer,
        );

        for (const slot of timeSlots) {
          // Verificar si este provider ya tiene booking en este slot
          const providerBooked = existingBookings.some(
            (b) =>
              this.formatDate(new Date(b.date)) === dateStr &&
              b.start_time === slot.start_time &&
              b.end_time === slot.end_time &&
              b.provider_id === provider.id,
          );

          if (providerBooked) continue;

          const key = `${dateStr}|${slot.start_time}|${slot.end_time}`;
          if (!slotMap.has(key)) {
            slotMap.set(key, {
              date: dateStr,
              start_time: slot.start_time,
              end_time: slot.end_time,
              providers: [],
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

    // Convertir mapa a array ordenado
    for (const entry of slotMap.values()) {
      slots.push({
        date: entry.date,
        start_time: entry.start_time,
        end_time: entry.end_time,
        available_providers: entry.providers,
        total_available: entry.providers.length,
      });
    }

    // Ordenar por fecha y hora
    slots.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.start_time.localeCompare(b.start_time);
    });

    // Fallback a slots genéricos si proveedores no tienen schedules configurados
    if (slots.length === 0) {
      return this.generateGenericSlots(
        product_id,
        date_from,
        date_to,
        duration,
        buffer,
      );
    }

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
    const storeWindow = storeHoursMap.get(dayOfWeek);
    // No business-hours row for this day → store closed → no providers available.
    if (!storeWindow) return [];

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
      // Verificar schedule para este dia
      const schedule = await this.prisma.provider_schedules.findFirst({
        where: {
          provider_id: provider.id,
          day_of_week: dayOfWeek,
          is_active: true,
        },
      });

      if (!schedule) continue;

      // Verificar excepciones
      const exception = await this.prisma.provider_exceptions.findFirst({
        where: { provider_id: provider.id, date: targetDate },
      });

      if (exception?.is_unavailable) continue;

      // Verificar que el slot cae dentro del horario efectivo del provider
      // Y dentro de la ventana maestra de la tienda. La intersección se hace
      // con el más restrictivo: provider.schedule ∩ store.business_hours.
      const providerStart =
        exception?.custom_start_time || schedule.start_time;
      const providerEnd =
        exception?.custom_end_time || schedule.end_time;
      const effective = this.clampToStoreHours(
        providerStart,
        providerEnd,
        storeWindow,
      );
      if (!effective) continue;

      if (
        this.timeToMinutes(start_time) < this.timeToMinutes(effective.start) ||
        this.timeToMinutes(end_time) > this.timeToMinutes(effective.end)
      ) {
        continue;
      }

      // Verificar si ya tiene booking que se superponga con este slot
      const where: any = {
        provider_id: provider.id,
        date: targetDate,
        start_time: { lt: end_time },
        end_time: { gt: start_time },
        status: { notIn: [booking_status_enum.cancelled] },
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
    const targetDate = new Date(date);
    const requestedStart = this.timeToMinutes(start_time);
    const requestedEnd = this.timeToMinutes(end_time);

    const activeStatuses = [
      booking_status_enum.pending,
      booking_status_enum.confirmed,
      booking_status_enum.in_progress,
    ];

    const where: any = {
      customer_id,
      date: targetDate,
      status: { in: activeStatuses },
    };

    if (exclude_booking_id) {
      where.id = { not: exclude_booking_id };
    }

    const customerBookings = await this.prisma.bookings.findMany({
      where,
      select: { start_time: true, end_time: true, booking_number: true },
    });

    for (const booking of customerBookings) {
      const existingStart = this.timeToMinutes(booking.start_time);
      const existingEnd = this.timeToMinutes(booking.end_time);

      if (requestedStart < existingEnd && requestedEnd > existingStart) {
        throw new BadRequestException(
          `El cliente ya tiene una reserva (${booking.booking_number}) que se superpone con el horario solicitado`,
        );
      }
    }
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

    // Verificar schedule
    const schedule = await this.prisma.provider_schedules.findFirst({
      where: { provider_id, day_of_week: dayOfWeek, is_active: true },
    });

    if (!schedule) return false;

    // Verificar excepciones
    const exception = await this.prisma.provider_exceptions.findFirst({
      where: { provider_id, date: targetDate },
    });

    if (exception?.is_unavailable) return false;

    // Verificar horario efectivo del provider
    const effectiveStart = exception?.custom_start_time || schedule.start_time;
    const effectiveEnd = exception?.custom_end_time || schedule.end_time;

    // Intersectar con el horario maestro de la tienda. Si la tienda está
    // cerrada ese día, este provider no está disponible.
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    if (!product) return false;
    const storeHoursMap = await this.businessHoursService.loadStoreHours(
      product.store_id,
    );
    const storeWindow = storeHoursMap.get(dayOfWeek);
    const effective = this.clampToStoreHours(
      effectiveStart,
      effectiveEnd,
      storeWindow,
    );
    if (!effective) return false;

    if (
      this.timeToMinutes(start_time) < this.timeToMinutes(effective.start) ||
      this.timeToMinutes(end_time) > this.timeToMinutes(effective.end)
    ) {
      return false;
    }

    // Verificar si ya tiene booking que se superponga
    const where: any = {
      provider_id,
      date: targetDate,
      start_time: { lt: end_time },
      end_time: { gt: start_time },
      status: { notIn: [booking_status_enum.cancelled] },
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

  private async generateGenericSlots(
    product_id: number,
    date_from: string,
    date_to: string,
    duration: number,
    buffer: number,
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
        status: { notIn: [booking_status_enum.cancelled] },
      },
      select: { date: true, start_time: true, end_time: true },
    });

    // Resolve the store's working-days setting. Default (Mon-Fri) matches
    // the historic hardcoded skip-weekend behavior so existing stores are
    // unaffected. Stores that open weekends override via
    // `store_settings.settings.availability.working_days`.
    const workingDays = await this.getStoreWorkingDays(product_id);

    // Resolve the store's business-hours master calendar. When the store
    // has configured `store_business_hours`, we use those HH:mm windows
    // instead of the legacy hardcoded 08:00–18:00 default. If the store
    // has no rows at all, fall back to 08:00–18:00 so old stores without
    // a configured calendar keep working unchanged.
    const product = await this.prisma.products.findFirst({
      where: { id: product_id },
      select: { store_id: true },
    });
    const storeHoursMap = product
      ? await this.businessHoursService.loadStoreHours(product.store_id)
      : new Map<number, { start_time: string; end_time: string }>();

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();

      if (!workingDays.includes(dayOfWeek)) continue;

      // Use the store's business-hours window when configured; legacy
      // 08:00–18:00 fallback otherwise.
      const storeWindow = storeHoursMap.get(dayOfWeek);
      const dayStart = storeWindow?.start_time ?? '08:00';
      const dayEnd = storeWindow?.end_time ?? '18:00';
      // If the store explicitly closed this day (no row), skip entirely.
      if (!storeWindow) {
        // No business-hours row + day is in workingDays → use fallback.
        // If workingDays includes this DOW but the store didn't configure
        // business hours, we still emit slots in 08:00–18:00 to preserve
        // legacy behavior.
      }

      const timeSlots = this.generateTimeSlots(dayStart, dayEnd, duration, buffer);

      for (const slot of timeSlots) {
        const bookedCount = existingBookings.filter(
          (b) =>
            this.formatDate(new Date(b.date)) === dateStr &&
            b.start_time === slot.start_time &&
            b.end_time === slot.end_time,
        ).length;

        slots.push({
          date: dateStr,
          start_time: slot.start_time,
          end_time: slot.end_time,
          available_providers: [],
          total_available: Math.max(10 - bookedCount, 0),
        });
      }
    }

    return slots;
  }

  /**
   * Intersects an effective provider window with the store's master
   * business-hours window. Returns null when the intersection is empty
   * (provider schedule outside store hours, or store closed that day).
   *
   * Used by getAvailableSlots, getAvailableProvidersForSlot and
   * isProviderAvailableForSlot to enforce the upper bound.
   */
  private clampToStoreHours(
    providerStart: string,
    providerEnd: string,
    storeWindow: { start_time: string; end_time: string } | undefined,
  ): { start: string; end: string } | null {
    if (!storeWindow) return null;
    const ps = this.timeToMinutes(providerStart);
    const pe = this.timeToMinutes(providerEnd);
    const ss = this.timeToMinutes(storeWindow.start_time);
    const se = this.timeToMinutes(storeWindow.end_time);
    const start = Math.max(ps, ss);
    const end = Math.min(pe, se);
    if (end <= start) return null;
    return { start: this.minutesToTime(start), end: this.minutesToTime(end) };
  }
}
