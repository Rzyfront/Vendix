import { Injectable } from '@nestjs/common';
import { purchase_order_status_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InventoryAnalyticsService } from '../../analytics/services/inventory-analytics.service';

export interface InventoryStatsResult {
  total_products: number;
  total_stock_value: number;
  low_stock_items: number;
  out_of_stock_items: number;
  pending_orders: number;
  incoming_stock: number;
}

/**
 * Resumen del módulo Inventario (dashboard).
 *
 * Los 4 KPIs de stock se derivan de `InventoryAnalyticsService.getInventorySummary`
 * a propósito: es la definición única del universo scope-coherente de la tienda
 * (ver DATA-SCOPE-1). Duplicar el conteo aquí crearía una segunda definición de
 * "productos con stock" que diverge del Resumen de Inventario de analítica.
 * `pending_orders`/`incoming_stock` siguen la misma noción de "pendiente" que
 * `PurchaseOrdersService.findPending` (órdenes en estado `approved`).
 */
@Injectable()
export class InventoryStatsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryAnalytics: InventoryAnalyticsService,
  ) {}

  async getStats(): Promise<InventoryStatsResult> {
    const summary = await this.inventoryAnalytics.getInventorySummary({});

    const pending = await this.prisma.purchase_orders.aggregate({
      where: { status: purchase_order_status_enum.approved },
      _count: { _all: true },
      _sum: { total_amount: true },
    });

    return {
      total_products: summary.total_sku_count,
      total_stock_value: summary.total_stock_value,
      low_stock_items: summary.low_stock_count,
      out_of_stock_items: summary.out_of_stock_count,
      pending_orders: pending._count._all,
      incoming_stock: Number(pending._sum.total_amount ?? 0),
    };
  }
}
