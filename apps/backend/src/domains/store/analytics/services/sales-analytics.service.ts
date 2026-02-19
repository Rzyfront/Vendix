import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { SalesAnalyticsQueryDto, DatePreset, Granularity } from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';

@Injectable()
export class SalesAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  // States that count as completed sales
  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  async getSalesSummary(query: SalesAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const { previousStartDate, previousEndDate } = this.getPreviousPeriod(startDate, endDate);

    // Current period metrics (store scoping is automatic)
    const currentPeriod = await this.prisma.orders.aggregate({
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
    });

    // Previous period for comparison
    const previousPeriod = await this.prisma.orders.aggregate({
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
    });

    // Total units sold
    const unitsSold = await this.prisma.order_items.aggregate({
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
    });

    // Unique customers
    const customers = await this.prisma.orders.groupBy({
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
    });

    const totalRevenue = Number(currentPeriod._sum.grand_total || 0);
    const totalOrders = currentPeriod._count.id || 0;
    const previousRevenue = Number(previousPeriod._sum.grand_total || 0);
    const previousOrders = previousPeriod._count.id || 0;

    const revenueGrowth = previousRevenue > 0
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
      : 0;
    const ordersGrowth = previousOrders > 0
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
    const { startDate, endDate } = this.parseDateRange(query);

    const results = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
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
      },
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
    const productIds = results.map((r) => r.product_id).filter(Boolean) as number[];
    const products = await this.prisma.products.findMany({
      where: {
        id: {
          in: productIds,
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        image_url: true,
        base_price: true,
        cost_price: true,
      },
    }) as { id: number; name: string; sku: string | null; image_url: string | null; base_price: any; cost_price: any }[];

    const productMap = new Map(products.map((p) => [p.id, p]));

    return results.map((r) => {
      const product = productMap.get(r.product_id as number);
      const revenue = Number(r._sum.total_price || 0);
      const units = Number(r._sum.quantity || 0);
      const costPrice = product ? Number(product.cost_price || 0) : 0;
      const avgPrice = units > 0 ? revenue / units : 0;
      const profitMargin = costPrice > 0 && avgPrice > 0
        ? ((avgPrice - costPrice) / avgPrice) * 100
        : null;

      return {
        product_id: r.product_id,
        product_name: product?.name || 'Unknown',
        sku: product?.sku || '',
        image_url: product?.image_url,
        units_sold: units,
        revenue: revenue,
        average_price: avgPrice,
        profit_margin: profitMargin,
      };
    });
  }

  async getSalesByCategory(query: SalesAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

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

    const productIds = productAggregates.map((r) => r.product_id).filter(Boolean) as number[];

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
    const productCategoryMap = new Map<number, { id: number; name: string }[]>();
    for (const pc of productCategories) {
      const cats = productCategoryMap.get(pc.product_id) || [];
      if (pc.categories) {
        cats.push({ id: pc.categories.id, name: pc.categories.name });
      }
      productCategoryMap.set(pc.product_id, cats);
    }

    // Step 3: Aggregate by category in memory (iterating over product aggregates, not all order_items)
    const categoryMap = new Map<number, { name: string; units: number; revenue: number }>();
    let totalRevenue = 0;

    for (const agg of productAggregates) {
      const revenue = Number(agg._sum.total_price || 0);
      const units = Number(agg._sum.quantity || 0);
      totalRevenue += revenue;

      const categories = productCategoryMap.get(agg.product_id as number) || [];
      if (categories.length > 0) {
        for (const cat of categories) {
          const existing = categoryMap.get(cat.id) || { name: cat.name, units: 0, revenue: 0 };
          existing.units += units;
          existing.revenue += revenue;
          categoryMap.set(cat.id, existing);
        }
      } else {
        const existing = categoryMap.get(0) || { name: 'Sin categoría', units: 0, revenue: 0 };
        existing.units += units;
        existing.revenue += revenue;
        categoryMap.set(0, existing);
      }
    }

    return Array.from(categoryMap.entries())
      .map(([id, data]) => ({
        category_id: id,
        category_name: data.name,
        units_sold: data.units,
        revenue: data.revenue,
        percentage_of_total: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async getSalesByPaymentMethod(query: SalesAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

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
        store_payment_methods: {
          include: {
            system_payment_methods: true,
          },
        },
      },
    });

    const methodMap = new Map<string, { displayName: string; count: number; amount: number }>();
    let totalAmount = 0;

    for (const payment of payments) {
      const amount = Number(payment.amount || 0);
      totalAmount += amount;

      const methodName = payment.store_payment_methods?.system_payment_methods?.name || 'unknown';
      const displayName = payment.store_payment_methods?.display_name ||
        payment.store_payment_methods?.system_payment_methods?.display_name || 'Desconocido';

      const existing = methodMap.get(methodName) || { displayName, count: 0, amount: 0 };
      existing.count += 1;
      existing.amount += amount;
      methodMap.set(methodName, existing);
    }

    return Array.from(methodMap.entries())
      .map(([method, data]) => ({
        payment_method: method,
        display_name: data.displayName,
        transaction_count: data.count,
        total_amount: data.amount,
        percentage: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.total_amount - a.total_amount);
  }

  async getSalesTrends(query: SalesAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new ForbiddenException('Store context required for sales trends');
    }
    const storeId = context.store_id;

    // Map granularity to PostgreSQL DATE_TRUNC interval
    // Use Prisma.raw() so the interval is inlined as a SQL literal
    // instead of parameterized (avoids GROUP BY mismatch with SELECT)
    const truncSql = Prisma.raw(`'${this.getDateTruncInterval(granularity)}'`);

    // withoutScope() needed: $queryRaw is not available on the scoped client.
    // storeId is validated above and used in the WHERE clause.
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: Date;
        revenue: any;
        order_count: bigint;
        units_sold: any;
      }>
    >`
      SELECT
        DATE_TRUNC(${truncSql}, o.created_at) AS period,
        COALESCE(SUM(o.grand_total), 0) AS revenue,
        COUNT(DISTINCT o.id) AS order_count,
        COALESCE(SUM(oi.quantity), 0) AS units_sold
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN ('delivered', 'finished')
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
        ${query.channel ? Prisma.sql`AND o.channel = ${query.channel}::order_channel_enum` : Prisma.empty}
      GROUP BY DATE_TRUNC(${truncSql}, o.created_at)
      ORDER BY period ASC
    `;

    const mapped = results.map((r) => {
      const revenue = Number(r.revenue);
      const orders = Number(r.order_count);
      return {
        period: this.formatPeriodFromDate(new Date(r.period), granularity),
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
      this.formatPeriodFromDate.bind(this),
    );
  }

  private getDateTruncInterval(granularity: Granularity): string {
    switch (granularity) {
      case Granularity.HOUR: return 'hour';
      case Granularity.DAY: return 'day';
      case Granularity.WEEK: return 'week';
      case Granularity.MONTH: return 'month';
      case Granularity.YEAR: return 'year';
      default: return 'day';
    }
  }

  private formatPeriodFromDate(date: Date, granularity: Granularity): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');

    switch (granularity) {
      case Granularity.HOUR:
        return `${y}-${m}-${d}T${String(date.getHours()).padStart(2, '0')}:00`;
      case Granularity.DAY:
        return `${y}-${m}-${d}`;
      case Granularity.WEEK:
        return `${y}-${m}-${d}`;
      case Granularity.MONTH:
        return `${y}-${m}`;
      case Granularity.YEAR:
        return `${y}`;
      default:
        return `${y}-${m}-${d}`;
    }
  }

  async getSalesByCustomer(query: SalesAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    const results = await this.prisma.orders.groupBy({
      by: ['customer_id'],
      where: {
        state: { in: this.COMPLETED_STATES },
        customer_id: {
          not: null,
        },
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
      _max: {
        created_at: true,
      },
      orderBy: {
        _sum: {
          grand_total: 'desc',
        },
      },
      take: query.limit || 50,
    });

    const customerIds = results.map((r) => r.customer_id).filter(Boolean) as number[];
    const customers = await this.prisma.users.findMany({
      where: {
        id: {
          in: customerIds,
        },
      },
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

      // Build customer display name: prefer "First Last", fallback to username, then default
      const customerName = customer
        ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.username || 'Cliente'
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
    const { startDate, endDate } = this.parseDateRange(query);

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

    const total = results.reduce((sum, r) => sum + Number(r._sum.grand_total || 0), 0);

    return results
      .map((r) => ({
        channel: r.channel,
        display_name: labels[r.channel] || r.channel,
        order_count: r._count.id,
        revenue: Number(r._sum.grand_total || 0),
        percentage: total > 0 ? (Number(r._sum.grand_total || 0) / total) * 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async getOrdersForExport(query: SalesAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    const orders = await this.prisma.orders.findMany({
      where: {
        state: { in: this.COMPLETED_STATES },
        ...(query.channel && { channel: query.channel }),
        created_at: { gte: startDate, lte: endDate },
      },
      include: {
        order_items: {
          include: {
            products: { select: { name: true, sku: true } },
          },
        },
        users: {
          select: { first_name: true, last_name: true, email: true },
        },
        payments: {
          where: { state: 'succeeded' },
          include: {
            store_payment_method: {
              include: { system_payment_method: { select: { display_name: true } } },
            },
          },
          take: 1,
        },
      },
      orderBy: { created_at: 'desc' },
      take: 10000,
    });

    // Flatten: one row per order_item
    return orders.flatMap(order => {
      const customer = order.users;
      const customerName = customer
        ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Cliente'
        : 'Anónimo';
      const paymentMethod = order.payments?.[0]?.store_payment_method
        ?.system_payment_method?.display_name || 'N/A';

      return order.order_items.map(item => ({
        order_number: order.order_number,
        date: order.created_at?.toISOString().split('T')[0] || '',
        customer_name: customerName,
        customer_email: customer?.email || '',
        channel: order.channel,
        product_name: item.product_name,
        sku: item.products?.sku || item.variant_sku || '',
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        item_total: Number(item.total_price),
        subtotal: Number(order.subtotal_amount),
        discount: Number(order.discount_amount),
        tax: Number(order.tax_amount),
        shipping: Number(order.shipping_cost),
        grand_total: Number(order.grand_total),
        payment_method: paymentMethod,
        state: order.state,
      }));
    });
  }

  // Helper methods
  private parseDateRange(query: SalesAnalyticsQueryDto): { startDate: Date; endDate: Date } {
    if (query.date_from && query.date_to) {
      // date_to comes as 'YYYY-MM-DD' which parses to midnight UTC.
      // Set to end-of-day so orders created during that day are included.
      const endDate = new Date(query.date_to);
      endDate.setUTCHours(23, 59, 59, 999);
      return {
        startDate: new Date(query.date_from),
        endDate,
      };
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (query.date_preset) {
      case DatePreset.TODAY:
        return { startDate: today, endDate: now };
      case DatePreset.YESTERDAY:
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        return { startDate: yesterday, endDate: today };
      case DatePreset.THIS_WEEK:
        const weekStart = new Date(today);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return { startDate: weekStart, endDate: now };
      case DatePreset.LAST_WEEK:
        const lastWeekEnd = new Date(today);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay());
        const lastWeekStart = new Date(lastWeekEnd);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        return { startDate: lastWeekStart, endDate: lastWeekEnd };
      case DatePreset.LAST_MONTH:
        const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        return { startDate: lastMonthStart, endDate: lastMonthEnd };
      case DatePreset.THIS_YEAR:
        return { startDate: new Date(today.getFullYear(), 0, 1), endDate: now };
      case DatePreset.LAST_YEAR:
        return {
          startDate: new Date(today.getFullYear() - 1, 0, 1),
          endDate: new Date(today.getFullYear() - 1, 11, 31),
        };
      case DatePreset.THIS_MONTH:
      default:
        return { startDate: new Date(today.getFullYear(), today.getMonth(), 1), endDate: now };
    }
  }

  private getPreviousPeriod(startDate: Date, endDate: Date): { previousStartDate: Date; previousEndDate: Date } {
    const duration = endDate.getTime() - startDate.getTime();
    const previousEndDate = new Date(startDate.getTime() - 1);
    const previousStartDate = new Date(previousEndDate.getTime() - duration);
    return { previousStartDate, previousEndDate };
  }

  private getPeriodKey(date: Date, granularity: Granularity): string {
    const d = new Date(date);

    switch (granularity) {
      case Granularity.HOUR:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
      case Granularity.DAY:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      case Granularity.WEEK:
        // ISO-8601 week number calculation
        const target = new Date(d.valueOf());
        target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
        const yearStart = new Date(target.getFullYear(), 0, 4);
        const weekNo = 1 + Math.round(((target.getTime() - yearStart.getTime()) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7);
        return `${target.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      case Granularity.MONTH:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      case Granularity.YEAR:
        return `${d.getFullYear()}`;
      default:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
}
