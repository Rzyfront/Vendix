import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InventoryAnalyticsQueryDto } from '../dto/analytics-query.dto';

@Injectable()
export class InventoryAnalyticsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getInventorySummary(query: InventoryAnalyticsQueryDto) {
    // Get all products with stock info (store scoping is automatic)
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
      const reorderPoint = Number(product.reorder_point || product.min_stock_level || 5);

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
      low_stock_percentage: totalSkuCount > 0 ? (lowStockCount / totalSkuCount) * 100 : 0,
      out_of_stock_percentage: totalSkuCount > 0 ? (outOfStockCount / totalSkuCount) * 100 : 0,
      total_quantity_on_hand: totalQuantity,
    };
  }

  async getStockLevels(query: InventoryAnalyticsQueryDto) {
    const products = await this.prisma.products.findMany({
      where: {
        state: 'active',
        track_inventory: true,
        ...(query.category_id && {
          product_categories: {
            some: {
              category_id: query.category_id,
            },
          },
        }),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        image_url: true,
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        max_stock_level: true,
        reorder_point: true,
      },
      take: query.limit || 100,
      orderBy: {
        stock_quantity: 'asc',
      },
    });

    const results = products.map((product) => {
      const qty = Number(product.stock_quantity || 0);
      const cost = Number(product.cost_price || 0);
      const reorderPoint = Number(product.reorder_point || product.min_stock_level || 5);
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
        image_url: product.image_url,
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
      return results.filter((r) => r.status === query.status);
    }

    return results;
  }

  async getLowStockAlerts(query: InventoryAnalyticsQueryDto) {
    const products = await this.prisma.products.findMany({
      where: {
        state: 'active',
        track_inventory: true,
        OR: [
          { stock_quantity: 0 },
          {
            AND: [
              { reorder_point: { not: null } },
              // Use raw query or calculate in application
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        sku: true,
        image_url: true,
        stock_quantity: true,
        cost_price: true,
        min_stock_level: true,
        reorder_point: true,
      },
      orderBy: {
        stock_quantity: 'asc',
      },
      take: query.limit || 100,
    });

    return products
      .filter((p) => {
        const qty = Number(p.stock_quantity || 0);
        const reorderPoint = Number(p.reorder_point || p.min_stock_level || 5);
        return qty <= reorderPoint;
      })
      .map((product) => {
        const qty = Number(product.stock_quantity || 0);
        const reorderPoint = Number(product.reorder_point || product.min_stock_level || 5);

        return {
          product_id: product.id,
          product_name: product.name,
          sku: product.sku,
          image_url: product.image_url,
          quantity_available: qty,
          reorder_point: reorderPoint,
          days_of_stock: null, // TODO: Calculate from sales velocity
          status: qty === 0 ? 'out_of_stock' : 'low_stock',
        };
      });
  }

  async getStockMovements(query: InventoryAnalyticsQueryDto) {
    const { startDate, endDate } = this.parseDateRange(query);

    // inventory_movements is scoped by products relation
    const movements = await this.prisma.inventory_movements.findMany({
      where: {
        created_at: {
          gte: startDate,
          lte: endDate,
        },
        ...(query.movement_type && { movement_type: query.movement_type as any }),
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
    // Get stock levels grouped by location
    const stockLevels = await this.prisma.stock_levels.findMany({
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Aggregate by location
    const locationMap = new Map<number, { name: string; quantity: number; value: number }>();
    let totalValue = 0;

    for (const sl of stockLevels) {
      const locationId = sl.inventory_locations?.id || 0;
      const locationName = sl.inventory_locations?.name || 'Sin ubicación';
      const qty = Number(sl.quantity_on_hand || 0);
      const cost = Number(sl.cost_per_unit || 0);
      const value = qty * cost;
      totalValue += value;

      const existing = locationMap.get(locationId) || { name: locationName, quantity: 0, value: 0 };
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
        percentage_of_total: totalValue > 0 ? (data.value / totalValue) * 100 : 0,
      }))
      .sort((a, b) => b.total_value - a.total_value);
  }

  private parseDateRange(query: InventoryAnalyticsQueryDto): { startDate: Date; endDate: Date } {
    if (query.date_from && query.date_to) {
      return {
        startDate: new Date(query.date_from),
        endDate: new Date(query.date_to),
      };
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: monthStart, endDate: now };
  }
}
