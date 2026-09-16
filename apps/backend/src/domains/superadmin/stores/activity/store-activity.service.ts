import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  VendixHttpException,
  ErrorCodes,
} from '../../../../common/errors';
import {
  COMPLETED_SALE_STATES,
  computeOperatingRevenue,
  round2,
} from '../../../../store/analytics/analytics-metrics.contract';
import { StoreActivityQueryDto } from './dto/store-activity-query.dto';
import { StoreActivityDetailQueryDto } from './dto/store-activity-detail-query.dto';

/**
 * Read-only aggregates behind `Cuentas > Actividad`.
 *
 * TIMEZONE POLICY (platform scope): this board aggregates ACROSS stores that
 * may live in different timezones, so no single store tz applies — every
 * window and bucket below is deliberately UTC (`Date.UTC` / `getUTC*`). This
 * is the same documented exception as `dashboard.service.ts`, NOT the QUI-487
 * store day-boundary bug; store-scoped analytics keep using the store tz.
 *
 * Scoring (closed by plan):
 * - score = orders_count * 1 + audit_events * 0.2 + active_users * 2
 * - active store = is_active AND (orders_count >= 1 OR audit_events >= 5)
 * - activity meta = 80 (% of active stores)
 * - avg hours/day = distinct UTC (day, hour) pairs with >= 1 audit/order
 *   event, averaged over the days in the window.
 */
export const STORE_ACTIVITY_META_PCT = 80;
export const STORE_ACTIVITY_DEFAULT_WINDOW_DAYS = 30;
export const STORE_ACTIVITY_ACTIVE_AUDIT_THRESHOLD = 5;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PARTS_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface StoreActivityWindow {
  start: Date;
  end: Date;
  days: number;
}

export interface StoreActivityRow {
  store_id: number;
  name: string;
  slug: string;
  organization_name: string | null;
  is_active: boolean;
  score: number;
  orders_count: number;
  audit_events: number;
  active_users: number;
  revenue_operating: number;
  last_activity_at: string | null;
}

export interface StoreActivityStats {
  active_stores: number;
  activity_pct_vs_meta_80: number;
  avg_hours_per_day: number;
  inactive_stores: number;
  orders_total: number;
}

export interface StoreActivityTimelineItem {
  kind: 'order' | 'audit' | 'login';
  id: string;
  occurred_at: string;
  title: string;
  detail?: string;
  channel?: string;
  state?: string;
  actor?: string;
}

function parseUtcDay(value: string): Date {
  const match = DATE_PARTS_REGEX.exec(value);
  if (!match) {
    throw new VendixHttpException(
      ErrorCodes.STORE_VALIDATE_001,
      `Invalid date '${value}': expected YYYY-MM-DD`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new VendixHttpException(
      ErrorCodes.STORE_VALIDATE_001,
      `Invalid date '${value}': expected YYYY-MM-DD`,
    );
  }
  return date;
}

@Injectable()
export class StoreActivityService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  resolveWindow(from?: string, to?: string): StoreActivityWindow {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const defaultEnd = new Date(todayStart.getTime() + DAY_MS);
    const end = to
      ? new Date(parseUtcDay(to).getTime() + DAY_MS)
      : defaultEnd;
    const start = from
      ? parseUtcDay(from)
      : new Date(
          end.getTime() -
            STORE_ACTIVITY_DEFAULT_WINDOW_DAYS * DAY_MS,
        );
    if (start.getTime() >= end.getTime()) {
      throw new VendixHttpException(
        ErrorCodes.STORE_VALIDATE_001,
        'Invalid date range: from must be before to',
      );
    }
    return {
      start,
      end,
      days: Math.max(
        1,
        Math.round((end.getTime() - start.getTime()) / DAY_MS),
      ),
    };
  }

  async getRanking(query: StoreActivityQueryDto): Promise<{
    data: StoreActivityRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 10);
    const window = this.resolveWindow(query.from, query.to);
    const rows = await this.buildRows(query, window);
    const sorted = this.sortRows(
      rows,
      query.sort ?? 'score',
      query.order ?? 'desc',
    );
    const total = sorted.length;
    const data = sorted.slice((page - 1) * limit, page * limit);
    return { data, total, page, limit };
  }

  async getStats(
    query: StoreActivityQueryDto,
  ): Promise<StoreActivityStats> {
    const window = this.resolveWindow(query.from, query.to);
    const rows = await this.buildRows(query, window);
    const active = rows.filter((row) => this.isActiveRow(row));
    const ordersTotal = rows.reduce(
      (sum, row) => sum + row.orders_count,
      0,
    );
    const avgHours = await this.computeAvgHoursPerDay(
      rows.map((row) => row.store_id),
      window,
    );
    return {
      active_stores: active.length,
      activity_pct_vs_meta_80:
        rows.length > 0 ? round2((active.length / rows.length) * 100) : 0,
      avg_hours_per_day: avgHours,
      inactive_stores: rows.length - active.length,
      orders_total: ordersTotal,
    };
  }

  async getDetail(
    storeId: number,
    query: StoreActivityDetailQueryDto,
  ): Promise<{
    summary: StoreActivityRow & { successful_logins: number };
    timeline: StoreActivityTimelineItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new VendixHttpException(
        ErrorCodes.STORE_VALIDATE_001,
        'Invalid store id',
      );
    }
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        slug: true,
        is_active: true,
        organizations: { select: { name: true } },
      },
    });
    if (!store) {
      throw new VendixHttpException(ErrorCodes.ORG_STORE_001);
    }
    const window = this.resolveWindow(query.from, query.to);
    const rows = await this.buildRows(
      { organization_id: undefined } as StoreActivityQueryDto,
      window,
      [storeId],
    );
    const row = rows[0] ?? {
      store_id: store.id,
      name: store.name,
      slug: store.slug,
      organization_name: store.organizations?.name ?? null,
      is_active: store.is_active ?? true,
      score: 0,
      orders_count: 0,
      audit_events: 0,
      active_users: 0,
      revenue_operating: 0,
      last_activity_at: null,
    };

    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    const { items, successfulLogins } = await this.buildTimeline(
      storeId,
      window,
      query,
    );
    const total = items.length;
    const timeline = items.slice((page - 1) * limit, page * limit);
    return {
      summary: { ...row, successful_logins: successfulLogins },
      timeline,
      total,
      page,
      limit,
    };
  }

  // ---- internals ---------------------------------------------------------

  private buildStoreWhere(query: StoreActivityQueryDto) {
    const where: Prisma.storesWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.organization_id !== undefined) {
      where.organization_id = query.organization_id;
    }
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }
    if (query.store_type) {
      where.store_type = query.store_type;
    }
    return where;
  }

  private async buildRows(
    query: StoreActivityQueryDto,
    window: StoreActivityWindow,
    storeIds?: number[],
  ): Promise<StoreActivityRow[]> {
    const stores = storeIds
      ? await this.prisma.stores.findMany({
          where: { id: { in: storeIds } },
          select: {
            id: true,
            name: true,
            slug: true,
            is_active: true,
            organizations: { select: { name: true } },
          },
        })
      : await this.prisma.stores.findMany({
          where: this.buildStoreWhere(query),
          select: {
            id: true,
            name: true,
            slug: true,
            is_active: true,
            organizations: { select: { name: true } },
          },
          orderBy: { id: 'asc' },
        });
    if (stores.length === 0) return [];
    const ids = stores.map((store) => store.id);
    const range = { gte: window.start, lt: window.end };

    const [
      orderCounts,
      revenueRows,
      auditCounts,
      orderMaxRows,
      auditMaxRows,
      loginRows,
      memberships,
    ] = await Promise.all([
      this.prisma.orders.groupBy({
        by: ['store_id'],
        where: { store_id: { in: ids }, created_at: range },
        _count: { _all: true },
      }),
      this.prisma.orders.groupBy({
        by: ['store_id'],
        where: {
          store_id: { in: ids },
          created_at: range,
          state: { in: [...COMPLETED_SALE_STATES] as never[] },
        },
        _count: { _all: true },
        _sum: {
          subtotal_amount: true,
          discount_amount: true,
          shipping_cost: true,
        },
      }),
      this.prisma.audit_logs.groupBy({
        by: ['store_id'],
        where: { store_id: { in: ids }, created_at: range },
        _count: { _all: true },
      }),
      this.prisma.orders.groupBy({
        by: ['store_id'],
        where: { store_id: { in: ids }, created_at: range },
        _max: { created_at: true },
      }),
      this.prisma.audit_logs.groupBy({
        by: ['store_id'],
        where: { store_id: { in: ids }, created_at: range },
        _max: { created_at: true },
      }),
      this.prisma.login_attempts.groupBy({
        by: ['store_id'],
        where: {
          store_id: { in: ids },
          success: true,
          attempted_at: range,
        },
        _max: { attempted_at: true },
      }),
      this.prisma.store_users.findMany({
        where: { store_id: { in: ids } },
        select: { store_id: true, user_id: true },
      }),
    ]);

    const orderCountByStore = new Map<number, number>();
    for (const row of orderCounts) {
      orderCountByStore.set(row.store_id, row._count._all);
    }
    const auditCountByStore = new Map<number, number>();
    for (const row of auditCounts) {
      if (row.store_id === null) continue;
      auditCountByStore.set(row.store_id, row._count._all);
    }
    const revenueByStore = new Map<number, number>();
    for (const row of revenueRows) {
      revenueByStore.set(
        row.store_id,
        round2(
          computeOperatingRevenue({
            subtotal: Number(row._sum.subtotal_amount ?? 0),
            discounts: Number(row._sum.discount_amount ?? 0),
            shipping: Number(row._sum.shipping_cost ?? 0),
            tax: 0,
          }),
        ),
      );
    }

    const lastActivityByStore = new Map<number, number>();
    const trackMax = (storeId: number | null, value: Date | null) => {
      if (storeId === null || !value) return;
      const time = value.getTime();
      const current = lastActivityByStore.get(storeId);
      if (current === undefined || time > current) {
        lastActivityByStore.set(storeId, time);
      }
    };
    for (const row of orderMaxRows) trackMax(row.store_id, row._max.created_at);
    for (const row of auditMaxRows) trackMax(row.store_id, row._max.created_at);
    for (const row of loginRows) {
      trackMax(row.store_id, row._max.attempted_at);
    }

    // Active users: distinct members with >= 1 session whose last_activity
    // falls inside the window. Sessions carry no store_id, so membership is
    // resolved through store_users.
    const userIds = [...new Set(memberships.map((m) => m.user_id))];
    const sessions =
      userIds.length > 0
        ? await this.prisma.user_sessions.findMany({
            where: { user_id: { in: userIds }, last_activity: range },
            select: { user_id: true, last_activity: true },
          })
        : [];
    const storesByUser = new Map<number, number[]>();
    for (const m of memberships) {
      const list = storesByUser.get(m.user_id) ?? [];
      list.push(m.store_id);
      storesByUser.set(m.user_id, list);
    }
    const activeUsersByStore = new Map<number, Set<number>>();
    for (const session of sessions) {
      const memberStores = storesByUser.get(session.user_id) ?? [];
      for (const storeId of memberStores) {
        let set = activeUsersByStore.get(storeId);
        if (!set) {
          set = new Set<number>();
          activeUsersByStore.set(storeId, set);
        }
        set.add(session.user_id);
      }
      if (session.last_activity) {
        for (const storeId of memberStores) {
          trackMax(storeId, session.last_activity);
        }
      }
    }

    return stores.map((store) => {
      const ordersCount = orderCountByStore.get(store.id) ?? 0;
      const auditEvents = auditCountByStore.get(store.id) ?? 0;
      const activeUsers = activeUsersByStore.get(store.id)?.size ?? 0;
      const lastActivity = lastActivityByStore.get(store.id);
      return {
        store_id: store.id,
        name: store.name,
        slug: store.slug,
        organization_name: store.organizations?.name ?? null,
        is_active: store.is_active ?? true,
        score: round2(ordersCount * 1 + auditEvents * 0.2 + activeUsers * 2),
        orders_count: ordersCount,
        audit_events: auditEvents,
        active_users: activeUsers,
        revenue_operating: revenueByStore.get(store.id) ?? 0,
        last_activity_at: lastActivity
          ? new Date(lastActivity).toISOString()
          : null,
      };
    });
  }

  private isActiveRow(row: StoreActivityRow): boolean {
    return (
      row.is_active &&
      (row.orders_count >= 1 ||
        row.audit_events >= STORE_ACTIVITY_ACTIVE_AUDIT_THRESHOLD)
    );
  }

  private sortRows(
    rows: StoreActivityRow[],
    sort: string,
    order: 'asc' | 'desc',
  ): StoreActivityRow[] {
    const direction = order === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let diff: number;
      switch (sort) {
        case 'orders_count':
          diff = a.orders_count - b.orders_count;
          break;
        case 'audit_events':
          diff = a.audit_events - b.audit_events;
          break;
        case 'active_users':
          diff = a.active_users - b.active_users;
          break;
        case 'revenue_operating':
          diff = a.revenue_operating - b.revenue_operating;
          break;
        case 'last_activity_at':
          diff =
            (a.last_activity_at ? Date.parse(a.last_activity_at) : 0) -
            (b.last_activity_at ? Date.parse(b.last_activity_at) : 0);
          break;
        case 'score':
        default:
          diff = a.score - b.score;
          break;
      }
      if (diff === 0) diff = a.store_id - b.store_id;
      return diff * direction;
    });
  }

  private async computeAvgHoursPerDay(
    storeIds: number[],
    window: StoreActivityWindow,
  ): Promise<number> {
    if (storeIds.length === 0) return 0;
    const range = { gte: window.start, lt: window.end };
    const [auditTs, orderTs] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where: { store_id: { in: storeIds }, created_at: range },
        select: { created_at: true },
      }),
      this.prisma.orders.findMany({
        where: { store_id: { in: storeIds }, created_at: range },
        select: { created_at: true },
      }),
    ]);
    const pairs = new Set<string>();
    const track = (value: Date | null) => {
      if (!value) return;
      pairs.add(
        `${value.getUTCFullYear()}-${value.getUTCMonth()}-${value.getUTCDate()}-${value.getUTCHours()}`,
      );
    };
    for (const row of auditTs) track(row.created_at);
    for (const row of orderTs) track(row.created_at);
    return round2(pairs.size / window.days);
  }

  private async buildTimeline(
    storeId: number,
    window: StoreActivityWindow,
    query: StoreActivityDetailQueryDto,
  ): Promise<{ items: StoreActivityTimelineItem[]; successfulLogins: number }> {
    const range = { gte: window.start, lt: window.end };
    const wantOrders = !query.event_type || query.event_type === 'order';
    const wantAudits = !query.event_type || query.event_type === 'audit';
    const wantLogins = !query.event_type || query.event_type === 'login';

    const [orders, audits, logins] = await Promise.all([
      wantOrders
        ? this.prisma.orders.findMany({
            where: {
              store_id: storeId,
              created_at: range,
              ...(query.channel ? { channel: query.channel } : {}),
              ...(query.order_state ? { state: query.order_state } : {}),
            },
            select: {
              id: true,
              order_number: true,
              state: true,
              channel: true,
              grand_total: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
          })
        : [],
      wantAudits
        ? this.prisma.audit_logs.findMany({
            where: { store_id: storeId, created_at: range },
            select: {
              id: true,
              action: true,
              resource: true,
              resource_id: true,
              created_at: true,
              users: { select: { email: true } },
            },
            orderBy: { created_at: 'desc' },
          })
        : [],
      wantLogins
        ? this.prisma.login_attempts.findMany({
            where: { store_id: storeId, success: true, attempted_at: range },
            select: { id: true, email: true, attempted_at: true },
            orderBy: { attempted_at: 'desc' },
          })
        : [],
    ]);

    const items: StoreActivityTimelineItem[] = [
      ...orders
        .filter((order) => order.created_at)
        .map((order) => ({
          kind: 'order' as const,
          id: `order-${order.id}`,
          occurred_at: (order.created_at as Date).toISOString(),
          title: `Orden ${order.order_number}`,
          detail: `Total ${Number(order.grand_total ?? 0)}`,
          channel: String(order.channel),
          state: String(order.state),
        })),
      ...audits
        .filter((audit) => audit.created_at)
        .map((audit) => ({
          kind: 'audit' as const,
          id: `audit-${audit.id}`,
          occurred_at: (audit.created_at as Date).toISOString(),
          title: `${audit.action} · ${audit.resource}`,
          ...(audit.resource_id !== null &&
          audit.resource_id !== undefined
            ? { detail: `#${audit.resource_id}` }
            : {}),
          ...(audit.users?.email ? { actor: audit.users.email } : {}),
        })),
      ...logins
        .filter((login) => login.attempted_at)
        .map((login) => ({
          kind: 'login' as const,
          id: `login-${login.id}`,
          occurred_at: (login.attempted_at as Date).toISOString(),
          title: 'Inicio de sesión exitoso',
          detail: login.email,
          actor: login.email,
        })),
    ];
    items.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
    return { items, successfulLogins: logins.length };
  }
}
