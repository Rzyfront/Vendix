import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  InventoryAnalyticsQueryDto,
  Granularity,
} from '../dto/analytics-query.dto';
import { fillTimeSeries } from '../utils/fill-time-series.util';
import { formatPeriodFromDate, parseDateRange, getDateTruncInterval } from '../utils/date.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Injectable()
export class InventoryAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getInventorySummary(query: InventoryAnalyticsQueryDto) {
    // Get all products with stock info (store scoping is automatic)
    // track_inventory is Boolean @default(false), not nullable
    const products = await this.prisma.products.findMany({
      where: {
        state: 'active',
        track_inventory: true,
      },
      select: {
        id: true,
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        reorder_point: true,
      },
    });

    let totalSkuCount = 0;
    let totalStockValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let totalQuantity = 0;

    for (const product of products) {
      totalSkuCount++;
      const qty = Number(product.stock_quantity || 0);
      const cost = Number(product.cost_price || 0);
      const reorderPoint = Number(
        product.reorder_point || product.min_stock_level || 5,
      );

      totalQuantity += qty;
      totalStockValue += qty * cost;

      if (qty === 0) {
        outOfStockCount++;
      } else if (qty <= reorderPoint) {
        lowStockCount++;
      }
    }

    return {
      total_sku_count: totalSkuCount,
      total_stock_value: totalStockValue,
      low_stock_count: lowStockCount,
      out_of_stock_count: outOfStockCount,
      low_stock_percentage:
        totalSkuCount > 0 ? (lowStockCount / totalSkuCount) * 100 : 0,
      out_of_stock_percentage:
        totalSkuCount > 0 ? (outOfStockCount / totalSkuCount) * 100 : 0,
      total_quantity_on_hand: totalQuantity,
    };
  }

  async getStockLevels(query: InventoryAnalyticsQueryDto) {
    const productWhere: any = {
      state: 'active',
      track_inventory: true,
      ...(query.category_id && {
        product_categories: {
          some: {
            category_id: query.category_id,
          },
        },
      }),
    };

    const products = await this.prisma.products.findMany({
      where: productWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        max_stock_level: true,
        reorder_point: true,
      },
      orderBy: {
        stock_quantity: 'asc',
      },
    });

    let results = products.map((product) => {
      const qty = Number(product.stock_quantity || 0);
      const cost = Number(product.cost_price || 0);
      const reorderPoint = Number(
        product.reorder_point || product.min_stock_level || 5,
      );
      const maxStock = Number(product.max_stock_level || 1000);

      let status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'overstock';
      if (qty === 0) {
        status = 'out_of_stock';
      } else if (qty <= reorderPoint) {
        status = 'low_stock';
      } else if (qty > maxStock) {
        status = 'overstock';
      } else {
        status = 'in_stock';
      }

      return {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku,
        image_url: (product as any).product_images?.[0]?.image_url || null,
        quantity_on_hand: qty,
        quantity_reserved: 0, // TODO: Calculate from stock_reservations
        quantity_available: qty,
        reorder_point: reorderPoint,
        cost_per_unit: cost,
        total_value: qty * cost,
        status,
      };
    });

    // Filter by status if specified
    if (query.status) {
      results = results.filter((r) => r.status === query.status);
    }

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = results.length;
      const paginatedData = results.slice((page - 1) * limit, page * limit);

      return {
        data: paginatedData,
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

    // Non-paginated: respect original limit behavior
    return results.slice(0, query.limit || 100);
  }

  async getLowStockAlerts(query: InventoryAnalyticsQueryDto) {
    // track_inventory is Boolean @default(false), not nullable
    const products = await this.prisma.products.findMany({
      where: {
        state: 'active',
        track_inventory: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        product_images: {
          select: { image_url: true },
          take: 1,
        },
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        reorder_point: true,
      },
      orderBy: {
        stock_quantity: 'asc',
      },
    });

    const results = products
      .filter((p) => {
        const qty = Number(p.stock_quantity || 0);
        const reorderPoint = Number(p.reorder_point || p.min_stock_level || 5);
        return qty <= reorderPoint;
      })
      .map((product) => {
        const qty = Number(product.stock_quantity || 0);
        const reorderPoint = Number(
          product.reorder_point || product.min_stock_level || 5,
        );

        return {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          image_url: (product as any).product_images?.[0]?.image_url || null,
          quantity_available: qty,
          reorder_point: reorderPoint,
          days_of_stock: null, // TODO: Calculate from sales velocity
          status: qty === 0 ? 'out_of_stock' : 'low_stock',
        };
      });

    const isPaginated = query.page !== undefined && query.limit !== undefined;
    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = results.length;
      const paginatedData = results.slice((page - 1) * limit, page * limit);

      return {
        data: paginatedData,
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

    // Non-paginated: respect original limit behavior
    return results.slice(0, query.limit || 100);
  }

  async getStockMovements(query: InventoryAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);

    const where: any = {
      created_at: {
        gte: startDate,
        lte: endDate,
      },
      ...(query.movement_type && {
        movement_type: query.movement_type as any,
      }),
    };

    const isPaginated = query.page !== undefined && query.limit !== undefined;

    if (isPaginated) {
      const page = query.page!;
      const limit = query.limit!;
      const totalCount = await this.prisma.inventory_movements.count({ where });

      const movements = await this.prisma.inventory_movements.findMany({
        where,
        include: {
          products: {
            select: {
              name: true,
              sku: true,
            },
          },
          from_location: {
            select: {
              name: true,
            },
          },
          to_location: {
            select: {
              name: true,
            },
          },
          users: {
            select: {
              username: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        skip: (page - 1) * limit,
        take: limit,
      });

      const data = movements.map((m) => ({
        id: m.id,
        date: m.created_at.toISOString(),
        product_id: m.product_id,
        product_name: m.products?.name || 'Unknown',
        sku: m.products?.sku || '',
        movement_type: m.movement_type,
        quantity: Number(m.quantity || 0),
        from_location: m.from_location?.name || null,
        to_location: m.to_location?.name || null,
        reason: m.reason,
        user_name: m.users?.username || null,
        reference_id: m.source_order_id?.toString() || null,
      }));

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
    const movements = await this.prisma.inventory_movements.findMany({
      where,
      include: {
        products: {
          select: {
            name: true,
            sku: true,
          },
        },
        from_location: {
          select: {
            name: true,
          },
        },
        to_location: {
          select: {
            name: true,
          },
        },
        users: {
          select: {
            username: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: query.limit || 100,
    });

    return movements.map((m) => ({
      id: m.id,
      date: m.created_at.toISOString(),
      product_id: m.product_id,
      product_name: m.products?.name || 'Unknown',
      sku: m.products?.sku || '',
      movement_type: m.movement_type,
      quantity: Number(m.quantity || 0),
      from_location: m.from_location?.name || null,
      to_location: m.to_location?.name || null,
      reason: m.reason,
      user_name: m.users?.username || null,
      reference_id: m.source_order_id?.toString() || null,
    }));
  }

  async getInventoryValuation(query: InventoryAnalyticsQueryDto) {
    // Get stock levels grouped by location, including product cost_price as fallback
    const stockLevels = await this.prisma.stock_levels.findMany({
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
          },
        },
        products: {
          select: {
            cost_price: true,
          },
        },
      },
    });

    // Aggregate by location
    const locationMap = new Map<
      number,
      { name: string; quantity: number; value: number }
    >();
    let totalValue = 0;

    for (const sl of stockLevels) {
      const locationId = sl.inventory_locations?.id || 0;
      const locationName = sl.inventory_locations?.name || 'Sin ubicación';
      const qty = Number(sl.quantity_on_hand || 0);
      const cost =
        Number(sl.cost_per_unit || 0) || Number(sl.products?.cost_price || 0);
      const value = qty * cost;
      totalValue += value;

      const existing = locationMap.get(locationId) || {
        name: locationName,
        quantity: 0,
        value: 0,
      };
      existing.quantity += qty;
      existing.value += value;
      locationMap.set(locationId, existing);
    }

    return Array.from(locationMap.entries())
      .map(([id, data]) => ({
        location_id: id,
        location_name: data.name,
        total_quantity: data.quantity,
        total_value: data.value,
        average_cost: data.quantity > 0 ? data.value / data.quantity : 0,
        percentage_of_total:
          totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.total_value - a.total_value);
  }

  async getMovementSummary(query: InventoryAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    // withoutScope() needed: $queryRaw is not available on the scoped client.
    // storeId is validated above and used in the WHERE clause.
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        movement_type: string;
        count: bigint;
        total_quantity: any;
      }>
    >`
      SELECT
        im.movement_type,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(ABS(im.quantity)), 0) AS total_quantity
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      WHERE p.store_id = ${storeId}
        AND im.created_at >= ${startDate}
        AND im.created_at <= ${endDate}
        ${query.location_id ? Prisma.sql`AND (im.from_location_id = ${query.location_id} OR im.to_location_id = ${query.location_id})` : Prisma.empty}
      GROUP BY im.movement_type
      ORDER BY count DESC
    `;

    const totalCount = results.reduce((sum, r) => sum + Number(r.count), 0);

    return results.map((r) => ({
      movement_type: r.movement_type,
      count: Number(r.count),
      total_quantity: Number(r.total_quantity),
      percentage: totalCount > 0 ? (Number(r.count) / totalCount) * 100 : 0,
    }));
  }

  async getMovementTrends(query: InventoryAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);
    const granularity = query.granularity || Granularity.DAY;
    const context = RequestContextService.getContext();

    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const storeId = context.store_id;

    const truncSql = Prisma.raw(`'${getDateTruncInterval(granularity)}'`);

    // withoutScope() needed: $queryRaw is not available on the scoped client.
    // storeId is validated above and used in the WHERE clause.
    const results = await (this.prisma.withoutScope() as any).$queryRaw<
      Array<{
        period: Date;
        stock_in: any;
        stock_out: any;
        adjustments: any;
        transfers: any;
        total: any;
      }>
    >`
      SELECT
        DATE_TRUNC(${truncSql}, im.created_at) AS period,
        COALESCE(SUM(CASE WHEN im.movement_type IN ('stock_in', 'return') THEN ABS(im.quantity) ELSE 0 END), 0) AS stock_in,
        COALESCE(SUM(CASE WHEN im.movement_type IN ('stock_out', 'sale', 'damage', 'expiration') THEN ABS(im.quantity) ELSE 0 END), 0) AS stock_out,
        COALESCE(SUM(CASE WHEN im.movement_type = 'adjustment' THEN ABS(im.quantity) ELSE 0 END), 0) AS adjustments,
        COALESCE(SUM(CASE WHEN im.movement_type = 'transfer' THEN ABS(im.quantity) ELSE 0 END), 0) AS transfers,
        COALESCE(SUM(ABS(im.quantity)), 0) AS total
      FROM inventory_movements im
      INNER JOIN products p ON p.id = im.product_id
      WHERE p.store_id = ${storeId}
        AND im.created_at >= ${startDate}
        AND im.created_at <= ${endDate}
        ${query.location_id ? Prisma.sql`AND (im.from_location_id = ${query.location_id} OR im.to_location_id = ${query.location_id})` : Prisma.empty}
      GROUP BY DATE_TRUNC(${truncSql}, im.created_at)
      ORDER BY period ASC
    `;

    const mapped = results.map((r) => ({
      period: formatPeriodFromDate(new Date(r.period), granularity),
      stock_in: Number(r.stock_in),
      stock_out: Number(r.stock_out),
      adjustments: Number(r.adjustments),
      transfers: Number(r.transfers),
      total: Number(r.total),
    }));

    return fillTimeSeries(
      mapped,
      startDate,
      endDate,
      granularity,
      { stock_in: 0, stock_out: 0, adjustments: 0, transfers: 0, total: 0 },
      formatPeriodFromDate,
    );
  }

  async getMovementsForExport(query: InventoryAnalyticsQueryDto) {
    const { startDate, endDate } = parseDateRange(query);

    const movements = await this.prisma.inventory_movements.findMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
        ...(query.movement_type && {
          movement_type: query.movement_type as any,
        }),
      },
      include: {
        products: {
          select: {
            name: true,
            sku: true,
          },
        },
        from_location: {
          select: {
            name: true,
          },
        },
        to_location: {
          select: {
            name: true,
          },
        },
        users: {
          select: {
            username: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 10000,
    });

    return movements.map((m) => ({
      Fecha: m.created_at?.toISOString().split('T')[0] || '',
      Producto: m.products?.name || 'Desconocido',
      SKU: m.products?.sku || '',
      Tipo: m.movement_type,
      Cantidad: Number(m.quantity || 0),
      Origen: m.from_location?.name || '-',
      Destino: m.to_location?.name || '-',
      Usuario: m.users?.username || '-',
      Razón: m.reason || '-',
    }));
  }

}
