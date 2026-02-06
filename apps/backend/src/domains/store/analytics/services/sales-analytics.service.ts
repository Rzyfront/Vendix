import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { SalesAnalyticsQueryDto, DatePreset, Granularity } from '../dto/analytics-query.dto';

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

    // Get all sales with category info
    const sales = await this.prisma.order_items.findMany({
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        },
      },
      include: {
        products: {
          include: {
            product_categories: {
              include: {
                categories: true,
              },
            },
          },
        },
      },
    });

    // Aggregate by category
    const categoryMap = new Map<number, { name: string; units: number; revenue: number }>();
    let totalRevenue = 0;

    for (const item of sales) {
      const revenue = Number(item.total_price || 0);
      const units = Number(item.quantity || 0);
      totalRevenue += revenue;

      const categories = item.products?.product_categories || [];
      if (categories.length > 0) {
        for (const pc of categories) {
          const cat = pc.categories;
          if (cat) {
            const existing = categoryMap.get(cat.id) || { name: cat.name, units: 0, revenue: 0 };
            existing.units += units;
            existing.revenue += revenue;
            categoryMap.set(cat.id, existing);
          }
        }
      } else {
        // Uncategorized
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

    const orders = await this.prisma.orders.findMany({
      where: {
        state: { in: this.COMPLETED_STATES },
        ...(query.channel && { channel: query.channel }),
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        order_items: true,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    // Group by period
    const periodMap = new Map<string, { revenue: number; orders: number; units: number }>();

    for (const order of orders) {
      const period = this.getPeriodKey(order.created_at, granularity);
      const existing = periodMap.get(period) || { revenue: 0, orders: 0, units: 0 };

      existing.revenue += Number(order.grand_total || 0);
      existing.orders += 1;
      existing.units += order.order_items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

      periodMap.set(period, existing);
    }

    return Array.from(periodMap.entries())
      .map(([period, data]) => ({
        period,
        revenue: data.revenue,
        orders: data.orders,
        units_sold: data.units,
        average_order_value: data.orders > 0 ? data.revenue / data.orders : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
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

  // Helper methods
  private parseDateRange(query: SalesAnalyticsQueryDto): { startDate: Date; endDate: Date } {
    if (query.date_from && query.date_to) {
      return {
        startDate: new Date(query.date_from),
        endDate: new Date(query.date_to),
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
        const weekStart = new Date(d);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        return `${weekStart.getFullYear()}-W${String(Math.ceil((weekStart.getDate()) / 7)).padStart(2, '0')}`;
      case Granularity.MONTH:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      case Granularity.YEAR:
        return `${d.getFullYear()}`;
      default:
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
}
