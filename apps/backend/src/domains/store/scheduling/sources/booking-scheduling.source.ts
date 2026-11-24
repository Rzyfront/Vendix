import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  dateOnlyString,
  zonedWallClockToUtc,
} from '../../../../common/utils/store-timezone.util';
import {
  SCHEDULING_SOURCES,
  SchedulingEvent,
  SchedulingFilters,
  SchedulingSource,
  SchedulingSourcePage,
  SchedulingStatusGroup,
  SchedulingStoreContext,
} from '../scheduling.types';

type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'arriving'
  | 'attending'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  in_progress: 'En progreso',
  arriving: 'Llegando',
  attending: 'En atención',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
};

export const BOOKING_STATUS_GROUP: Record<BookingStatus, SchedulingStatusGroup> = {
  pending: 'pending',
  confirmed: 'confirmed',
  in_progress: 'in_progress',
  arriving: 'in_progress',
  attending: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

/** Estados nativos que caen en los grupos pedidos. */
export function bookingStatusesForGroups(
  groups: readonly SchedulingStatusGroup[],
): BookingStatus[] {
  return (Object.keys(BOOKING_STATUS_GROUP) as BookingStatus[]).filter((status) =>
    groups.includes(BOOKING_STATUS_GROUP[status]),
  );
}

const BOOKING_SELECT = {
  id: true,
  booking_number: true,
  date: true,
  end_date: true,
  start_time: true,
  end_time: true,
  status: true,
  order_id: true,
  customer: { select: { id: true, first_name: true, last_name: true } },
  product: { select: { id: true, name: true } },
  provider: {
    select: {
      id: true,
      display_name: true,
      user: { select: { first_name: true, last_name: true } },
    },
  },
} satisfies Prisma.bookingsSelect;

export type SchedulingBookingRow = Prisma.bookingsGetPayload<{
  select: typeof BOOKING_SELECT;
}>;

function fullName(
  person: { first_name?: string | null; last_name?: string | null } | null | undefined,
): string {
  return [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function wallClockToIso(ymd: string, hhmm: string, timezone: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, min] = (hhmm || '00:00').split(':').map(Number);
  return zonedWallClockToUtc(y, m, d, h || 0, min || 0, 0, 0, timezone).toISOString();
}

/**
 * `bookings` guarda fecha + hora local de la tienda (`HH:MM`). Termina el día
 * siguiente cuando `end_time <= start_time` o cuando trae `end_date` (S21).
 */
export function normalizeBooking(
  row: SchedulingBookingRow,
  timezone: string,
): SchedulingEvent {
  const status = row.status as BookingStatus;
  const date = dateOnlyString(row.date);
  const endDate = row.end_date
    ? dateOnlyString(row.end_date)
    : row.end_time <= row.start_time
      ? addDaysYmd(date, 1)
      : date;
  const customerName = fullName(row.customer);
  const providerName =
    row.provider?.display_name?.trim() || fullName(row.provider?.user) || null;
  return {
    id: `booking:${row.id}`,
    type: 'booking',
    type_label: SCHEDULING_SOURCES.booking.label,
    source_id: row.id,
    reference: row.booking_number,
    title: row.product?.name ?? 'Reserva',
    start: wallClockToIso(date, row.start_time, timezone),
    end: wallClockToIso(endDate, row.end_time, timezone),
    date,
    local_start: row.start_time,
    end_date: endDate,
    local_end: row.end_time,
    status,
    status_label: BOOKING_STATUS_LABELS[status] ?? status,
    status_group: BOOKING_STATUS_GROUP[status] ?? 'pending',
    staff: row.provider ? { id: row.provider.id, name: providerName ?? 'Sin nombre' } : null,
    customer: row.customer
      ? { id: row.customer.id, name: customerName || 'Cliente' }
      : null,
    order_id: row.order_id ?? null,
    detail: row.product?.name ?? null,
  };
}

/** Filtro Prisma de la fuente. `null` = el filtro deja la fuente vacía. */
export function buildBookingWhere(
  filters: SchedulingFilters,
): Prisma.bookingsWhereInput | null {
  const where: Prisma.bookingsWhereInput = {};
  if (filters.status_groups?.length) {
    const statuses = bookingStatusesForGroups(filters.status_groups);
    if (!statuses.length) return null;
    where.status = { in: statuses };
  }
  if (filters.staff_ids?.length) {
    where.provider_id = { in: filters.staff_ids };
  }
  if (filters.from || filters.to) {
    const inRange: Prisma.bookingsWhereInput = {
      date: {
        ...(filters.from && { gte: new Date(filters.from) }),
        ...(filters.to && { lte: new Date(filters.to) }),
      },
    };
    if (filters.from) {
      // Reserva que empezó el día anterior y termina dentro del rango
      // (p. ej. 23:00–01:00): su tramo de 00:00 también se ve en el rango.
      where.AND = [
        {
          OR: [
            inRange,
            {
              date: new Date(addDaysYmd(filters.from.slice(0, 10), -1)),
              end_date: { gte: new Date(filters.from) },
            },
          ],
        },
      ];
    } else {
      where.date = inRange.date;
    }
  }
  const search = filters.search?.trim();
  if (search) {
    const contains = { contains: search, mode: 'insensitive' as const };
    where.OR = [
      { booking_number: contains },
      { product: { name: contains } },
      { customer: { first_name: contains } },
      { customer: { last_name: contains } },
      { provider: { display_name: contains } },
    ];
  }
  return where;
}

/** Adaptador de reservas de servicio: filtra, cuenta y pagina en la base. */
@Injectable()
export class BookingSchedulingSource implements SchedulingSource {
  readonly type = 'booking' as const;

  constructor(private readonly prisma: StorePrismaService) {}

  async fetch(
    ctx: SchedulingStoreContext,
    filters: SchedulingFilters,
    take: number,
  ): Promise<SchedulingSourcePage> {
    const where = buildBookingWhere(filters);
    if (!where) return { total: 0, events: [], truncated: false };
    const direction = filters.order === 'desc' ? 'desc' : 'asc';
    // `start_time` es `HH:MM`: el orden de texto es el orden de la hora.
    const [rows, total] = await Promise.all([
      this.prisma.bookings.findMany({
        where,
        orderBy: [{ date: direction }, { start_time: direction }, { id: direction }],
        take,
        select: BOOKING_SELECT,
      }),
      this.prisma.bookings.count({ where }),
    ]);
    return {
      total,
      events: rows.map((row) => normalizeBooking(row, ctx.timezone)),
      truncated: false,
    };
  }
}
