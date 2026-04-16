import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  ProductsAnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import { formatPeriodFromDate, parseDateRange, getPreviousPeriod, getDateTruncInterval } from '../utils/date.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class ProductsAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  async getProductsSummary(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);
    const { previousStartDate, previousEndDate } = getPreviousPeriod(
      startDate,
      endDate,
    );

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

    const revenueGrowth =
      previousRevenue > 0
        ? ((totalRevenue - previousRevenue) / previousRevenue) * 100
        : 0;
    const unitsGrowth =
      previousUnits > 0
        ? ((totalUnitsSold - previousUnits) / previousUnits) * 100
        : 0;

    return {
      total_products: totalProducts,
      active_products: activeProducts,
      total_revenue: totalRevenue,
      total_units_sold: totalUnitsSold,
      avg_revenue_per_product:
        activeProducts > 0 ? totalRevenue / activeProducts : 0,
      revenue_growth: revenueGrowth,
      units_growth: unitsGrowth,
    };
  }

  async getTopSellingProducts(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);

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

    const productIds = results
      .map((r) => r.product_id)
      .filter(Boolean) as number[];
    const products = (await this.prisma.products.findMany({
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
    })) as {
      id: number;
      name: string;
      sku: string | null;
      base_price: any;
      cost_price: any;
      product_images: { image_url: string }[];
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
    const { startDate, endDate } = parseDateRange(query);
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
    const totalCount = await this.prisma.products.count({
      where: productWhere,
    });

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
      orderBy:
        query.sort_by === 'name'
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

    const salesMap = new Map<
      number | null,
      { quantity: number; totalPrice: number; count: number }
    >(
      salesData.map((s) => [
        s.product_id,
        {
          quantity: Number(s._sum.quantity || 0),
          totalPrice: Number(s._sum.total_price || 0),
          count: s._count.id || 0,
        },
      ]),
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
      const profitMargin =
        costPrice > 0 && basePrice > 0
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
      data.sort(
        (a, b) =>
          ((a as any)[query.sort_by!] - (b as any)[query.sort_by!]) * dir,
      );
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
    const { startDate, endDate } = parseDateRange(query);

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

    const salesMap = new Map<
      number | null,
      { quantity: number; totalPrice: number }
    >(
      salesData.map((s) => [
        s.product_id,
        {
          quantity: Number(s._sum.quantity || 0),
          totalPrice: Number(s._sum.total_price || 0),
        },
      ]),
    );

    return products.map((p) => {
      const sales = salesMap.get(p.id);
      const unitsSold = sales?.quantity || 0;
      const revenue = sales?.totalPrice || 0;
      const basePrice = Number(p.base_price || 0);
      const costPrice = Number(p.cost_price || 0);
      const profitMargin =
        costPrice > 0 && basePrice > 0
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
        profit_margin:
          profitMargin !== null ? Number(profitMargin.toFixed(2)) : null,
      };
    });
  }

  async getProductsTrends(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const truncSql = Prisma.raw(`'${getDateTruncInterval(granularity)}'`);

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
      period: formatPeriodFromDate(new Date(r.period), granularity),
      units_sold: Number(r.units_sold),
      revenue: Number(r.revenue),
    }));

    return fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { units_sold: 0, revenue: 0 },
      formatPeriodFromDate,
    );
  }

  async getProductPerformance(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);

    const completedItems = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
        product_id: { not: null },
      },
      _sum: {
        quantity: true,
        total_price: true,
      },
      _count: {
        id: true,
      },
    });

    // Get refunded quantities per product via refunds -> refund_items relation
    const refundsWithItems = await this.prisma.refunds.findMany({
      where: {
        state: { in: ['completed', 'approved'] as any },
        created_at: { gte: startDate, lte: endDate },
      },
      select: {
        refund_items: {
          select: {
            order_item_id: true,
            quantity: true,
            refund_amount: true,
          },
        },
      },
    });

    // Collect all order_item_ids from refund_items
    const refundedOrderItemIds = refundsWithItems
      .flatMap((r) => r.refund_items.map((ri) => ri.order_item_id))
      .filter(Boolean);

    const refundedOrderItems = refundedOrderItemIds.length > 0
      ? await this.prisma.order_items.findMany({
          where: { id: { in: refundedOrderItemIds } },
          select: { id: true, product_id: true },
        })
      : [];

    const refundByProduct = new Map<number | null, { quantity: number; amount: number }>();
    for (const refund of refundsWithItems) {
      for (const ri of refund.refund_items) {
        const oi = refundedOrderItems.find((o) => o.id === ri.order_item_id);
        if (!oi?.product_id) continue;
        const existing = refundByProduct.get(oi.product_id) || { quantity: 0, amount: 0 };
        existing.quantity += Number(ri.quantity || 0);
        existing.amount += Number(ri.refund_amount || 0);
        refundByProduct.set(oi.product_id, existing);
      }
    }

    const productIds = completedItems
      .map((r) => r.product_id)
      .filter((id): id is number => id !== null);

    const products = (await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        product_images: { select: { image_url: true }, take: 1 },
      },
    })) as {
      id: number;
      name: string;
      sku: string | null;
      product_images: { image_url: string }[];
    }[];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const allResults = completedItems
      .filter((r) => r.product_id !== null)
      .map((r) => {
        const product = productMap.get(r.product_id!);
        const unitsSold = Number(r._sum.quantity || 0);
        const revenue = Number(r._sum.total_price || 0);
        const orderCount = r._count.id || 0;
        const refunds = refundByProduct.get(r.product_id!) || { quantity: 0, amount: 0 };
        const returnRate = unitsSold > 0 ? (refunds.quantity / unitsSold) * 100 : 0;

        return {
          product_id: r.product_id,
          product_name: product?.name || 'Desconocido',
          sku: product?.sku || '',
          image_url: product?.product_images?.[0]?.image_url || null,
          units_sold: unitsSold,
          revenue,
          order_count: orderCount,
          avg_units_per_order: orderCount > 0 ? unitsSold / orderCount : 0,
          refunded_units: refunds.quantity,
          refunded_amount: refunds.amount,
          return_rate: Number(returnRate.toFixed(2)),
        };
      })
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

    return allResults.slice(0, query.limit || 20);
  }

  async getProductProfitability(query: ProductsAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);

    const items = await this.prisma.order_items.groupBy({
      by: ['product_id'],
      where: {
        orders: {
          state: { in: this.COMPLETED_STATES },
          created_at: { gte: startDate, lte: endDate },
        },
        product_id: { not: null },
      },
      _sum: {
        quantity: true,
        total_price: true,
        cost_price: true,
      },
    });

    const productIds = items
      .map((r) => r.product_id)
      .filter((id): id is number => id !== null);

    const products = (await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        sku: true,
        base_price: true,
        cost_price: true,
        product_categories: {
          select: { categories: { select: { name: true } } },
        },
      },
    })) as {
      id: number;
      name: string;
      sku: string | null;
      base_price: any;
      cost_price: any;
      product_categories: { categories: { name: string } }[];
    }[];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const results = items
      .filter((r) => r.product_id !== null)
      .map((r) => {
        const product = productMap.get(r.product_id!);
        const revenue = Number(r._sum.total_price || 0);
        const totalCost = Number(r._sum.cost_price || 0) * Number(r._sum.quantity || 0);
        const unitsSold = Number(r._sum.quantity || 0);
        const profit = revenue - totalCost;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        const markup = totalCost > 0 ? (profit / totalCost) * 100 : 0;
        const basePrice = product ? Number(product.base_price || 0) : 0;
        const catalogCostPrice = product ? Number(product.cost_price || 0) : 0;
        const catalogMargin =
          catalogCostPrice > 0 && basePrice > 0
            ? ((basePrice - catalogCostPrice) / basePrice) * 100
            : null;

        return {
          product_id: r.product_id,
          product_name: product?.name || 'Desconocido',
          sku: product?.sku || '',
          category: product?.product_categories?.[0]?.categories?.name || null,
          revenue,
          total_cost: totalCost,
          profit,
          margin: Number(margin.toFixed(2)),
          markup: Number(markup.toFixed(2)),
          units_sold: unitsSold,
          avg_selling_price: unitsSold > 0 ? revenue / unitsSold : 0,
          catalog_base_price: basePrice,
          catalog_cost_price: catalogCostPrice,
          catalog_margin: catalogMargin !== null ? Number(catalogMargin.toFixed(2)) : null,
        };
      })
      .sort((a, b) => b.profit - a.profit);

    const totalRevenue = results.reduce((sum, r) => sum + r.revenue, 0);
    const totalProfit = results.reduce((sum, r) => sum + r.profit, 0);
    const totalCost = results.reduce((sum, r) => sum + r.total_cost, 0);

    const summary = {
      total_products: results.length,
      total_revenue: totalRevenue,
      total_cost: totalCost,
      total_profit: totalProfit,
      overall_margin: totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(2)) : 0,
    };

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = results.length;
      const data = results.slice((page - 1) * limit, page * limit);

      return {
        data,
        summary,
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

    return {
      products: results.slice(0, query.limit || 50),
      summary,
    };
  }

  async getProductPerformanceForExport(query: ProductsAnalyticsQueryDto) {
    const exportQuery = { ...query, page: undefined, limit: 10000 };
    const result = await this.getProductPerformance(exportQuery);
    const rows = Array.isArray(result) ? result : (result as any).data || [];
    return rows.map((r: any) => ({
      'Producto': r.product_name,
      'SKU': r.sku,
      'Unidades Vendidas': r.units_sold,
      'Ingresos': r.revenue,
      'Devoluciones': r.refunded_units,
      'Monto Devuelto': r.refunded_amount,
      'Tasa Devolución (%)': r.return_rate,
      'Órdenes': r.order_count,
    }));
  }

  async getProductProfitabilityForExport(query: ProductsAnalyticsQueryDto) {
    const exportQuery = { ...query, page: undefined, limit: 10000 };
    const result = await this.getProductProfitability(exportQuery);
    const rows = (result as any).products || (result as any).data || [];
    return rows.map((r: any) => ({
      'Producto': r.product_name,
      'SKU': r.sku,
      'Categoría': r.category || '',
      'Unidades Vendidas': r.units_sold,
      'Ingresos': r.revenue,
      'Costo Total': r.total_cost,
      'Ganancia': r.profit,
      'Margen (%)': r.margin,
      'Markup (%)': r.markup,
    }));
  }

}
