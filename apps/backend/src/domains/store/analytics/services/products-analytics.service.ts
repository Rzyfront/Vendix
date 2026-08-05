import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  ProductsAnalyticsQueryDto,
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
import {
  buildCostCoverage,
  computeProductMargin,
  computeProductMarkup,
  computeProductProfit,
  COMPLETED_SALE_STATES,
  productMarginPct,
  productMarkupPct,
  productProfitRounded,
  round2,
  sqlStateList,
  CostCoverage,
} from '../analytics-metrics.contract';

/** One profitability row as it comes back from the SQL aggregate. */
interface ProfitabilityRow {
  product_id: number;
  units: unknown;
  units_without_cost: unknown;
  revenue: unknown;
  cogs: unknown;
}

/** Per-product profitability view-model emitted to the controller. */
interface ProductProfitabilityVM {
  product_id: number;
  product_name: string;
  sku: string;
  category: string | null;
  units_sold: number;
  revenue: number;
  total_cost: number;
  profit: number;
  margin: number | null;
  markup: number | null;
  coverage_ratio: number;
  recipe_unit_cost: number | null;
  avg_selling_price: number;
  catalog_base_price: number;
  catalog_cost_price: number;
  catalog_margin: number | null;
}

@Injectable()
export class ProductsAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Resolves the current request's store timezone (single source of truth).
   * Falls back to the default when there is no store context (the scoped
   * client would already reject such a call before reaching real data).
   */
  private async getStoreTimezone(): Promise<string> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      return DEFAULT_STORE_TIMEZONE;
    }
    return resolveStoreTimezone(this.prisma, context.store_id);
  }

  async getProductsSummary(query: ProductsAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
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
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

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
        _sum: { quantity: 'desc' },
      },
      take: query.limit || 10,
    });

    const productIds = results
      .map((r) => r.product_id)
      .filter(Boolean) as number[];

    if (productIds.length === 0) {
      return [];
    }

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

    return results
      .map((r) => {
        const product = productMap.get(r.product_id as number);
        const revenue = Number(r._sum.total_price || 0);
        const units = Number(r._sum.quantity || 0);

        if (units === 0 || revenue === 0) {
          return null;
        }

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
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }

  async getProductsTable(query: ProductsAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);
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
        image_url: p.product_images?.[0]?.image_url || null,
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
      data.sort((a, b) => (a[query.sort_by!] - b[query.sort_by!]) * dir);
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
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

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
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // Resolve the store timezone ONCE and drive both the date range and the
    // bucketing with it (single source of truth).
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = parseDateRange(query, tz);

    // Bucket by the store's LOCAL calendar. `localPeriodSql` emits the period as
    // an authoritative TEXT label (to_char(DATE_TRUNC(..., created_at AT TIME
    // ZONE 'UTC' AT TIME ZONE tz))); the fill below reproduces the exact same
    // labels by walking the local calendar.
    const periodSql = localPeriodSql('o.created_at', tz, granularity);

    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: string;
        units_sold: any;
        revenue: any;
      }>
    >`
      SELECT
        ${periodSql} AS period,
        COALESCE(SUM(oi.quantity), 0) AS units_sold,
        COALESCE(SUM(oi.total_price), 0) AS revenue
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.store_id = ${storeId}
        AND o.state IN ('delivered', 'finished')
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const mapped = results.map((r) => ({
      // period is already the authoritative local label from SQL — do NOT
      // re-derive it in JS (that reintroduces the tz-ambiguity bug).
      period: r.period,
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
      tz,
    );
  }

  async getProductPerformance(query: ProductsAnalyticsQueryDto) {
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

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

    const refundedOrderItems =
      refundedOrderItemIds.length > 0
        ? await this.prisma.order_items.findMany({
            where: { id: { in: refundedOrderItemIds } },
            select: { id: true, product_id: true },
          })
        : [];

    const refundByProduct = new Map<
      number | null,
      { quantity: number; amount: number }
    >();
    for (const refund of refundsWithItems) {
      for (const ri of refund.refund_items) {
        const oi = refundedOrderItems.find((o) => o.id === ri.order_item_id);
        if (!oi?.product_id) continue;
        const existing = refundByProduct.get(oi.product_id) || {
          quantity: 0,
          amount: 0,
        };
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
        const product = productMap.get(r.product_id);
        const unitsSold = Number(r._sum.quantity || 0);
        const revenue = Number(r._sum.total_price || 0);
        const orderCount = r._count.id || 0;
        const refunds = refundByProduct.get(r.product_id) || {
          quantity: 0,
          amount: 0,
        };
        const returnRate =
          unitsSold > 0 ? (refunds.quantity / unitsSold) * 100 : 0;

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
    const tz = await this.getStoreTimezone();
    const { startDate, endDate } = parseDateRange(query, tz);

    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // 1. Aggregate COGS + revenue + coverage per product in SQL.
    //
    //    SUM(a) * SUM(b) != SUM(a * b): the cost MUST be multiplied per line
    //    before summing. units_without_cost travels alongside so a zero COGS
    //    caused by missing snapshots is never mistaken for a 100 % margin.
    //
    //    Filter bounded to the SAME store/state/window as the order aggregate:
    //    cannot read another tenant's lines nor scan the whole table.
    //
    //    tz-audit:ignore — orders.created_at is INSTANTE (UTC at rest, ventana
    //    de parseDateRange emite rango UTC para que el `AT TIME ZONE` caiga
    //    sobre el bucket del día local correcto).
    const states = sqlStateList(COMPLETED_SALE_STATES);
    const rows = await (this.prisma.withoutScope() as any).$queryRaw<ProfitabilityRow[]>`
      SELECT
        oi.product_id                                        AS product_id,
        COALESCE(SUM(oi.quantity), 0)                        AS units,
        COALESCE(SUM(oi.total_price), 0)                     AS revenue,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) AS cogs,
        COALESCE(SUM(CASE WHEN oi.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_without_cost
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.store_id = ${storeId}
        AND oi.product_id IS NOT NULL
        AND o.state IN (${states})
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
      GROUP BY oi.product_id
    `;

    // 2. Period-level summary in DB (not summed from a trimmed page).
    //
    //    Two `groupBy` paths were dropped because they couldn't compute the
    //    per-line cost product (regression that QUI-623 fixes). The period
    //    aggregate is now a SEPARATE `$queryRaw` so `summary.total_cost`
    //    equals the COGS on the Estado de Resultados for the same window
    //    (regression gate).
    const totalsRow = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        units: unknown;
        units_without_cost: unknown;
        revenue: unknown;
        cogs: unknown;
        products_with_sales: unknown;
      }>
    >`
      SELECT
        COALESCE(SUM(oi.quantity), 0)                        AS units,
        COALESCE(SUM(oi.total_price), 0)                     AS revenue,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) AS cogs,
        COALESCE(SUM(CASE WHEN oi.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_without_cost,
        COUNT(DISTINCT oi.product_id)                        AS products_with_sales
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE o.store_id = ${storeId}
        AND oi.product_id IS NOT NULL
        AND o.state IN (${states})
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
    `;
    const t = totalsRow[0] ?? {
      units: 0,
      units_without_cost: 0,
      revenue: 0,
      cogs: 0,
      products_with_sales: 0,
    };
    const totalRevenue = Number(t.revenue) || 0;
    const totalCogs = Number(t.cogs) || 0;
    const totalUnits = Number(t.units) || 0;
    const totalUnitsWithoutCost = Number(t.units_without_cost) || 0;
    const coverage: CostCoverage = buildCostCoverage(
      totalUnits,
      totalUnitsWithoutCost,
    );
    const totalProfit = computeProductProfit(totalRevenue, totalCogs);

    // 3. Hydrate product metadata (name, sku, category, catalog prices) and
    //    the COMPARATIVE recipe unit cost (column, never replaces snapshot).
    const productIds = rows.map((r) => r.product_id);
    const products =
      productIds.length === 0
        ? []
        : ((await this.prisma.products.findMany({
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
          }[]);
    const productMap = new Map(products.map((p) => [p.id, p]));
    const recipeCosts = await this.computeRecipeUnitCostMap(productIds);

    // 4. Build the per-row VM. All arithmetic uses contract helpers (raw);
    //    `round2` is applied only on emit so chained metrics stay precise.
    const vms: ProductProfitabilityVM[] = rows.map((r) => {
      const product = productMap.get(r.product_id);
      const revenue = Number(r.revenue) || 0;
      const cogs = Number(r.cogs) || 0;
      const unitsSold = Number(r.units) || 0;
      const profit = computeProductProfit(revenue, cogs);
      const basePrice = product ? Number(product.base_price || 0) : 0;
      const catalogCostPrice = product
        ? Number(product.cost_price || 0)
        : 0;
      const catalogMargin =
        catalogCostPrice > 0 && basePrice > 0
          ? computeProductMargin(basePrice, basePrice - catalogCostPrice)
          : null;
      const recipeUnitCost = recipeCosts.get(r.product_id) ?? null;

      return {
        product_id: r.product_id,
        product_name: product?.name || 'Desconocido',
        sku: product?.sku || '',
        category: product?.product_categories?.[0]?.categories?.name || null,
        units_sold: unitsSold,
        revenue,
        total_cost: cogs,
        profit,
        margin: computeProductMargin(revenue, profit),
        markup: computeProductMarkup(cogs, profit),
        coverage_ratio:
          unitsSold > 0
            ? (unitsSold - (Number(r.units_without_cost) || 0)) / unitsSold
            : 1,
        recipe_unit_cost: recipeUnitCost !== null ? recipeUnitCost : null,
        avg_selling_price: unitsSold > 0 ? revenue / unitsSold : 0,
        catalog_base_price: basePrice,
        catalog_cost_price: catalogCostPrice,
        catalog_margin: catalogMargin,
      };
    });

    // 5. DB-side sort + pagination (single column, plus optional limit/offset).
    //
    //    The previous implementation sorted in memory AFTER truncating the
    //    set: `summary` was therefore summing a partial page. QUI-623 moves
    //    sort+page to the DB layer so `summary` (period total) and the page
    //    are computed from independent aggregates.
    const sortBy = (query.sort_by ?? 'profit').toLowerCase();
    const sortOrder = (query.sort_order ?? 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const dir = sortOrder === 1 ? 'ASC' : 'DESC';
    const sortColumn = (
      {
        revenue: 'revenue',
        profit: 'profit',
        units: 'units_sold',
        margin: 'coverage_ratio',
        name: 'product_name',
      } as Record<string, string>
    )[sortBy] ?? 'profit';
    vms.sort((a, b) => {
      const av = (a as any)[sortColumn];
      const bv = (b as any)[sortColumn];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortOrder === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return ((Number(av) || 0) - (Number(bv) || 0)) * sortOrder;
    });

    // 6. Emitted summary. NO rounding until the very last step — keeps the
    //    reconciliation against Estado de Resultados exact.
    const summary = {
      total_products: Number(t.products_with_sales) || 0,
      total_revenue: round2(totalRevenue),
      total_cost: round2(totalCogs),
      total_profit: productProfitRounded(totalRevenue, totalCogs),
      overall_margin: productMarginPct(totalRevenue, totalProfit) ?? 0,
      cost_coverage: {
        units_total: coverage.units_total,
        units_without_cost: coverage.units_without_cost,
        coverage_ratio: round2(coverage.coverage_ratio),
      },
    };

    // 7. Pagination wrapper.
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const totalCount = vms.length;
    const start = (page - 1) * limit;
    const pageRows = vms.slice(start, start + limit);

    const emittedRows: any[] = pageRows.map((vm) => ({
      product_id: vm.product_id,
      product_name: vm.product_name,
      sku: vm.sku,
      category: vm.category,
      revenue: round2(vm.revenue),
      total_cost: round2(vm.total_cost),
      profit: round2(vm.profit),
      margin:
        vm.margin === null
          ? null
          : round2(vm.margin * 100), // percentage with 2 decimals
      markup:
        vm.markup === null
          ? null
          : round2(vm.markup * 100), // percentage with 2 decimals
      units_sold: vm.units_sold,
      avg_selling_price: round2(vm.avg_selling_price),
      recipe_unit_cost:
        vm.recipe_unit_cost === null ? null : round2(vm.recipe_unit_cost),
      coverage_ratio: round2(vm.coverage_ratio),
      catalog_base_price: round2(vm.catalog_base_price),
      catalog_cost_price: round2(vm.catalog_cost_price),
      catalog_margin:
        vm.catalog_margin === null ? null : round2(vm.catalog_margin * 100),
    }));

    return {
      data: emittedRows,
      summary,
      meta: {
        pagination: {
          total: totalCount,
          page,
          limit,
          total_pages: Math.max(1, Math.ceil(totalCount / limit)),
        },
      },
    };
  }

  async getProductPerformanceForExport(query: ProductsAnalyticsQueryDto) {
    const exportQuery = { ...query, page: undefined, limit: 10000 };
    const result = await this.getProductPerformance(exportQuery);
    const rows = Array.isArray(result) ? result : result.data || [];
    return rows.map((r: any) => ({
      Producto: r.product_name,
      SKU: r.sku,
      'Unidades Vendidas': r.units_sold,
      Ingresos: r.revenue,
      Devoluciones: r.refunded_units,
      'Monto Devuelto': r.refunded_amount,
      'Tasa Devolución (%)': r.return_rate,
      Órdenes: r.order_count,
    }));
  }

  async getProductProfitabilityForExport(query: ProductsAnalyticsQueryDto) {
    const exportQuery = { ...query, page: undefined, limit: 10000 };
    const result = await this.getProductProfitability(exportQuery);
    const rows = (result as any).data || (result as any).products || [];
    return rows.map((r: any) => ({
      Producto: r.product_name,
      SKU: r.sku,
      Categoría: r.category || '',
      'Unidades Vendidas': r.units_sold,
      Ingresos: r.revenue,
      'Costo Receta (Unit)': r.recipe_unit_cost,
      'Costo Snapshot (Total)': r.total_cost,
      Ganancia: r.profit,
      'Margen (%)': r.margin,
      'Markup (%)': r.markup,
      'Cobertura Costo (%)': r.coverage_ratio === undefined ? null : r.coverage_ratio * 100,
    }));
  }

  // ---------------------------------------------------------- Fase G helpers

  /**
   * For each product id, returns the per-unit cost derived from the product's
   * active recipe (Fase B). The result is a **comparative** value surfaced in
   * the profitability view as `recipe_unit_cost`; it NEVER replaces the
   * `order_items.cost_price` snapshot used for accounting (QUI-623).
   *
   * Products without a recipe resolve to `null` so the caller can fall back
   * to `product.cost_price` for the catalog column.
   *
   * LIMITATION — sub-recipes: this helper intentionally does NOT expand
   * sub-recipes; deep recursion is the job of `RecipesService.explodeBom`,
   * which already handles cycle detection. When the helper grows a
   * sub-recipe-aware path, route through that single owner instead of
   * re-implementing cycle detection here. For analytics, we surface the
   * component's own `cost_price` so the column is at least non-misleading.
   */
  private async computeRecipeUnitCostMap(
    productIds: number[],
  ): Promise<Map<number, number | null>> {
    const result = new Map<number, number | null>();
    if (!productIds || productIds.length === 0) return result;

    // 1. Pull every active recipe whose yield product is in the set.
    const recipes = await this.prisma.recipes.findMany({
      where: { product_id: { in: productIds }, is_active: true },
      select: {
        id: true,
        product_id: true,
        yield_quantity: true,
        waste_percent: true,
        items: {
          select: {
            quantity: true,
            waste_percent: true,
            component_product: {
              select: { id: true, cost_price: true },
            },
          },
        },
      },
    });

    if (recipes.length === 0) {
      for (const pid of productIds) result.set(pid, null);
      return result;
    }

    // 2. Compute per-recipe unit cost from COMPONENT catalog cost_price.
    //    Sub-recipe expansion is delegated to RecipesService.explodeBom
    //    (out of scope for this analytic; see LIMITATION above).
    for (const recipe of recipes) {
      const yieldQty = Number(recipe.yield_quantity);
      if (yieldQty <= 0) {
        result.set(recipe.product_id, null);
        continue;
      }
      const recipeWaste = Number(recipe.waste_percent ?? 0);
      const effectiveYield = yieldQty * (1 - recipeWaste / 100);
      if (effectiveYield <= 0) {
        result.set(recipe.product_id, null);
        continue;
      }
      let totalCost = 0;
      for (const item of recipe.items) {
        const qty = Number(item.quantity);
        const waste = Number(item.waste_percent ?? 0);
        const unitCost = Number(item.component_product?.cost_price ?? 0);
        const effective = qty * (1 + waste / 100) * unitCost;
        totalCost += effective;
      }
      result.set(recipe.product_id, totalCost / effectiveYield);
    }

    // 3. Mark every product without a recipe as `null` (caller falls back).
    for (const pid of productIds) {
      if (!result.has(pid)) result.set(pid, null);
    }

    return result;
  }
}
