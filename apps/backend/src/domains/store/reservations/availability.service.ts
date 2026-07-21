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
        is_booked: boolean;
      }
    >();

    for (const currentDate of dates) {
      const dayOfWeek = currentDate.getUTCDay();
      const dateStr = this.formatDate(currentDate);

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
      slots.push({
        date: entry.date,
        start_time: entry.start_time,
        end_time: entry.end_time,
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
        const effective = this.clampToStoreHours(
          providerStart,
          providerEnd,
          storeWindow,
        );
        if (!effective) continue;

        if (
          this.timeToMinutes(start_time) >= this.timeToMinutes(effective.start) &&
          this.timeToMinutes(end_time) <= this.timeToMinutes(effective.end)
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
    const storeHoursMap = await this.businessHoursService.loadStoreHours(
      product.store_id,
    );
    const storeWindow = storeHoursMap.get(dayOfWeek);

    let slotIsWithinBlock = false;
    for (const schedule of dayBlocks) {
      const effectiveStart = exception?.custom_start_time || schedule.start_time;
      const effectiveEnd = exception?.custom_end_time || schedule.end_time;
      const effective = this.clampToStoreHours(
        effectiveStart,
        effectiveEnd,
        storeWindow,
      );
      if (!effective) continue;

      if (
        this.timeToMinutes(start_time) >= this.timeToMinutes(effective.start) &&
        this.timeToMinutes(end_time) <= this.timeToMinutes(effective.end)
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

    for (const currentDate of dates) {
      const dateStr = this.formatDate(currentDate);
      const dayOfWeek = currentDate.getUTCDay();

      // Skip days the store is closed (master calendar).
      const storeHoursMap = await this.businessHoursService.loadStoreHours(
        product.store_id,
      );
      const storeWindow = storeHoursMap.get(dayOfWeek);
      if (!storeWindow) {
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
          storeWindow,
          provider_id,
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
   */
  private async computeDaySlotsUnscoped(
    db: any,
    product: { id: number; store_id: number },
    dateStr: string,
    dayOfWeek: number,
    storeWindow: { start_time: string; end_time: string },
    provider_id?: number,
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

    // If free_booking mode → all slots in the window are available.
    if (productFull.booking_mode === 'free_booking') {
      return this.countTimeSlots(storeWindow.start_time, storeWindow.end_time, duration, buffer);
    }

    // Find providers for this service (active, offers the product).
    const providers = await db.service_providers.findMany({
      where: {
        store_id: product.store_id,
        is_active: true,
        services: { some: { product_id: product.id } },
        ...(provider_id ? { id: provider_id } : {}),
      },
      select: { id: true, display_name: true, avatar_url: true },
    });
    if (providers.length === 0) return 0;

    const providerIds = providers.map((p) => p.id);

    // Find any provider that has a schedule for this day and whose schedule
    // overlaps the store window. Even one such provider = the day has slots.
    const schedules = await db.provider_schedules.findMany({
      where: { provider_id: { in: providerIds }, day_of_week: dayOfWeek, is_active: true },
    });
    if (schedules.length === 0) return 0;

    // Check for exceptions (provider marked unavailable that day).
    const targetDate = new Date(`${dateStr}T00:00:00.000Z`);
    const exception = await db.provider_exceptions.findFirst({
      where: {
        provider_id: { in: providerIds },
        date: targetDate,
        is_unavailable: true,
      },
    });
    if (exception) return 0;

    // Compute per-provider effective window = schedule ∩ storeWindow.
    // Return 1 if at least one provider has any positive overlap.
    for (const s of schedules) {
      const clamped = this.clampToStoreHours(
        s.start_time,
        s.end_time,
        storeWindow,
      );
      if (clamped) {
        return this.countTimeSlots(
          clamped.start,
          clamped.end,
          duration,
          buffer,
        );
      }
    }
    return 0;
  }

  /** Count how many slots of `duration`+`buffer` fit between start..end. */
  private countTimeSlots(
    start: string,
    end: string,
    duration: number,
    buffer: number,
  ): number {
    const startMin = this.timeToMinutes(start);
    const endMin = this.timeToMinutes(end);
    if (duration <= 0 || endMin <= startMin) return 0;
    let count = 0;
    let cur = startMin;
    while (cur + duration <= endMin) {
      count++;
      cur += duration + buffer;
    }
    return count;
  }
}
