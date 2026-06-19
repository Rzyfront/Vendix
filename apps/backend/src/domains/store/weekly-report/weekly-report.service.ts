import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  WeeklyMetricSet,
  WeeklyReportSnapshot,
  WeeklyRollingAvg,
  WeeklySlide,
  WeeklyTip,
  WeeklyTier,
} from './types';
import {
  getClosedWeekWindow,
  getRolling4WeekWindow,
  toIsoDate,
} from './utils/week-window';
import { classifyTier } from './utils/tier-engine';
import { selectTips } from './utils/tips-rules';
import { buildSlides } from './utils/slides-builder';

const COMPLETED_ORDER_STATES = ['delivered', 'finished'];
const RECEIVED_PO_STATUS = 'received';
const COLOMBIA_OFFSET_MIN = -5 * 60;

@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly notifications_service: NotificationsService,
  ) {}

  /**
   * Genera (o re-genera idempotente) el reporte para una tienda y la
   * semana cerrada al momento de invocación. Se invoca desde el cron
   * y también puede invocarse manualmente para regenerar.
   */
  async generateForStore(
    store_id: number,
    options: { now?: Date; sendNotification?: boolean } = {},
  ): Promise<WeeklyReportSnapshot | null> {
    const { now = new Date(), sendNotification = true } = options;

    const store = await this.prisma.stores.findFirst({
      where: { id: store_id, is_active: true },
      select: { id: true, name: true },
    });
    if (!store) {
      this.logger.warn(
        `Store ${store_id} is not active or not found, skipping weekly report`,
      );
      return null;
    }

    const window = getClosedWeekWindow(now);
    const rolling = getRolling4WeekWindow(window.weekStart);

    const metrics = await this.computeMetrics(store_id, window, rolling);
    const rollingAvg = await this.computeRollingAvg(store_id, rolling);
    const tier: WeeklyTier = classifyTier({
      currentRevenue: metrics.total_revenue,
      currentOrders: metrics.total_orders,
      rolling4wRevenue: rollingAvg.revenue,
      rolling4wOrders: rollingAvg.orders,
    });
    const tips: WeeklyTip[] = selectTips(metrics, tier);
    const slides: WeeklySlide[] = buildSlides({
      tier,
      metrics,
      tips,
      weekStartIso: window.weekStartIso,
      weekEndIso: window.weekEndIso,
      storeName: store.name,
    });

    // Upsert idempotente: un solo snapshot por (store_id, week_start_date).
    const persisted = await this.prisma.store_weekly_reports.upsert({
      where: {
        store_id_week_start_date: {
          store_id,
          week_start_date: new Date(window.weekStartIso),
        },
      },
      create: {
        store_id,
        week_start_date: new Date(window.weekStartIso),
        week_end_date: new Date(window.weekEndIso),
        tier,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        slides: slides as unknown as Prisma.InputJsonValue,
        tips: tips as unknown as Prisma.InputJsonValue,
        rolling_avg: rollingAvg as unknown as Prisma.InputJsonValue,
      },
      update: {
        week_end_date: new Date(window.weekEndIso),
        tier,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        slides: slides as unknown as Prisma.InputJsonValue,
        tips: tips as unknown as Prisma.InputJsonValue,
        rolling_avg: rollingAvg as unknown as Prisma.InputJsonValue,
        generated_at: new Date(),
      },
    });

    if (sendNotification) {
      await this.notifications_service.createAndBroadcast(
        store_id,
        'weekly_report',
        `Tu semana en Vendix · ${window.weekStartIso}`,
        'Te tenemos un resumen con tus números y consejos para la próxima semana.',
        { weekly_report_id: persisted.id, tier },
      );
    }

    return this.toSnapshot(persisted);
  }

  /**
   * Genera reportes para todas las tiendas activas. Diseñado para el cron.
   * Devuelve contadores para logging.
   */
  async generateForAllActiveStores(
    now: Date = new Date(),
  ): Promise<{ generated: number; skipped: number }> {
    const stores = await this.prisma.stores.findMany({
      where: { is_active: true },
      select: { id: true },
    });

    let generated = 0;
    let skipped = 0;
    for (const store of stores) {
      try {
        const result = await this.generateForStore(store.id, { now });
        if (result) generated++;
        else skipped++;
      } catch (err) {
        this.logger.error(
          `Failed to generate weekly report for store ${store.id}: ${err?.message}`,
          err?.stack,
        );
        skipped++;
      }
    }

    this.logger.log(
      `Weekly reports batch: ${generated} generated, ${skipped} skipped (of ${stores.length} active stores)`,
    );
    return { generated, skipped };
  }

  /**
   * Devuelve el último reporte del store autenticado (request context).
   * Si el reporte más reciente es de la semana pasada y ya estamos en
   * una nueva semana cerrada, intenta regenerar primero.
   */
  async getLatestForCurrentStore(): Promise<WeeklyReportSnapshot | null> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new NotFoundException('Store context required');
    }

    const window = getClosedWeekWindow();
    const currentWeekStart = new Date(window.weekStartIso);

    // Si no hay reporte para la semana cerrada actual, regenerar
    // (cubre el caso en que el cron aún no haya corrido pero el dueño
    // ya abrió el dashboard).
    const current = await this.prisma.store_weekly_reports.findUnique({
      where: {
        store_id_week_start_date: {
          store_id,
          week_start_date: currentWeekStart,
        },
      },
    });

    if (!current) {
      const regenerated = await this.generateForStore(store_id, {
        sendNotification: false,
      });
      if (regenerated) return regenerated;
    } else {
      return this.toSnapshot(current);
    }

    // Si tampoco se pudo regenerar, devolver el más reciente.
    const last = await this.prisma.store_weekly_reports.findFirst({
      where: { store_id },
      orderBy: { week_start_date: 'desc' },
    });
    return last ? this.toSnapshot(last) : null;
  }

  async markViewed(id: number): Promise<WeeklyReportSnapshot> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new NotFoundException('Store context required');
    }

    const existing = await this.prisma.store_weekly_reports.findFirst({
      where: { id, store_id },
    });
    if (!existing) {
      throw new NotFoundException(`Weekly report #${id} not found`);
    }

    const updated = await this.prisma.store_weekly_reports.update({
      where: { id },
      data: { viewed_at: new Date() },
    });
    return this.toSnapshot(updated);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async computeMetrics(
    store_id: number,
    window: ReturnType<typeof getClosedWeekWindow>,
    rolling: ReturnType<typeof getRolling4WeekWindow>,
  ): Promise<WeeklyMetricSet> {
    const start = window.weekStart;
    const end = window.weekEnd;

    // Sales current week
    const [ordersAgg, itemsAgg, bestDayAgg, channelsAgg, newCustomersCount, topProductAgg, inventoryAgg] =
      await Promise.all([
        // 1. Sales totals (orders aggregate)
        this.prisma.orders.aggregate({
          where: {
            store_id,
            state: { in: COMPLETED_ORDER_STATES as any },
            created_at: { gte: start, lte: end },
          },
          _sum: { grand_total: true },
          _count: { id: true },
        }),
        // 2. Units sold
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              store_id,
              state: { in: COMPLETED_ORDER_STATES as any },
              created_at: { gte: start, lte: end },
            },
          },
          _sum: { quantity: true },
        }),
        // 3. Best day (by revenue)
        this.prisma.orders.groupBy({
          by: ['created_at'],
          where: {
            store_id,
            state: { in: COMPLETED_ORDER_STATES as any },
            created_at: { gte: start, lte: end },
          },
          _sum: { grand_total: true },
          _count: { id: true },
        }),
        // 4. Channels
        this.prisma.orders.groupBy({
          by: ['channel'],
          where: {
            store_id,
            state: { in: COMPLETED_ORDER_STATES as any },
            created_at: { gte: start, lte: end },
          },
          _sum: { grand_total: true },
          _count: { id: true },
        }),
        // 5. New customers (users con rol customer en la tienda, creados en la semana)
        this.prisma.users.count({
          where: {
            store_users: { some: { store_id } },
            user_roles: { some: { roles: { name: 'customer' } } },
            created_at: { gte: start, lte: end },
          },
        }),
        // 6. Top product
        this.prisma.order_items.groupBy({
          by: ['product_id'],
          where: {
            orders: {
              store_id,
              state: { in: COMPLETED_ORDER_STATES as any },
              created_at: { gte: start, lte: end },
            },
            product_id: { not: null },
          },
          _sum: { quantity: true, total_price: true },
          orderBy: { _sum: { total_price: 'desc' } },
          take: 1,
        }),
        // 7. Inventory (purchase orders received)
        this.prisma.purchase_orders.aggregate({
          where: {
            suppliers: { store_id },
            status: RECEIVED_PO_STATUS,
            order_date: { gte: start, lte: end },
          },
          _count: { id: true },
          _sum: { total_amount: true },
        }),
      ]);

    // Best day: tomar el día con revenue máximo.
    let bestDay: WeeklyMetricSet['best_day'] = null;
    if (bestDayAgg && bestDayAgg.length > 0) {
      // groupBy por created_at devuelve una fila por timestamp; agrupar por día.
      const byDay = new Map<string, { revenue: number; orders: number }>();
      for (const row of bestDayAgg) {
        if (!row.created_at) continue;
        const date = new Date(row.created_at);
        const isoDay = toIsoDate(date);
        const prev = byDay.get(isoDay) || { revenue: 0, orders: 0 };
        prev.revenue += Number(row._sum.grand_total || 0);
        prev.orders += row._count.id;
        byDay.set(isoDay, prev);
      }
      let best: { date: string; revenue: number; orders: number } | null = null;
      for (const [date, v] of byDay) {
        if (!best || v.revenue > best.revenue) best = { date, ...v };
      }
      bestDay = best;
    }

    // Top product
    let topProduct: WeeklyMetricSet['top_product'] = null;
    if (topProductAgg && topProductAgg.length > 0) {
      const row = topProductAgg[0];
      const product = await this.prisma.products.findFirst({
        where: { id: row.product_id as number, store_id },
        select: { id: true, name: true },
      });
      if (product) {
        topProduct = {
          product_id: product.id,
          name: product.name,
          units: Number(row._sum.quantity || 0),
          revenue: Number(row._sum.total_price || 0),
        };
      }
    }

    // Channel breakdown
    const totalChannelRevenue = channelsAgg.reduce(
      (sum, c) => sum + Number(c._sum.grand_total || 0),
      0,
    );
    const channel_breakdown = channelsAgg
      .map((c) => ({
        channel: c.channel,
        display_name: c.channel,
        revenue: Number(c._sum.grand_total || 0),
        percentage:
          totalChannelRevenue > 0
            ? (Number(c._sum.grand_total || 0) / totalChannelRevenue) * 100
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // Items received
    const itemsReceivedAgg = await this.prisma.purchase_order_items.aggregate({
      where: {
        purchase_orders: {
          suppliers: { store_id },
          status: RECEIVED_PO_STATUS,
          order_date: { gte: start, lte: end },
        },
      },
      _sum: { quantity_received: true },
    });

    const totalRevenue = Number(ordersAgg._sum!.grand_total || 0);
    const totalOrders = ordersAgg._count!.id || 0;

    return {
      total_revenue: totalRevenue,
      total_orders: totalOrders,
      average_ticket: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      total_units_sold: Number(itemsAgg._sum!.quantity || 0),
      new_customers: newCustomersCount,
      top_product: topProduct,
      best_day: bestDay,
      channel_breakdown,
      inventory: {
        purchase_orders: inventoryAgg._count!.id || 0,
        total_spent: Number(inventoryAgg._sum!.total_amount || 0),
        items_received: Number(itemsReceivedAgg._sum!.quantity_received || 0),
      },
    };
  }

  private async computeRollingAvg(
    store_id: number,
    rolling: ReturnType<typeof getRolling4WeekWindow>,
  ): Promise<WeeklyRollingAvg> {
    // 4 semanas previas → 4 buckets por semana (sun 00:00 → sat 23:59 CO).
    // Sumar todas las órdenes completadas en el rango y dividir por 4.
    const orders = await this.prisma.orders.aggregate({
      where: {
        store_id,
        state: { in: COMPLETED_ORDER_STATES as any },
        created_at: { gte: rolling.start, lte: rolling.end },
      },
      _sum: { grand_total: true },
      _count: { id: true },
    });

    const totalRevenue = Number(orders._sum!.grand_total || 0);
    const totalOrders = orders._count!.id || 0;
    const WEEKS = 4;
    return {
      revenue: totalRevenue / WEEKS,
      orders: totalOrders / WEEKS,
      average_ticket:
        totalOrders > 0 ? totalRevenue / totalOrders : 0,
      weeks_sampled: WEEKS,
    };
  }

  private toSnapshot(
    row: NonNullable<
      Awaited<
        ReturnType<GlobalPrismaService['store_weekly_reports']['findUnique']>
      >
    >,
  ): WeeklyReportSnapshot {
    return {
      id: row.id,
      store_id: row.store_id,
      week_start_date: toIsoDate(row.week_start_date),
      week_end_date: toIsoDate(row.week_end_date),
      tier: row.tier as WeeklyTier,
      metrics: row.metrics as unknown as WeeklyMetricSet,
      slides: row.slides as unknown as WeeklySlide[],
      tips: row.tips as unknown as WeeklyTip[],
      rolling_avg:
        (row.rolling_avg as unknown as WeeklyRollingAvg | null) || null,
      generated_at: row.generated_at.toISOString(),
      viewed_at: row.viewed_at ? row.viewed_at.toISOString() : null,
    };
  }
}
