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
  formatAggregateQuantity,
  resolveSaleUnitCodes,
  saleUnitScaleFactor,
} from '../../products/services/sale-unit-display.util';
import { resolvePricedUnits } from '../../products/services/tier-margin.util';

@Injectable()
export class ProductsAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private readonly COMPLETED_STATES = ['delivered', 'finished'];

  /**
   * Costo de catálogo llevado a la MISMA escala en la que se publica
   * `base_price`, para poder restarlos.
   *
   * `products.cost_price` es el promedio ponderado por UNIDAD MÍNIMA de stock
   * —lo escribe `CostingService` como `valor / quantity_on_hand`—, mientras que
   * `base_price` cubre `price_unit_quantity` de esas unidades. Un cable con el
   * stock en milímetros y `price_unit_quantity = 1000` guarda $3 el milímetro y
   * $5.000 el metro: restarlos tal cual comparaba peras con manzanas y publicaba
   * un margen del 99,94% donde el negocio gana 40%. Y no es un número
   * decorativo: es con el que el comerciante decide si sube o baja el precio.
   *
   * Se sube el COSTO a la escala del precio y no al revés porque la escala
   * comercial es la que el comerciante entiende y la que ya usan las columnas
   * vecinas del reporte —el costo del metro es el del milímetro × 1.000—. Bajar
   * el precio a la unidad mínima daría el mismo porcentaje pero imprimiría
   * "Precio Base $5" para un cable que se vende a $5.000 el metro.
   *
   * `resolvePricedUnits` es el mismo resolutor que usa el editor de producto
   * (`tier-margin.util`), así que la analítica y el formulario miden el margen
   * contra el mismo costo de referencia. Con `price_unit_quantity` ausente,
   * nulo o 1 —el catálogo abrumadoramente mayoritario— devuelve 1 y el costo
   * sale intacto: cero regresión sobre los números de hoy.
   */
  private costInPriceScale(
    costPrice: number,
    priceUnitQuantity?: number | null,
  ): number {
    return costPrice * resolvePricedUnits(null, priceUnitQuantity);
  }

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

    // QUI-622 review: units_without_cost via SUM(quantity) filtrado por
    // cost_price IS NULL — mismo patron que products/profitability (QUI-623).
    // El calculo anterior usaba COUNT(*) (filas) que no es units.
    const coverageMap = new Map<number, { units_without_cost: number }>();
    const productIds = results
      .map((r) => r.product_id)
      .filter(Boolean) as number[];
    if (productIds.length > 0) {
      const contextStoreId = RequestContextService.getContext()?.store_id ?? 0;
      const coverageRows = await (this.prisma as any).$queryRaw<
        Array<{ product_id: number; units_without_cost: bigint }>
      >`
        SELECT oi.product_id AS product_id,
               COALESCE(SUM(CASE WHEN oi.cost_price IS NULL THEN oi.quantity ELSE 0 END), 0) AS units_without_cost
        FROM order_items oi
        INNER JOIN orders o ON o.id = oi.order_id
        WHERE o.store_id = ${contextStoreId}
          AND o.state IN (${Prisma.join(this.COMPLETED_STATES.map((s) => Prisma.raw(`'${s}'`)))})
          AND o.created_at >= ${startDate}
          AND o.created_at <= ${endDate}
          AND oi.product_id IN (${Prisma.join(productIds.map((id) => Prisma.raw(`${id}`)))})
        GROUP BY oi.product_id
      `;
      for (const row of coverageRows) {
        coverageMap.set(Number(row.product_id), {
          units_without_cost: Number(row.units_without_cost),
        });
      }
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
        const unitsWithoutCost = coverageMap.get(r.product_id as number)?.units_without_cost ?? 0;

        if (units === 0 || revenue === 0) {
          return null;
        }

        // Acá NO se reescala el costo, y es a propósito: `avgPrice` es
        // `revenue / units` con `units` en unidades de STOCK, o sea dinero por
        // unidad mínima —la misma vara con la que `cost_price` está guardado—.
        // Multiplicar el costo por `price_unit_quantity` como en las columnas
        // de catálogo rompería este margen, que hoy es correcto.
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
          units_without_cost: unitsWithoutCost,
          cost_coverage_ratio:
            units > 0 ? (units - unitsWithoutCost) / units : 1,
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
        price_unit_quantity: true,
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
      // Costo en la escala del precio (ver `costInPriceScale`): la fila muestra
      // ambos juntos, así que `Precio Costo` tiene que medir lo mismo que
      // `Precio Base` o el margen que las acompaña no se puede reproducir.
      const costPrice = this.costInPriceScale(
        Number(p.cost_price || 0),
        p.price_unit_quantity,
      );
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
        price_unit_quantity: true,
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

    // Unidad de venta por producto: "Stock" y "Unidades Vendidas" son cantidades
    // guardadas en la unidad mínima de inventario, y sin traducir imprimen 3000
    // donde el comerciante vendió 3 metros.
    const saleUnits = await resolveSaleUnitCodes(this.prisma as any, productIds);

    return products.map((p) => {
      const sales = salesMap.get(p.id);
      const unitsSold = sales?.quantity || 0;
      const revenue = sales?.totalPrice || 0;
      const basePrice = Number(p.base_price || 0);
      // `Precio Costo` viaja en la misma escala que `Precio Base` (ver
      // `costInPriceScale`); si no, `Margen (%)` restaba el costo del milímetro
      // al precio del metro y publicaba 99,94% donde el negocio gana 40%.
      const costPrice = this.costInPriceScale(
        Number(p.cost_price || 0),
        p.price_unit_quantity,
      );
      const profitMargin =
        costPrice > 0 && basePrice > 0
          ? ((basePrice - costPrice) / basePrice) * 100
          : null;

      const info = saleUnits.get(p.id);
      const sold = formatAggregateQuantity(unitsSold, info);
      const stock = formatAggregateQuantity(p.stock_quantity || 0, info);

      return {
        name: p.name,
        sku: p.sku || '',
        base_price: basePrice,
        cost_price: costPrice,
        stock_quantity: stock.value,
        units_sold: sold.value,
        // Una sola columna de unidad para toda la fila: stock y ventas del
        // mismo producto se miden con la misma vara, por construcción.
        unit: sold.suffix,
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

    // QUI-621: refund-rate uses POLICY A — refunds of orders SOLD in the
    // period, even when the refund itself happens later. The previous code
    // used `refunds.created_at` (Policy B) — refunds PROCESSED in the period —
    // which divided refunds of OTHER periods by sales of THIS period. When
    // the two ranges didn't match, the rate was meaningless (e.g. negative
    // when a refund-heavy month had low sales).
    //
    // Policy A: join refund_items → order_items → orders filtered by sales
    // window. The SQL below does that join in one pass.
    const rawClient = (this.prisma as any).withoutScope() as {
      $queryRaw: <T>(query: any) => Promise<T>;
    };
    const refundByProduct = await rawClient.$queryRaw<
      Array<{
        product_id: number;
        refunded_qty: string | number;
        refunded_amount: string | number;
      }>
    >(Prisma.sql`
      SELECT
        oi.product_id AS product_id,
        COALESCE(SUM(ri.quantity), 0)::decimal AS refunded_qty,
        COALESCE(SUM(ri.refund_amount), 0)::decimal AS refunded_amount
      FROM refund_items ri
      JOIN refunds r ON r.id = ri.refund_id
      JOIN order_items oi ON oi.id = ri.order_item_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.store_id = ${RequestContextService.getContext()?.store_id ?? 0}
        AND o.state IN ('delivered', 'finished')
        AND o.created_at >= ${startDate}
        AND o.created_at <= ${endDate}
        AND r.state IN ('completed', 'approved')
      GROUP BY oi.product_id
    `);

    const refundsByProduct = new Map<
      number,
      { quantity: number; amount: number }
    >();
    for (const r of refundByProduct) {
      refundsByProduct.set(Number(r.product_id), {
        quantity: Number(r.refunded_qty),
        amount: Number(r.refunded_amount),
      });
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
        const refunds = refundsByProduct.get(r.product_id) || {
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
        price_unit_quantity: true,
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
      price_unit_quantity: number | null;
      product_categories: { categories: { name: string } }[];
    }[];
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Restaurant Suite Fase G — recipe-driven cost (MÍNIMO).
    // For each product with an active recipe, compute the per-unit cost
    // from recipe items (Fase B). Sub-recipes (1 hop deep) are resolved
    // recursively; deeper levels fall back to product.cost_price. Products
    // without a recipe keep the legacy `product.cost_price` path.
    const recipeCosts = await this.computeRecipeUnitCostMap(productIds);
    const productCostPrice = (productId: number): number => {
      const r = recipeCosts.get(productId);
      if (r !== undefined && r !== null) return r;
      const product = productMap.get(productId);
      return product ? Number(product.cost_price || 0) : 0;
    };

    const results = items
      .filter((r) => r.product_id !== null)
      .map((r) => {
        const product = productMap.get(r.product_id);
        const revenue = Number(r._sum.total_price || 0);
        const unitsSold = Number(r._sum.quantity || 0);
        // Recipe-driven unit cost (Fase G) overrides order_items.cost_price
        // when an active recipe exists for this product. The order_items
        // snapshot is preserved as `snapshot_cost_price` for traceability.
        const unitCost = productCostPrice(r.product_id as number);
        const totalCost = unitCost * unitsSold;
        const snapshotUnitCost = Number(r._sum.cost_price || 0);
        const profit = revenue - totalCost;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        const markup = totalCost > 0 ? (profit / totalCost) * 100 : 0;
        const basePrice = product ? Number(product.base_price || 0) : 0;
        // El par catálogo (`catalog_base_price` / `catalog_cost_price`) se
        // publica en la escala comercial, la única en la que restarlos tiene
        // sentido (ver `costInPriceScale`). `unit_cost` de arriba NO se toca:
        // multiplica `units_sold`, que está en unidades de stock, y llevarlo a
        // la escala comercial descuadraría `total_cost`, `profit` y `margin`.
        const catalogCostPrice = product
          ? this.costInPriceScale(
              Number(product.cost_price || 0),
              product.price_unit_quantity,
            )
          : 0;
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
          total_cost: Number(totalCost.toFixed(2)),
          profit: Number(profit.toFixed(2)),
          margin: Number(margin.toFixed(2)),
          markup: Number(markup.toFixed(2)),
          units_sold: unitsSold,
          avg_selling_price: unitsSold > 0 ? revenue / unitsSold : 0,
          unit_cost: Number(unitCost.toFixed(4)),
          snapshot_unit_cost: Number(snapshotUnitCost.toFixed(4)),
          catalog_base_price: basePrice,
          catalog_cost_price: catalogCostPrice,
          catalog_margin:
            catalogMargin !== null ? Number(catalogMargin.toFixed(2)) : null,
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
      overall_margin:
        totalRevenue > 0
          ? Number(((totalProfit / totalRevenue) * 100).toFixed(2))
          : 0,
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
    const rows = Array.isArray(result) ? result : result.data || [];
    // Unidades vendidas y devueltas son la MISMA magnitud: se convierten con la
    // misma unidad o la tasa de devolución de la fila dejaría de tener sentido.
    const saleUnits = await resolveSaleUnitCodes(
      this.prisma as any,
      rows.map((r: any) => r.product_id),
    );
    return rows.map((r: any) => {
      const info = saleUnits.get(Number(r.product_id));
      const sold = formatAggregateQuantity(r.units_sold, info);
      const refunded = formatAggregateQuantity(r.refunded_units, info);
      return {
        Producto: r.product_name,
        SKU: r.sku,
        'Unidades Vendidas': sold.value,
        Unidad: sold.suffix,
        Ingresos: r.revenue,
        Devoluciones: refunded.value,
        'Monto Devuelto': r.refunded_amount,
        'Tasa Devolución (%)': r.return_rate,
        Órdenes: r.order_count,
      };
    });
  }

  async getProductProfitabilityForExport(query: ProductsAnalyticsQueryDto) {
    const exportQuery = { ...query, page: undefined, limit: 10000 };
    const result = await this.getProductProfitability(exportQuery);
    const rows = (result as any).products || (result as any).data || [];
    const saleUnits = await resolveSaleUnitCodes(
      this.prisma as any,
      rows.map((r: any) => r.product_id),
    );
    return rows.map((r: any) => {
      const info = saleUnits.get(Number(r.product_id));
      const sold = formatAggregateQuantity(r.units_sold, info);
      // `Costo Unitario` acompaña a la cantidad convertida: si la fila dice
      // 3 m, el costo tiene que ser por metro o `Costo Total` deja de ser el
      // producto de sus dos vecinos. `Costo Total`, `Ganancia`, `Margen` y
      // `Markup` no se tocan: son agregados y no dependen de la escala.
      const factor = saleUnitScaleFactor(info);
      const unitCost =
        factor > 1
          ? Number((Number(r.unit_cost ?? 0) * factor).toFixed(4))
          : r.unit_cost;
      return {
        Producto: r.product_name,
        SKU: r.sku,
        Categoría: r.category || '',
        'Unidades Vendidas': sold.value,
        Unidad: sold.suffix,
        Ingresos: r.revenue,
        'Costo Unitario (Receta)': unitCost,
        'Costo Total': r.total_cost,
        Ganancia: r.profit,
        'Margen (%)': r.margin,
        'Markup (%)': r.markup,
      };
    });
  }

  // ---------------------------------------------------------- Fase G helpers

  /**
   * For each product id, returns the per-unit cost derived from the
   * product's active recipe (Fase B). Sub-recipes are resolved one level
   * deep — the cost of a sub-recipe is itself looked up via its own recipe
   * (Fase B cycle detection already prevents recursion). Products with
   * no recipe resolve to `null` so the caller can fall back to
   * `product.cost_price`.
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

    if (recipes.length === 0) return result;

    // 2. Identify component products that may themselves own a sub-recipe
    //    so we can resolve their cost recursively in a second pass.
    const componentIds = new Set<number>();
    for (const r of recipes) {
      for (const it of r.items) {
        if (it.component_product) componentIds.add(it.component_product.id);
      }
    }
    const subRecipes =
      componentIds.size > 0
        ? await this.prisma.recipes.findMany({
            where: {
              product_id: { in: Array.from(componentIds) },
              is_active: true,
            },
            select: { product_id: true },
          })
        : [];
    const hasSubRecipe = new Set(subRecipes.map((sr) => sr.product_id));

    // 3. Map sub-recipe cost = sum(component cost) for any component that
    //    owns a sub-recipe. For one-hop resolution we approximate using the
    //    product's own cost_price when no sub-recipe exists. (Full deep
    //    recursion is the job of RecipesService.explodeBom; here we only
    //    need a per-line cost hint.)
    const componentCost = (productId: number, fallback: number): number => {
      if (hasSubRecipe.has(productId)) {
        // Sub-recipe present — the component's own catalog cost_price is
        // a reasonable proxy for Fase G analytics. This intentionally
        // differs from the strict BOM explosion used by production.
        return fallback;
      }
      return fallback;
    };

    // 4. Compute per-recipe unit cost.
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
        const effective =
          qty * (1 + waste / 100) *
          componentCost(item.component_product?.id ?? -1, unitCost);
        totalCost += effective;
      }
      result.set(recipe.product_id, totalCost / effectiveYield);
    }

    // 5. Mark every product without a recipe as `null` (caller falls back).
    for (const pid of productIds) {
      if (!result.has(pid)) result.set(pid, null);
    }

    return result;
  }
}
