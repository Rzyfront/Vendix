import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { booking_status_enum, Prisma } from '@prisma/client';

export interface ServiceAvailabilityRow {
  product_id: number;
  product_name: string;
  total_slots: number;
  booked_slots: number;
  free_slots: number;
  occupancy_pct: number;
  providers_count: number;
}

export interface ServiceAvailabilityOverview {
  date_from: string;
  date_to: string;
  services: ServiceAvailabilityRow[];
  totals: {
    total_services: number;
    total_slots: number;
    booked_slots: number;
    free_slots: number;
    average_occupancy_pct: number;
    most_booked_service_id: number | null;
    most_booked_service_name: string | null;
  };
}

/**
 * Builds a per-service availability overview.
 *
 * Groups capacity by product (service) instead of by provider.
 * Answers: "which services have the most free capacity?"
 */
@Injectable()
export class ServiceAvailabilityService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getOverview(params: {
    date_from: string;
    date_to: string;
    product_id?: number;
    slot_minutes?: number;
  }): Promise<ServiceAvailabilityOverview> {
    const slotMinutes = params.slot_minutes ?? 30;
    const dates = this.getDatesInRange(params.date_from, params.date_to);

    // Load active products that have services with bookings or provider assignments
    const productWhere: Prisma.productsWhereInput = {
      product_type: 'service',
      requires_booking: true,
      state: 'active',
    };
    if (params.product_id) productWhere.id = params.product_id;

    const products = await this.prisma.products.findMany({
      where: productWhere,
      select: {
        id: true,
        name: true,
        service_duration_minutes: true,
        buffer_minutes: true,
      },
      orderBy: { name: 'asc' },
    });

    if (products.length === 0) {
      return {
        date_from: params.date_from,
        date_to: params.date_to,
        services: [],
        totals: {
          total_services: 0,
          total_slots: 0,
          booked_slots: 0,
          free_slots: 0,
          average_occupancy_pct: 0,
          most_booked_service_id: null,
          most_booked_service_name: null,
        },
      };
    }

    const productIds = products.map((p) => p.id);

    // Load providers assigned to each product
    const assignments = await this.prisma.provider_services.findMany({
      where: { product_id: { in: productIds } },
      select: { product_id: true, provider_id: true },
    });
    const providersByProduct = new Map<number, Set<number>>();
    for (const a of assignments) {
      const set = providersByProduct.get(a.product_id) ?? new Set();
      set.add(a.provider_id);
      providersByProduct.set(a.product_id, set);
    }

    // Load schedules for all relevant providers
    const allProviderIds = [...new Set(assignments.map((a) => a.provider_id))];
    const schedules = allProviderIds.length > 0
      ? await this.prisma.provider_schedules.findMany({
          where: { provider_id: { in: allProviderIds }, is_active: true },
        })
      : [];
    const schedulesByProvider = new Map<number, typeof schedules>();
    for (const s of schedules) {
      const arr = schedulesByProvider.get(s.provider_id) ?? [];
      arr.push(s);
      schedulesByProvider.set(s.provider_id, arr);
    }

    // Load exceptions for the date range
    const exceptions = allProviderIds.length > 0
      ? await this.prisma.provider_exceptions.findMany({
          where: {
            provider_id: { in: allProviderIds },
            date: {
              gte: new Date(params.date_from),
              lte: new Date(params.date_to),
            },
          },
        })
      : [];
    const exceptionsByProvider = new Map<number, typeof exceptions>();
    for (const e of exceptions) {
      const arr = exceptionsByProvider.get(e.provider_id) ?? [];
      arr.push(e);
      exceptionsByProvider.set(e.provider_id, arr);
    }

    // Load bookings for all relevant providers in the range
    const bookings = allProviderIds.length > 0
      ? await this.prisma.bookings.findMany({
          where: {
            provider_id: { in: allProviderIds },
            product_id: { in: productIds },
            date: {
              gte: new Date(params.date_from),
              lte: new Date(params.date_to),
            },
            status: {
              notIn: [booking_status_enum.cancelled, booking_status_enum.no_show],
            },
          },
          select: {
            provider_id: true,
            product_id: true,
            date: true,
            start_time: true,
          },
        })
      : [];

    // Bucket bookings by provider × date
    const bookingsByProviderDate = new Map<string, Set<string>>();
    const bookKey = (pid: number, dateStr: string) => `${pid}|${dateStr}`;
    for (const b of bookings) {
      if (!b.provider_id) continue;
      const dateStr = this.formatDate(new Date(b.date));
      const key = bookKey(b.provider_id, dateStr);
      const set = bookingsByProviderDate.get(key) ?? new Set();
      set.add(b.start_time);
      bookingsByProviderDate.set(key, set);
    }

    // Build per-service rows
    const rows: ServiceAvailabilityRow[] = products.map((product) => {
      const providerIdsForProduct = [
        ...(providersByProduct.get(product.id) ?? []),
      ];
      const duration = product.service_duration_minutes ?? slotMinutes;
      const buffer = product.buffer_minutes ?? 0;

      let totalSlots = 0;
      let bookedSlots = 0;

      for (const pid of providerIdsForProduct) {
        const provSchedules = schedulesByProvider.get(pid) ?? [];
        const provExceptions = exceptionsByProvider.get(pid) ?? [];

        for (const d of dates) {
          const dateStr = this.formatDate(d);
          const dayOfWeek = d.getUTCDay();

          const exception = provExceptions.find(
            (e) => this.formatDate(new Date(e.date)) === dateStr,
          );

          let daySlots = 0;
          if (!exception?.is_unavailable) {
            const schedule = provSchedules.find(
              (s) => s.day_of_week === dayOfWeek,
            );
            if (schedule) {
              const effectiveStart =
                exception?.custom_start_time ?? schedule.start_time;
              const effectiveEnd =
                exception?.custom_end_time ?? schedule.end_time;
              daySlots = this.countSlots(
                effectiveStart,
                effectiveEnd,
                duration,
                buffer,
              );
            }
          }

          totalSlots += daySlots;

          const booked =
            bookingsByProviderDate.get(bookKey(pid, dateStr))?.size ?? 0;
          bookedSlots += Math.min(booked, daySlots);
        }
      }

      const freeSlots = Math.max(totalSlots - bookedSlots, 0);
      const occupancy =
        totalSlots > 0
          ? Math.round((bookedSlots / totalSlots) * 10000) / 100
          : 0;

      return {
        product_id: product.id,
        product_name: product.name,
        total_slots: totalSlots,
        booked_slots: bookedSlots,
        free_slots: freeSlots,
        occupancy_pct: occupancy,
        providers_count: providerIdsForProduct.length,
      };
    });

    // Totals
    const totalSlots = rows.reduce((s, r) => s + r.total_slots, 0);
    const bookedSlots = rows.reduce((s, r) => s + r.booked_slots, 0);
    const freeSlots = rows.reduce((s, r) => s + r.free_slots, 0);
    const avgOccupancy =
      rows.length > 0
        ? Math.round(
            (rows.reduce((s, r) => s + r.occupancy_pct, 0) / rows.length) *
              100,
          ) / 100
        : 0;

    let mostBooked: ServiceAvailabilityRow | null = null;
    for (const r of rows) {
      if (!mostBooked || r.booked_slots > mostBooked.booked_slots) {
        mostBooked = r;
      }
    }

    return {
      date_from: params.date_from,
      date_to: params.date_to,
      services: rows,
      totals: {
        total_services: rows.length,
        total_slots: totalSlots,
        booked_slots: bookedSlots,
        free_slots: freeSlots,
        average_occupancy_pct: avgOccupancy,
        most_booked_service_id: mostBooked?.product_id ?? null,
        most_booked_service_name: mostBooked?.product_name ?? null,
      },
    };
  }

  // --- Helpers ---

  private countSlots(
    start: string,
    end: string,
    duration: number,
    buffer: number,
  ): number {
    let count = 0;
    let cur = this.timeToMinutes(start);
    const endMin = this.timeToMinutes(end);
    while (cur + duration <= endMin) {
      count += 1;
      cur += duration + buffer;
    }
    return count;
  }

  private getDatesInRange(from: string, to: string): Date[] {
    const dates: Date[] = [];
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      dates.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }

  private formatDate(d: Date): string {
    const y = d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }
}
