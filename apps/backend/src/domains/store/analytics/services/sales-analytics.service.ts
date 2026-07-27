import { Inject, Injectable, ForbiddenException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma, order_channel_enum, order_state_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  SalesAnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import {
  formatPeriodFromDate,
  parseDateRange,
  getPreviousPeriod,
} from '../utils/date.util';
import {
  DEFAULT_STORE_TIMEZONE,
  resolveStoreTimezone,
  localPeriodSql,
} from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

// Aggregated sales summary tolerates 1-2 min of staleness → short TTL (ms).
const SALES_SUMMARY_CACHE_TTL_MS = 120_000;

// getOrdersForExport pages the full range instead of a silent `take` cap. Rows
// are pulled in stable id-descending batches until exhausted; a safety ceiling
// guards against unbounded memory and surfaces truncation explicitly (never a
// mute cut) via `OrdersExportResult.truncated`.
const ORDER_EXPORT_BATCH_SIZE = 1000;
const ORDER_EXPORT_HARD_LIMIT = 100_000;

/**
 * One row per ORDER, with the order-level monetary totals stated EXACTLY ONCE.
 * Values are raw: money as `number`, dates as raw `Date` instants (the
 * ReportBuilder formats them in the store timezone in the emission phase).
 */
export interface OrderExportRow {
  order_number: string;
  /** Raw creation instant. NOT formatted — emission phase renders it in TZ. */
  created_at: Date | null;
  /** Raw payment instant of the first succeeded payment, if any. */
  paid_at: Date | null;
  customer_name: string;
  customer_document: string;
  customer_document_type: string;
  customer_email: string;
  channel: order_channel_enum;
  payment_method: string;
  currency: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  shipping: number;
  tip: number;
  grand_total: number;
  state: order_state_enum;
}

/**
 * One row per ORDER LINE. Carries NO order-level totals (that lives in
 * {@link OrderExportRow}); `order_number` is the join key back to the order.
 */
export interface OrderItemExportRow {
  order_number: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/**
 * Split export payload. `orders` holds order-level totals once each (summing
 * `grand_total` over `orders` is the true revenue — no ×items over-count);
 * `items` holds the line-level detail. `truncated` is true only if the hard
 * safety ceiling was reached (explicit signal, never a silent cut).
 */
export interface OrdersExportResult {
  orders: OrderExportRow[];
  items: OrderItemExportRow[];
  truncated: boolean;
}

/** Options for {@link SalesAnalyticsService.getOrdersForExport}. */
export interface GetOrdersForExportOptions {
  /**
   * Order states to include. Defaults to COMPLETED_STATES
   * (`['delivered', 'finished']`). Pass e.g. `['created', 'cancelled',
   * 'refunded']` to include pending / cancelled / refunded orders.
   */
  states?: order_state_enum[];
}

@Injectable()
export class SalesAnalyticsService {
  constructor(
    private readonly prisma: StorePrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // States that count as completed sales
  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  /**
   * Resolves the current request's store timezone (single source of truth).
   * Falls back to the default when there is no store context (e.g. the scoped
   * client would already reject such a call before reaching real data).
   */
  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      return DEFAULT_STORE_TIMEZONE;
    }
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  async getSalesSummary(query: SalesAnalyticsQueryDto) {
    const storeId = RequestContextService.getContext()?.store_id;

    // Only cache when a tenant is in scope; a store-less key could leak data
    // across tenants. store_id isolates the tenant; the date-range inputs plus
    // the channel filter capture the period/filter.
    if (!storeId) {
      return this.computeSalesSummary(query);
    }
    const cacheKey = `analytics:sales:summary:${storeId}:${query.date_preset ?? '_'}:${query.date_from ?? '_'}:${query.date_to ?? '_'}:${query.channel ?? '_'}`;
    const cached =
      await this.cache.get<
        Awaited<ReturnType<SalesAnalyticsService['computeSalesSummary']>>
      >(cacheKey);
    if (cached) return cached;

    const result = await this.computeSalesSummary(query);
    await this.cache.set(cacheKey, result, SALES_SUMMARY_CACHE_TTL_MS);
    return result;
  }

  private async computeSalesSummary(query: SalesAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

    const [currentPeriod, previousPeriod, unitsSold, customers] =
      await Promise.all([
        this.prisma.orders.aggregate({
          where: {
            state: { in: this.COMPLETED_STATES },
            ...(query.channel && { channel: query.channel }),
            created_at: {
              gte: startDate,
              lte: endDate,
            },
          },
          _sum: {
            grand_total: true,
          },
          _count: {
            id: true,
          },
        }),
        this.prisma.orders.aggregate({
          where: {
            state: { in: this.COMPLETED_STATES },
            ...(query.channel && { channel: query.channel }),
            created_at: {
              gte: previousStartDate,
              lte: previousEndDate,
            },
          },
          _sum: {
            grand_total: true,
          },
          _count: {
            id: true,
          },
        }),
        this.prisma.order_items.aggregate({
          where: {
            orders: {
              state: { in: this.COMPLETED_STATES },
              ...(query.channel && { channel: query.channel }),
              created_at: {
                gte: startDate,
                lte: endDate,
              },
            },
          },
          _sum: {
            quantity: true,
          },
        }),
        this.prisma.orders.groupBy({
          by: ['customer_id'],
          where: {
            state: { in: this.COMPLETED_STATES },
            ...(query.channel && { channel: query.channel }),
            created_at: {
              gte: startDate,
              lte: endDate,
            },
            customer_id: {
              not: null,
            },
          },
        }),
      ]);

    const totalRevenue = Number(currentPeriod._sum.grand_total || 0);
    const totalOrders = currentPeriod._count.id || 0;
    const previousRevenue = Number(previousPeriod._sum.grand_total || 0);
    const previousOrders = previousPeriod._count.id || 0;

    const revenueGrowth =
      previousRevenue > 0
        ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
        : 0;
    const ordersGrowth =
      previousOrders > 0
        ? ((totalOrders - previousOrders) / previousOrders) * 100
        : 0;

    return {
      total_revenue: totalRevenue,
      total_orders: totalOrders,
      average_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      total_units_sold: Number(unitsSold._sum.quantity || 0),
      total_customers: customers.length,
      revenue_growth: revenueGrowth,
      orders_growth: ordersGrowth,
    };
  }

  async getSalesByProduct(query: SalesAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const groupWhere: any = {
      orders: {
        state: { in: this.COMPLETED_STATES },
        ...(query.channel && { channel: query.channel }),
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      ...(query.category_id && {
        products: {
          product_categories: {
            some: {
              category_id: query.category_id,
            },
          },
        },
      }),
    };

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;

      // Count distinct product groups
      const countGroups = await this.prisma.order_items.groupBy({
        by: ['product_id'],
        where: groupWhere,
      });
      const totalCount = countGroups.length;

      const results = await this.prisma.order_items.groupBy({
        by: ['product_id'],
        where: groupWhere,
        _sum: {
          quantity: true,
          total_price: true,
        },
        orderBy: {
          _sum: {
            total_price: 'desc',
          },
        },
        skip: (page - 1) * limit,
        take: limit,
      });

      const productIds = results
        .map((r) => r.product_id)
        .filter(Boolean) as number[];
      const products = (await this.prisma.products.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          name: true,
          sku: true,
          product_images: { select: { image_url: true }, take: 1 },
          base_price: true,
          cost_price: true,
        },
      })) as {
        id: number;
        name: string;
        sku: string | null;
        product_images: { image_url: string }[];
        base_price: any;
        cost_price: any;
      }[];
      const productMap = new Map(products.map((p) => [p.id, p]));

      const data = results.map((r) => {
        const product = productMap.get(r.product_id as number);
        const revenue = Number(r._sum.total_price || 0);
        const units = Number(r._sum.quantity || 0);
        const costPrice = product ? Number(product.cost_price || 0) : 0;
        const avgPrice = units > 0 ? revenue / units : 0;
        const profitMargin =
          costPrice > 0 && avgPrice > 0
            ? ((avgPrice - costPrice) / avgPrice) * 100
            : null;

        return {
          product_id: r.product_id,
          product_name: product?.name || 'Unknown',
          sku: product?.sku || '',
          image_url: product?.product_images?.[0]?.image_url || null,
          units_sold: units,
          revenue: revenue,
          average_price: avgPrice,
          profit_margin: profitMargin,
        };
      });

      return {
        data,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    // Non-paginated (retrocompatible)
    const results = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: groupWhere,
      _sum: {
        quantity: true,
        total_price: true,
      },
      orderBy: {
        _sum: {
          total_price: 'desc',
        },
      },
      take: query.limit || 50,
    });

    // Get product details
    const productIds = results
      .map((r) => r.product_id)
      .filter(Boolean) as number[];
    const products = (await this.prisma.products.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
        base_price: true,
        cost_price: true,
      },
    })) as {
      id: number;
      name: string;
      sku: string | null;
      product_images: { image_url: string }[];
      base_price: any;
      cost_price: any;
    }[];

    const productMap = new Map(products.map((p) => [p.id, p]));

    return results.map((r) => {
      const product = productMap.get(r.product_id as number);
      const revenue = Number(r._sum.total_price || 0);
      const units = Number(r._sum.quantity || 0);
      const costPrice = product ? Number(product.cost_price || 0) : 0;
      const avgPrice = units > 0 ? revenue / units : 0;
      const profitMargin =
        costPrice > 0 && avgPrice > 0
          ? ((avgPrice - costPrice) / avgPrice) * 100
          : null;

      return {
        product_id: r.product_id,
        product_name: product?.name || 'Unknown',
        sku: product?.sku || '',
        image_url: product?.product_images?.[0]?.image_url || null,
        units_sold: units,
        revenue: revenue,
        average_price: avgPrice,
        profit_margin: profitMargin,
      };
    });
  }

  async getSalesByCategory(query: SalesAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    // Step 1: Aggregate order_items by product_id at DB level
    const productAggregates = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      _sum: {
        quantity: true,
        total_price: true,
      },
    });

    const productIds = productAggregates
      .map((r) => r.product_id)
      .filter(Boolean) as number[];

    // Step 2: Get product->category mappings with a lightweight select
    const productCategories = await this.prisma.product_categories.findMany({
      where: {
        product_id: { in: productIds },
      },
      select: {
        product_id: true,
        category_id: true,
        categories: {
          select: { id: true, name: true },
        },
      },
    });

    // Build product -> categories map
    const productCategoryMap = new Map<
      number,
      { id: number; name: string }[]
    >();
    for (const pc of productCategories) {
      const cats = productCategoryMap.get(pc.product_id) || [];
      if (pc.categories) {
        cats.push({ id: pc.categories.id, name: pc.categories.name });
      }
      productCategoryMap.set(pc.product_id, cats);
    }

    // Step 3: Aggregate by category in memory (iterating over product aggregates, not all order_items)
    const categoryMap = new Map<
      number,
      { name: string; units: number; revenue: number }
    >();
    let totalRevenue = 0;

    for (const agg of productAggregates) {
      const revenue = Number(agg._sum.total_price || 0);
      const units = Number(agg._sum.quantity || 0);
      totalRevenue += revenue;

      const categories = productCategoryMap.get(agg.product_id as number) || [];
      if (categories.length > 0) {
        for (const cat of categories) {
          const existing = categoryMap.get(cat.id) || {
            name: cat.name,
            units: 0,
            revenue: 0,
          };
          existing.units += units;
          existing.revenue += revenue;
          categoryMap.set(cat.id, existing);
        }
      } else {
        const existing = categoryMap.get(0) || {
          name: 'Sin categoría',
          units: 0,
          revenue: 0,
        };
        existing.units += units;
        existing.revenue += revenue;
        categoryMap.set(0, existing);
      }
    }

    const allResults = Array.from(categoryMap.entries())
      .map(([id, data]) => ({
        category_id: id,
        category_name: data.name,
        units_sold: data.units,
        revenue: data.revenue,
        percentage_of_total:
          totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = allResults.length;
      const data = allResults.slice((page - 1) * limit, page * limit);

      return {
        data,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    return allResults.slice(0, query.limit || allResults.length);
  }

  async getSalesByPaymentMethod(query: SalesAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const payments = await this.prisma.payments.findMany({
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
        state: 'succeeded',
      },
      include: {
        store_payment_method: {
          include: {
            system_payment_method: true,
          },
        },
      },
    });

    const methodMap = new Map<
      string,
      { displayName: string; count: number; amount: number }
    >();
    let totalAmount = 0;

    for (const payment of payments) {
      const amount = Number(payment.amount || 0);
      totalAmount += amount;

      const methodName =
        payment.store_payment_method?.system_payment_method?.name || 'unknown';
      const displayName =
        payment.store_payment_method?.display_name ||
        payment.store_payment_method?.system_payment_method?.display_name ||
        'Desconocido';

      const existing = methodMap.get(methodName) || {
        displayName,
        count: 0,
        amount: 0,
      };
      existing.count += 1;
      existing.amount += amount;
      methodMap.set(methodName, existing);
    }

    const allResults = Array.from(methodMap.entries())
      .map(([method, data]) => ({
        payment_method: method,
        display_name: data.displayName,
        transaction_count: data.count,
        total_amount: data.amount,
        percentage: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = allResults.length;
      const data = allResults.slice((page - 1) * limit, page * limit);

      return {
        data,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    return allResults.slice(0, query.limit || allResults.length);
  }

  async getSalesTrends(query: SalesAnalyticsQueryDto) {
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Hourly view (e.g. dashboard "today"): group by the store's LOCAL hour,
    // limited to the current local day up to "now". Timezone-aware so a sale at
    // 2pm store time lands on the 14:00 bucket (the other granularities stay UTC).
    if (granularity === Granularity.HOUR) {
      return this.getHourlyTrendsForToday(storeId, query.channel);
    }

    // Resolve the store timezone ONCE and drive both the date range and the
    // bucketing with it (single source of truth).
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // Bucket by the store's LOCAL calendar. `localPeriodSql` emits the period as
    // an authoritative TEXT label (to_char(DATE_TRUNC(..., created_at AT TIME
    // ZONE 'UTC' AT TIME ZONE tz), fmt)); this avoids the pg driver re-parsing a
    // wall-clock timestamp tz-ambiguously, and the fill below reproduces the
    // exact same labels by walking the local calendar.
    const periodSql = localPeriodSql('o.created_at', tz, granularity);

    // withoutScope() needed: $queryRaw is not available on the scoped client.
    // storeId is validated above and used in the WHERE clause.
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        revenue: any;
        order_count: bigint;
        units_sold: any;
      }>
    >`
      SELECT
        ${periodSql} AS period,
        COALESCE(SUM(o.grand_total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(oi.units), 0) AS units_sold
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(quantity) AS units
        FROM order_items
        GROUP BY order_id
      ) oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN ('delivered', 'finished')
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
        ${query.channel ? Prisma.sql`AND o.channel = ${query.channel}::order_channel_enum` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const mapped = results.map((r) => {
      const revenue = Number(r.revenue);
      const orders = Number(r.order_count);
      return {
        // period is already the authoritative local label from SQL — do NOT
        // re-derive it in JS (that reintroduced the tz-ambiguity bug).
        period: r.period,
        revenue,
        orders,
        units_sold: Number(r.units_sold),
        average_order_value: orders > 0 ? revenue / orders : 0,
      };
    });

    return fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { revenue: 0, orders: 0, units_sold: 0, average_order_value: 0 },
      formatPeriodFromDate,
      tz,
    );
  }

  /**
   * Hourly sales trend for the current day in the store's LOCAL timezone.
   * Buckets run from 00:00 to the current local hour (inclusive); missing
   * hours are zero-filled. Uses the shared `resolveStoreTimezone` (single
   * source of truth) instead of a private copy.
   */
  private async getHourlyTrendsForToday(storeId: number, channel?: string) {
    const timezone = await resolveStoreTimezone(this.prisma, storeId);
    const tzSql = Prisma.raw(`'${timezone}'`);

    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        hour_local: number;
        revenue: any;
        order_count: bigint;
        units_sold: any;
      }>
    >`
      SELECT
        EXTRACT(HOUR FROM (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql}))::int AS hour_local,
        COALESCE(SUM(o.grand_total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(oi.units), 0) AS units_sold
      FROM orders o
      LEFT JOIN (
        SELECT order_id, SUM(quantity) AS units
        FROM order_items
        GROUP BY order_id
      ) oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN ('delivered', 'finished')
        AND (o.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${tzSql})::date
            = (NOW() AT TIME ZONE ${tzSql})::date
        ${channel ? Prisma.sql`AND o.channel = ${channel}::order_channel_enum` : Prisma.empty}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    // Current local date + hour: label the buckets and know where to stop.
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
    let currentHour = parseInt(get('hour'), 10);
    if (Number.isNaN(currentHour) || currentHour === 24) currentHour = 0;

    const byHour = new Map<number, any>();
    for (const r of results) byHour.set(Number(r.hour_local), r);

    const filled: Array<{
      period: string;
      revenue: number;
      orders: number;
      units_sold: number;
      average_order_value: number;
    }> = [];
    for (let h = 0; h <= currentHour; h++) {
      const r = byHour.get(h);
      const revenue = r ? Number(r.revenue) : 0;
      const orders = r ? Number(r.order_count) : 0;
      filled.push({
        period: `${dateStr}T${String(h).padStart(2, '0')}:00`,
        revenue,
        orders,
        units_sold: r ? Number(r.units_sold) : 0,
        average_order_value: orders > 0 ? revenue / orders : 0,
      });
    }
    return filled;
  }

  async getSalesByCustomer(query: SalesAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const where = {
      state: { in: this.COMPLETED_STATES },
      customer_id: { not: null },
      created_at: { gte: startDate, lte: endDate },
    };

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;

      const countGroups = await this.prisma.orders.groupBy({
        by: ['customer_id'],
        where,
      });
      const totalCount = countGroups.length;

      const results = await this.prisma.orders.groupBy({
        by: ['customer_id'],
        where,
        _sum: { grand_total: true },
        _count: { id: true },
        _max: { created_at: true },
        orderBy: { _sum: { grand_total: 'desc' } },
        skip: (page - 1) * limit,
        take: limit,
      });

      const customerIds = results
        .map((r) => r.customer_id)
        .filter(Boolean) as number[];
      const customers = await this.prisma.users.findMany({
        where: { id: { in: customerIds } },
        select: {
          id: true,
          username: true,
          first_name: true,
          last_name: true,
          email: true,
        },
      });
      const customerMap = new Map(customers.map((c) => [c.id, c]));

      const data = results.map((r) => {
        const customer = customerMap.get(r.customer_id as number);
        const totalSpent = Number(r._sum.grand_total || 0);
        const totalOrders = r._count.id || 0;
        const customerName = customer
          ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
            customer.username ||
            'Cliente'
          : 'Cliente';

        return {
          customer_id: r.customer_id,
          customer_name: customerName,
          email: customer?.email || '',
          total_orders: totalOrders,
          total_spent: totalSpent,
          average_order_value: totalOrders > 0 ? totalSpent / totalOrders : 0,
          last_order_date: r._max.created_at?.toISOString() || null,
        };
      });

      return {
        data,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    // Non-paginated (retrocompatible)
    const results = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where,
      _sum: { grand_total: true },
      _count: { id: true },
      _max: { created_at: true },
      orderBy: { _sum: { grand_total: 'desc' } },
      take: query.limit || 50,
    });

    const customerIds = results
      .map((r) => r.customer_id)
      .filter(Boolean) as number[];
    const customers = await this.prisma.users.findMany({
      where: { id: { in: customerIds } },
      select: {
        id: true,
        username: true,
        first_name: true,
        last_name: true,
        email: true,
      },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    return results.map((r) => {
      const customer = customerMap.get(r.customer_id as number);
      const totalSpent = Number(r._sum.grand_total || 0);
      const totalOrders = r._count.id || 0;
      const customerName = customer
        ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
          customer.username ||
          'Cliente'
        : 'Cliente';

      return {
        customer_id: r.customer_id,
        customer_name: customerName,
        email: customer?.email || '',
        total_orders: totalOrders,
        total_spent: totalSpent,
        average_order_value: totalOrders > 0 ? totalSpent / totalOrders : 0,
        last_order_date: r._max.created_at?.toISOString() || null,
      };
    });
  }

  async getSalesByChannel(query: SalesAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const results = await this.prisma.orders.groupBy({
      by: ['channel'],
      where: {
        state: { in: this.COMPLETED_STATES },
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: {
        grand_total: true,
      },
      _count: {
        id: true,
      },
    });

    const labels: Record<string, string> = {
      pos: 'Punto de Venta',
      ecommerce: 'Tienda Online',
      agent: 'Agente IA',
      whatsapp: 'WhatsApp',
      marketplace: 'Marketplace',
    };

    const total = results.reduce(
      (sum, r) => sum + Number(r._sum.grand_total || 0),
      0,
    );

    const allResults = results
      .map((r) => ({
        channel: r.channel,
        display_name: labels[r.channel] || r.channel,
        order_count: r._count.id,
        revenue: Number(r._sum.grand_total || 0),
        percentage:
          total > 0 ? (Number(r._sum.grand_total || 0) / total) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = allResults.length;
      const data = allResults.slice((page - 1) * limit, page * limit);

      return {
        data,
        meta: {
          pagination: {
            total: totalCount,
            page,
            limit,
            total_pages: Math.ceil(totalCount / limit),
          },
        },
      };
    }

    return allResults.slice(0, query.limit || allResults.length);
  }

  /**
   * Raw dataset for the sales export, split into two coherent shapes so the
   * emission phase never double-counts:
   *
   * - `orders`: one row per order with the order-level totals (subtotal,
   *   discount, tax, shipping, grand_total) stated EXACTLY ONCE. Summing
   *   `grand_total` here yields the true period revenue.
   * - `items`: one row per order line (no order-level totals).
   *
   * All values are RAW: money as `number`, dates as raw `Date` instants (the
   * ReportBuilder formats them in the store timezone downstream). No values are
   * pre-formatted here.
   *
   * Filters honored (all optional, all through the store-scoped client — no
   * manual `store_id`): `channel`, `category_id` (orders containing an item in
   * that category), `brand_id` (orders containing an item of that brand),
   * `payment_method` (orders with a succeeded payment whose canonical system
   * payment-method `name` matches). When `category_id`/`brand_id` is set, the
   * `items` dataset is narrowed to the matching lines; order-level totals in
   * `orders` always reflect the whole order (they cannot be decomposed by
   * category/brand).
   *
   * State defaults to COMPLETED_STATES (`['delivered', 'finished']`); pass
   * `options.states` to include pending / cancelled / refunded orders.
   *
   * The whole range is paged (no silent `take` cap). If the hard safety ceiling
   * ({@link ORDER_EXPORT_HARD_LIMIT}) is reached, `truncated` is set true — an
   * explicit signal, never a mute cut.
   */
  async getOrdersForExport(
    query: SalesAnalyticsQueryDto,
    options?: GetOrdersForExportOptions,
  ): Promise<OrdersExportResult> {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const states: order_state_enum[] =
      options?.states ?? (this.COMPLETED_STATES as order_state_enum[]);

    // Product-level filter reused for both the order membership predicate and
    // the item-include narrowing.
    const hasProductFilter =
      query.category_id != null || query.brand_id != null;
    const productMatch: Prisma.productsWhereInput = {
      ...(query.category_id != null && {
        product_categories: { some: { category_id: query.category_id } },
      }),
      ...(query.brand_id != null && { brand_id: query.brand_id }),
    };

    const where: Prisma.ordersWhereInput = {
      state: { in: states },
      ...(query.channel && { channel: query.channel }),
      created_at: { gte: startDate, lte: endDate },
      ...(hasProductFilter && {
        order_items: { some: { products: { is: productMatch } } },
      }),
      ...(query.payment_method && {
        payments: {
          some: {
            state: 'succeeded',
            store_payment_method: {
              system_payment_method: { name: query.payment_method },
            },
          },
        },
      }),
    };

    const orders: OrderExportRow[] = [];
    const items: OrderItemExportRow[] = [];
    let truncated = false;
    let cursorId: number | undefined;

    // Cursor pagination on the unique `id` (stable, unique) pulls the FULL range
    // without an offset penalty and without dropping rows silently.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await this.prisma.orders.findMany({
        where,
        include: {
          order_items: {
            ...(hasProductFilter && {
              where: { products: { is: productMatch } },
            }),
            include: {
              products: { select: { name: true, sku: true } },
            },
          },
          users: {
            select: {
              first_name: true,
              last_name: true,
              email: true,
              document_number: true,
              document_type: true,
            },
          },
          payments: {
            where: { state: 'succeeded' },
            include: {
              store_payment_method: {
                select: {
                  display_name: true,
                  system_payment_method: { select: { display_name: true } },
                },
              },
            },
            orderBy: { paid_at: 'desc' },
            take: 1,
          },
        },
        orderBy: { id: 'desc' },
        take: ORDER_EXPORT_BATCH_SIZE,
        ...(cursorId !== undefined && {
          cursor: { id: cursorId },
          skip: 1,
        }),
      });

      for (const order of batch) {
        const customer = order.users;
        const customerName = customer
          ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() ||
            'Cliente'
          : 'Anónimo';
        const payment = order.payments?.[0];
        const paymentMethod =
          payment?.store_payment_method?.display_name ||
          payment?.store_payment_method?.system_payment_method?.display_name ||
          'N/A';

        orders.push({
          order_number: order.order_number,
          // RAW instant — do NOT format here (emission phase renders in TZ).
          created_at: order.created_at ?? null,
          paid_at: payment?.paid_at ?? null,
          customer_name: customerName,
          customer_document: customer?.document_number || '',
          customer_document_type: customer?.document_type || '',
          customer_email: customer?.email || '',
          channel: order.channel,
          payment_method: paymentMethod,
          currency: order.currency ?? null,
          subtotal: Number(order.subtotal_amount),
          discount: Number(order.discount_amount),
          tax: Number(order.tax_amount),
          shipping: Number(order.shipping_cost),
          tip: Number(order.tip_amount ?? 0),
          grand_total: Number(order.grand_total),
          state: order.state,
        });

        for (const item of order.order_items) {
          items.push({
            order_number: order.order_number,
            product_name: item.product_name,
            sku: item.products?.sku || item.variant_sku || '',
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            line_total: Number(item.total_price),
          });
        }
      }

      if (batch.length < ORDER_EXPORT_BATCH_SIZE) break;
      cursorId = batch[batch.length - 1].id;

      if (orders.length >= ORDER_EXPORT_HARD_LIMIT) {
        truncated = true;
        break;
      }
    }

    return { orders, items, truncated };
  }
}
