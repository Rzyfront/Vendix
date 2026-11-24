import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  localCivil,
  localDateString,
  zonedWallClockToUtc,
} from '../../../../common/utils/store-timezone.util';
import {
  FulfillmentDisplayStatus,
  deriveFulfillmentDisplayStatus,
  kitchenPendingItemsWhere,
} from '../../scheduled-orders/scheduled-orders.service';
import {
  SCHEDULING_SOURCES,
  SchedulingEvent,
  SchedulingFilters,
  SchedulingSource,
  SchedulingSourcePage,
  SchedulingStatusGroup,
  SchedulingStoreContext,
  compareSchedulingEvents,
} from '../scheduling.types';

/** Mismas etiquetas que la agenda de pedidos del panel. */
export const SCHEDULED_ORDER_STATUS_LABELS: Record<FulfillmentDisplayStatus, string> = {
  scheduled: 'Programada',
  in_production: 'En producción',
  ready: 'Lista',
  delivered: 'Entregada',
  expired: 'Vencido',
  cancelled: 'Cancelada',
};

export const SCHEDULED_ORDER_STATUS_GROUP: Record<
  FulfillmentDisplayStatus,
  SchedulingStatusGroup
> = {
  scheduled: 'confirmed',
  in_production: 'in_progress',
  ready: 'in_progress',
  delivered: 'completed',
  expired: 'no_show',
  cancelled: 'cancelled',
};

/**
 * Tope de filas que esta fuente lee por consulta. El estado visible se deriva
 * en lectura (venta, producción y cocina), así que el filtro de estado se
 * aplica en memoria sobre el rango; el tope evita leer años completos.
 */
export const SCHEDULED_ORDER_READ_CAP = 2000;

const SCHEDULE_SELECT = {
  id: true,
  order_id: true,
  scheduled_start: true,
  scheduled_end: true,
  fulfillment_type: true,
  status: true,
  produced_at: true,
  order: {
    select: {
      id: true,
      order_number: true,
      state: true,
      customer_id: true,
      customer_alias: true,
      users: { select: { id: true, first_name: true, last_name: true } },
      production_orders: {
        where: { status: { not: 'cancelled' } },
        select: { status: true },
      },
    },
  },
} satisfies Prisma.order_fulfillment_schedulesSelect;

export type SchedulingScheduleRow = Prisma.order_fulfillment_schedulesGetPayload<{
  select: typeof SCHEDULE_SELECT;
}>;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localClock(date: Date, timezone: string): string {
  const p = localCivil(date, timezone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

function customerOf(row: SchedulingScheduleRow): SchedulingEvent['customer'] {
  const user = row.order?.users;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim();
  if (user) return { id: user.id, name: name || 'Cliente' };
  if (row.order?.customer_alias) return { id: null, name: row.order.customer_alias };
  return null;
}

export function normalizeScheduledOrder(
  row: SchedulingScheduleRow,
  display: FulfillmentDisplayStatus,
  timezone: string,
): SchedulingEvent {
  const reference = row.order?.order_number ?? `#${row.order_id}`;
  return {
    id: `scheduled_order:${row.id}`,
    type: 'scheduled_order',
    type_label: SCHEDULING_SOURCES.scheduled_order.label,
    source_id: row.id,
    reference,
    title: `Pedido ${reference}`,
    start: row.scheduled_start.toISOString(),
    end: row.scheduled_end.toISOString(),
    date: localDateString(row.scheduled_start, timezone),
    local_start: localClock(row.scheduled_start, timezone),
    end_date: localDateString(row.scheduled_end, timezone),
    local_end: localClock(row.scheduled_end, timezone),
    status: display,
    status_label: SCHEDULED_ORDER_STATUS_LABELS[display] ?? display,
    status_group: SCHEDULED_ORDER_STATUS_GROUP[display] ?? 'confirmed',
    staff: null,
    customer: customerOf(row),
    order_id: row.order_id,
    detail: row.fulfillment_type === 'delivery' ? 'Domicilio' : 'Recoger en tienda',
  };
}

/** Rango local de la tienda → instantes UTC `[gte, lt)`. */
export function scheduleRangeWhere(
  filters: Pick<SchedulingFilters, 'from' | 'to'>,
  timezone: string,
): Prisma.DateTimeFilter | undefined {
  if (!filters.from && !filters.to) return undefined;
  const at = (ymd: string, plusDays: number) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return zonedWallClockToUtc(y, m, d + plusDays, 0, 0, 0, 0, timezone);
  };
  return {
    ...(filters.from && { gte: at(filters.from, 0) }),
    ...(filters.to && { lt: at(filters.to, 1) }),
  };
}

/**
 * Adaptador de pedidos programados. Reutiliza la derivación de estado y el
 * conteo de platos pendientes de cocina del módulo (`scheduled-orders`): una
 * lectura de agendamientos + un `groupBy` para todo el rango, sin N+1.
 */
@Injectable()
export class ScheduledOrderSchedulingSource implements SchedulingSource {
  readonly type = 'scheduled_order' as const;

  constructor(private readonly prisma: StorePrismaService) {}

  async fetch(
    ctx: SchedulingStoreContext,
    filters: SchedulingFilters,
    take: number,
  ): Promise<SchedulingSourcePage> {
    // Los pedidos no tienen personal asignado: con filtro de personal no aplican.
    if (filters.staff_ids?.length) return { total: 0, events: [], truncated: false };

    const where: Prisma.order_fulfillment_schedulesWhereInput = {};
    const range = scheduleRangeWhere(filters, ctx.timezone);
    if (range) where.scheduled_start = range;
    const search = filters.search?.trim();
    if (search) {
      const contains = { contains: search, mode: 'insensitive' as const };
      where.order = {
        OR: [
          { order_number: contains },
          { customer_alias: contains },
          { users: { first_name: contains } },
          { users: { last_name: contains } },
        ],
      };
    }

    const rows = await this.prisma.order_fulfillment_schedules.findMany({
      where,
      orderBy: [
        { scheduled_start: filters.order === 'desc' ? 'desc' : 'asc' },
        { id: filters.order === 'desc' ? 'desc' : 'asc' },
      ],
      take: SCHEDULED_ORDER_READ_CAP + 1,
      select: SCHEDULE_SELECT,
    });
    const truncated = rows.length > SCHEDULED_ORDER_READ_CAP;
    const kept = truncated ? rows.slice(0, SCHEDULED_ORDER_READ_CAP) : rows;

    const pendingByOrder = new Map<number, number>();
    if (kept.length > 0) {
      const grouped = await (
        this.prisma.withoutScope() as unknown as Prisma.TransactionClient
      ).order_items.groupBy({
        by: ['order_id'],
        where: kitchenPendingItemsWhere(
          kept.map((row) => row.order_id),
          ctx.store_id,
        ),
        _count: { _all: true },
      });
      for (const g of grouped) pendingByOrder.set(g.order_id, g._count._all);
    }

    const now = new Date();
    const groups = filters.status_groups;
    const events = kept
      .map((row) =>
        normalizeScheduledOrder(
          row,
          deriveFulfillmentDisplayStatus(
            {
              stored_status: row.status,
              produced_at: row.produced_at ?? null,
              scheduled_end: row.scheduled_end,
              order_state: row.order?.state,
              production_statuses: (row.order?.production_orders ?? []).map((o) => o.status),
              pending_kitchen_count: pendingByOrder.get(row.order_id) ?? 0,
            },
            now,
          ),
          ctx.timezone,
        ),
      )
      .filter((event) => !groups?.length || groups.includes(event.status_group))
      .sort((a, b) => compareSchedulingEvents(a, b, filters.order));

    return { total: events.length, events: events.slice(0, take), truncated };
  }
}
