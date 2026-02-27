import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ProductsAnalyticsQueryDto, DatePreset, Granularity } from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';

@Injectable()
export class ProductsAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  async getProductsSummary(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const { previousStartDate, previousEndDate } = this.getPreviousPeriod(startDate, endDate);

    // Total and active products in the store
    const [totalProducts, activeProducts] = await Promise.all([
      this.prisma.products.count(),
      this.prisma.products.count({ where: { state: 'active' } }),
    ]);

    // Current period: revenue + units from order_items
    const currentItems = await this.prisma.order_items.aggregate({
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        total_price: true,
        quantity: true,
      },
    });

    // Previous period for growth comparison
    const previousItems = await this.prisma.order_items.aggregate({
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: previousStartDate, lte: previousEndDate },
        },
      },
      _sum: {
        total_price: true,
        quantity: true,
      },
    });

    const totalRevenue = Number(currentItems._sum.total_price || 0);
    const totalUnitsSold = Number(currentItems._sum.quantity || 0);
    const previousRevenue = Number(previousItems._sum.total_price || 0);
    const previousUnits = Number(previousItems._sum.quantity || 0);

    const revenueGrowth = previousRevenue > 0
      ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
      : 0;
    const unitsGrowth = previousUnits > 0
      ? ((totalUnitsSold - previousUnits) / previousUnits) * 100
      : 0;

    return {
      total_products: totalProducts,
      active_products: activeProducts,
      total_revenue: totalRevenue,
      total_units_sold: totalUnitsSold,
      avg_revenue_per_product: activeProducts > 0 ? totalRevenue / activeProducts : 0,
      revenue_growth: revenueGrowth,
      units_growth: unitsGrowth,
    };
  }

  async getTopSellingProducts(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    const results = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
        ...(query.category_id && {
          products: {
            product_categories: {
              some: { category_id: query.category_id },
            },
          },
        }),
      },
      _sum: {
        quantity: true,
        total_price: true,
      },
      orderBy: {
        _sum: { total_price: 'desc' },
      },
      take: query.limit || 10,
    });

    const productIds = results.map((r) => r.product_id).filter(Boolean) as number[];
    const products = await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        cost_price: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
      },
    }) as { id: number; name: string; sku: string | null; base_price: any; cost_price: any; product_images: { image_url: string }[] }[];

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
        product_name: product?.name || 'Desconocido',
        sku: product?.sku || '',
        image_url: product?.product_images?.[0]?.image_url || null,
        units_sold: units,
        revenue,
        average_price: avgPrice,
        profit_margin: profitMargin,
      };
    });
  }

  async getProductsTable(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const page = query.page || 1;
    const limit = query.limit || 20;
    const search = query.search?.trim();

    // Build product where clause
    const productWhere: any = {
      state: 'active',
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(query.category_id && {
        product_categories: {
          some: { category_id: query.category_id },
        },
      }),
      ...(query.brand_id && { brand_id: query.brand_id }),
    };

    // Get total count
    const totalCount = await this.prisma.products.count({ where: productWhere });

    // Get paginated products
    const products = await this.prisma.products.findMany({
      where: productWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        cost_price: true,
        stock_quantity: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
      },
      orderBy: query.sort_by === 'name'
        ? { name: query.sort_order || 'asc' }
        : query.sort_by === 'base_price'
          ? { base_price: query.sort_order || 'desc' }
          : query.sort_by === 'stock_quantity'
            ? { stock_quantity: query.sort_order || 'desc' }
            : { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const productIds = products.map((p) => p.id);

    // Get sales data for these products in the date range
    const salesData = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        product_id: { in: productIds },
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        quantity: true,
        total_price: true,
      },
      _count: {
        id: true,
      },
    });

    // Get last sold dates
    const lastSoldData = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        product_id: { in: productIds },
        orders: {
          state: { in: this.COMPLETED_STATES },
        },
      },
      _max: {
        created_at: true,
      },
    });

    const salesMap = new Map<number | null, { quantity: number; totalPrice: number; count: number }>(
      salesData.map((s) => [s.product_id, {
        quantity: Number(s._sum.quantity || 0),
        totalPrice: Number(s._sum.total_price || 0),
        count: s._count.id || 0,
      }]),
    );
    const lastSoldMap = new Map<number | null, Date | null>(
      lastSoldData.map((s) => [s.product_id, s._max.created_at]),
    );

    const data = products.map((p) => {
      const sales = salesMap.get(p.id);
      const unitsSold = sales?.quantity || 0;
      const revenue = sales?.totalPrice || 0;
      const orderCount = sales?.count || 0;
      const basePrice = Number(p.base_price || 0);
      const costPrice = Number(p.cost_price || 0);
      const profitMargin = costPrice > 0 && basePrice > 0
        ? ((basePrice - costPrice) / basePrice) * 100
        : null;
      const lastSold = lastSoldMap.get(p.id);

      return {
        product_id: p.id,
        name: p.name,
        sku: p.sku || '',
        image_url: (p as any).product_images?.[0]?.image_url || null,
        base_price: basePrice,
        cost_price: costPrice,
        stock_quantity: p.stock_quantity || 0,
        units_sold: unitsSold,
        revenue,
        avg_order_value: orderCount > 0 ? revenue / orderCount : 0,
        profit_margin: profitMargin,
        last_sold_at: lastSold ? lastSold.toISOString() : null,
      };
    });

    // Sort by sales-derived fields if requested
    if (query.sort_by === 'units_sold' || query.sort_by === 'revenue') {
      const dir = query.sort_order === 'asc' ? 1 : -1;
      data.sort((a, b) => ((a as any)[query.sort_by!] - (b as any)[query.sort_by!]) * dir);
    }

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

  async getProductsForExport(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    // Get all active products
    const products = await this.prisma.products.findMany({
      where: {
        state: 'active',
        ...(query.category_id && {
          product_categories: {
            some: { category_id: query.category_id },
          },
        }),
        ...(query.brand_id && { brand_id: query.brand_id }),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        cost_price: true,
        stock_quantity: true,
      },
      orderBy: { name: 'asc' },
      take: 10000,
    });

    const productIds = products.map((p) => p.id);

    // Get sales data for all products
    const salesData = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        product_id: { in: productIds },
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
      },
      _sum: {
        quantity: true,
        total_price: true,
      },
    });

    const salesMap = new Map<number | null, { quantity: number; totalPrice: number }>(
      salesData.map((s) => [s.product_id, {
        quantity: Number(s._sum.quantity || 0),
        totalPrice: Number(s._sum.total_price || 0),
      }]),
    );

    return products.map((p) => {
      const sales = salesMap.get(p.id);
      const unitsSold = sales?.quantity || 0;
      const revenue = sales?.totalPrice || 0;
      const basePrice = Number(p.base_price || 0);
      const costPrice = Number(p.cost_price || 0);
      const profitMargin = costPrice > 0 && basePrice > 0
        ? ((basePrice - costPrice) / basePrice) * 100
        : null;

      return {
        name: p.name,
        sku: p.sku || '',
        base_price: basePrice,
        cost_price: costPrice,
        stock_quantity: p.stock_quantity || 0,
        units_sold: unitsSold,
        revenue,
        profit_margin: profitMargin !== null ? Number(profitMargin.toFixed(2)) : null,
      };
    });
  }

  async getProductsTrends(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new ForbiddenException('Store context required for product trends');
    }
    const storeId = context.store_id;

    const truncSql = Prisma.raw(`'${this.getDateTruncInterval(granularity)}'`);

    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: Date;
        units_sold: any;
        revenue: any;
      }>
    >`
      SELECT
        DATE_TRUNC(${truncSql}, o.created_at) AS period,
        COALESCE(SUM(oi.quantity), 0) AS units_sold,
        COALESCE(SUM(oi.total_price), 0) AS revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN ('delivered', 'finished')
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
      GROUP BY DATE_TRUNC(${truncSql}, o.created_at)
      ORDER BY period ASC
    `;

    const mapped = results.map((r) => ({
      period: this.formatPeriodFromDate(new Date(r.period), granularity),
      units_sold: Number(r.units_sold),
      revenue: Number(r.revenue),
    }));

    return fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { units_sold: 0, revenue: 0 },
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

  // Helper methods (duplicated from SalesAnalyticsService to keep services independent)
  private parseDateRange(query: ProductsAnalyticsQueryDto): { startDate: Date; endDate: Date } {
    if (query.date_from && query.date_to) {
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
}
