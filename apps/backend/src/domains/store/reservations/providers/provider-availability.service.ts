import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { booking_status_enum, Prisma } from '@prisma/client';

export interface ProviderAvailabilityDay {
  date: string;
  total_slots: number;
  booked_slots: number;
  free_slots: number;
  occupancy_pct: number;
}

export interface ProviderAvailabilityRow {
  provider_id: number;
  display_name: string;
  avatar_url: string | null;
  total_slots: number;
  booked_slots: number;
  free_slots: number;
  occupancy_pct: number;
  days: ProviderAvailabilityDay[];
}

export interface ProviderAvailabilityOverview {
  date_from: string;
  date_to: string;
  slot_minutes: number;
  providers: ProviderAvailabilityRow[];
  totals: {
    total_slots: number;
    booked_slots: number;
    free_slots: number;
    occupancy_pct: number;
    most_loaded_provider_id: number | null;
    most_loaded_provider_name: string | null;
    average_occupancy_pct: number;
  };
}

/**
 * Builds the provider availability overview consumed by the
 * `/admin/reservations/availability` dashboard.
 *
 * Reuses the same time-grid concept as `AvailabilityService` but flips the
 * grouping: instead of "slots × providers that cover them", this returns
 * "providers × days with slot counts and occupancy".
 *
 * Algorithm:
 *   1. Resolve active providers (filter by query.provider_id if provided).
 *   2. For each provider, expand its weekly schedule × exception overrides
 *      into discrete slots for every date in the requested range.
 *   3. Subtract already-booked slots (non-cancelled bookings) per
 *      provider × day.
 *   4. Aggregate into days and totals.
 *
 * NOTE: This is a capacity/overview view, not a per-slot booking view. For
 *       "which exact slot is free" use `AvailabilityService.getAvailableSlots`.
 */
@Injectable()
export class ProviderAvailabilityService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getOverview(params: {
    date_from: string;
    date_to: string;
    provider_id?: number;
    product_id?: number;
    slot_minutes?: number;
  }): Promise<ProviderAvailabilityOverview> {
    const slotMinutes = params.slot_minutes ?? 30;
    const dates = this.getDatesInRange(params.date_from, params.date_to);

    // Resolve duration/buffer from the product if provided
    let productDuration = slotMinutes;
    let productBuffer = 0;
    if (params.product_id) {
      const product = await this.prisma.products.findFirst({
        where: { id: params.product_id },
        select: {
          service_duration_minutes: true,
          buffer_minutes: true,
        },
      });
      if (product) {
        productDuration =
          product.service_duration_minutes ?? slotMinutes;
        productBuffer = product.buffer_minutes ?? 0;
      }
    }

    // Load providers
    const providerWhere: Prisma.service_providersWhereInput = {
      is_active: true,
    };
    if (params.provider_id) providerWhere.id = params.provider_id;
    const providers = await this.prisma.service_providers.findMany({
      where: providerWhere,
      select: {
        id: true,
        display_name: true,
        avatar_url: true,
      },
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    });

    if (providers.length === 0) {
      return {
        date_from: params.date_from,
        date_to: params.date_to,
        slot_minutes: slotMinutes,
        providers: [],
        totals: {
          total_slots: 0,
          booked_slots: 0,
          free_slots: 0,
          occupancy_pct: 0,
          most_loaded_provider_id: null,
          most_loaded_provider_name: null,
          average_occupancy_pct: 0,
        },
      };
    }

    const providerIds = providers.map((p) => p.id);

    // Load schedules for all providers in one query
    const schedules = await this.prisma.provider_schedules.findMany({
      where: { provider_id: { in: providerIds }, is_active: true },
    });
    const schedulesByProvider = new Map<
      number,
      typeof schedules
    >();
    for (const s of schedules) {
      const arr = schedulesByProvider.get(s.provider_id) ?? [];
      arr.push(s);
      schedulesByProvider.set(s.provider_id, arr);
    }

    // Load exceptions overlapping the range
    const exceptions = await this.prisma.provider_exceptions.findMany({
      where: {
        provider_id: { in: providerIds },
        date: {
          gte: new Date(params.date_from),
          lte: new Date(params.date_to),
        },
      },
    });
    const exceptionsByProvider = new Map<
      number,
      typeof exceptions
    >();
    for (const e of exceptions) {
      const arr = exceptionsByProvider.get(e.provider_id) ?? [];
      arr.push(e);
      exceptionsByProvider.set(e.provider_id, arr);
    }

    // Load bookings overlapping the range (cancelled + no_show excluded
    // from occupancy — both represent an empty slot in practice: a
    // cancellation means the time is freed; a no_show means the
    // customer never arrived, so counting it would inflate
    // booked_slots and occupancy_pct against the provider's real
    // workload).
    const bookings = await this.prisma.bookings.findMany({
      where: {
        provider_id: { in: providerIds },
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
        date: true,
        start_time: true,
      },
    });

    // Bucket booked slots per provider × date string → count of discrete slots occupied
    const bookingsByProviderDate = new Map<string, Set<string>>();
    const bookKey = (pid: number, dateStr: string) => `${pid}|${dateStr}`;
    for (const b of bookings) {
      if (!b.provider_id) continue;
      const dateStr = this.formatDate(new Date(b.date));
      const key = bookKey(b.provider_id, dateStr);
      const set = bookingsByProviderDate.get(key) ?? new Set<string>();
      set.add(b.start_time);
      bookingsByProviderDate.set(key, set);
    }

    // Build provider rows
    const rows: ProviderAvailabilityRow[] = providers.map((p) => {
      const provSchedules = schedulesByProvider.get(p.id) ?? [];
      const provExceptions = exceptionsByProvider.get(p.id) ?? [];

      const days: ProviderAvailabilityDay[] = dates.map((d) => {
        const dateStr = this.formatDate(d);
        const dayOfWeek = d.getUTCDay();

        // Find exception for this date
        const exception = provExceptions.find(
          (e) => this.formatDate(new Date(e.date)) === dateStr,
        );

        let totalSlots = 0;
        if (!exception?.is_unavailable) {
          // Find the active schedule for this day-of-week
          const schedule = provSchedules.find(
            (s) => s.day_of_week === dayOfWeek,
          );
          if (schedule) {
            const effectiveStart =
              exception?.custom_start_time ?? schedule.start_time;
            const effectiveEnd =
              exception?.custom_end_time ?? schedule.end_time;
            totalSlots = this.countSlots(
              effectiveStart,
              effectiveEnd,
              productDuration,
              productBuffer,
            );
          }
        }

        const bookedSlots =
          bookingsByProviderDate.get(bookKey(p.id, dateStr))?.size ?? 0;
        const freeSlots = Math.max(totalSlots - bookedSlots, 0);
        const occupancy =
          totalSlots > 0
            ? Math.round((bookedSlots / totalSlots) * 10000) / 100
            : 0;

        return {
          date: dateStr,
          total_slots: totalSlots,
          booked_slots: bookedSlots,
          free_slots: freeSlots,
          occupancy_pct: occupancy,
        };
      });

      const totalSlots = days.reduce((s, d) => s + d.total_slots, 0);
      const bookedSlots = days.reduce((s, d) => s + d.booked_slots, 0);
      const freeSlots = days.reduce((s, d) => s + d.free_slots, 0);
      const occupancy =
        totalSlots > 0
          ? Math.round((bookedSlots / totalSlots) * 10000) / 100
          : 0;

      return {
        provider_id: p.id,
        display_name: p.display_name ?? '',
        avatar_url: p.avatar_url ?? null,
        total_slots: totalSlots,
        booked_slots: bookedSlots,
        free_slots: freeSlots,
        occupancy_pct: occupancy,
        days,
      };
    });

    // Aggregate totals
    const totalSlots = rows.reduce((s, r) => s + r.total_slots, 0);
    const bookedSlots = rows.reduce((s, r) => s + r.booked_slots, 0);
    const freeSlots = rows.reduce((s, r) => s + r.free_slots, 0);
    const occupancy =
      totalSlots > 0
        ? Math.round((bookedSlots / totalSlots) * 10000) / 100
        : 0;

    let mostLoaded: ProviderAvailabilityRow | null = null;
    for (const r of rows) {
      if (
        !mostLoaded ||
        r.occupancy_pct > mostLoaded.occupancy_pct
      ) {
        mostLoaded = r;
      }
    }

    const averageOccupancy =
      rows.length > 0
        ? Math.round(
            (rows.reduce((s, r) => s + r.occupancy_pct, 0) /
              rows.length) *
              100,
          ) / 100
        : 0;

    return {
      date_from: params.date_from,
      date_to: params.date_to,
      slot_minutes: slotMinutes,
      providers: rows,
      totals: {
        total_slots: totalSlots,
        booked_slots: bookedSlots,
        free_slots: freeSlots,
        occupancy_pct: occupancy,
        most_loaded_provider_id: mostLoaded?.provider_id ?? null,
        most_loaded_provider_name: mostLoaded?.display_name ?? null,
        average_occupancy_pct: averageOccupancy,
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
    // Guard: date_to must be >= date_from. The frontend clamps user input,
    // but direct API calls (integrations, scripts) could send inverted
    // ranges and silently get []. Clamp to surface a meaningful result.
    const effectiveTo = to < from ? from : to;
    const dates: Date[] = [];
    const cur = new Date(from);
    const end = new Date(effectiveTo);
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
