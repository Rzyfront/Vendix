import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { mergeStoreSettingsWithDefaults } from '../../../settings/defaults/default-store-settings';
import type { StoreSettings } from '../../../settings/interfaces/store-settings.interface';
import { resolveStockLevelLowStockThreshold } from '../helpers/low-stock-threshold.helper';

/**
 * Servicio de SÓLO LECTURA sobre inventario, consumido por las herramientas de
 * IA (`createInventoryTools`). No escribe stock, y eso es deliberado.
 *
 * ── Qué se eliminó y por qué ─────────────────────────────────────────────────
 * Esta clase albergaba un MOTOR DE STOCK PARALELO completo, con cero llamadas:
 *
 *   · `reserveStock` / `releaseStock` — mutaban `quantity_reserved` y
 *     `quantity_available` con un `stock_levels.update` directo. No refrescaban
 *     el espejo denormalizado (`products.stock_quantity`), no dejaban fila en
 *     `inventory_movements` y no pasaban por el piso de validación. Cada flujo
 *     real (checkout, POS, órdenes, layaway, traslados, remisiones, order-flow)
 *     llama a `StockLevelManager.reserveStock`; estos dos no los llamaba nadie.
 *   · `updateStockAndCreateMovement` — misma historia, ya retirado.
 *   · `calculateWeightedAverageCost` — el CPP es de `CostingService`, que además
 *     resuelve el método de costeo y crea la capa.
 *   · `checkStockAvailability` — sin llamadas; la disponibilidad la responde
 *     `StockValidatorService`.
 *   · `getInventoryValuation` — sin llamadas; la valorización la sirve
 *     `InventoryAnalyticsService`, que ya trae las correcciones de alcance.
 *   · `cleanupExpiredReservations` — sin llamadas; el cron
 *     `payment-timeout-cleanup.job` reimplementó el barrido y SÍ sincroniza el
 *     espejo.
 *
 * El riesgo de un motor paralelo sin llamadas no es que corra: es que el próximo
 * que necesite reservar stock encuentre DOS métodos con el mismo nombre y elija
 * el que no cuadra nada. Borrarlo deja un solo camino visible.
 *
 * Regla para quien agregue algo aquí: si el método escribe `stock_levels`, no va
 * en esta clase — va en `StockLevelManager`.
 */
@Injectable()
export class InventoryIntegrationService {
  constructor(private prisma: StorePrismaService) {}

  /**
   * Validate consolidated stock availability across ALL locations
   * Returns whether the required quantity can be fulfilled from total stock
   */
  async validateConsolidatedStockAvailability(
    organizationId: number,
    productId: number,
    requiredQuantity: number,
    productVariantId?: number,
  ): Promise<{
    isAvailable: boolean;
    totalAvailable: number;
    locations: Array<{
      locationId: number;
      locationName: string;
      available: number;
      type: string;
    }>;
    suggestedAllocation?: Array<{
      locationId: number;
      quantity: number;
    }>;
  }> {
    // Get ALL stock levels for this product across all locations
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        product_variant_id: productVariantId ?? null,
        inventory_locations: {
          organization_id: organizationId,
        },
      },
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: {
        quantity_available: 'desc', // Prioritize locations with more stock
      },
    });

    const totalAvailable = stockLevels.reduce(
      (sum, stock) => sum + stock.quantity_available,
      0,
    );

    const locations = stockLevels.map((stock) => ({
      locationId: stock.location_id,
      locationName: stock.inventory_locations.name,
      available: stock.quantity_available,
      type: stock.inventory_locations.type,
    }));

    // Generate suggested allocation if stock is available
    let suggestedAllocation:
      | Array<{ locationId: number; quantity: number }>
      | undefined;

    if (totalAvailable >= requiredQuantity) {
      suggestedAllocation = this.generateOptimalAllocation(
        stockLevels,
        requiredQuantity,
      );
    }

    return {
      isAvailable: totalAvailable >= requiredQuantity,
      totalAvailable,
      locations,
      suggestedAllocation,
    };
  }

  /**
   * Generate optimal stock allocation across locations to fulfill an order
   * Prioritizes locations with more stock to minimize number of locations used
   */
  private generateOptimalAllocation(
    stockLevels: Array<{ location_id: number; quantity_available: number }>,
    requiredQuantity: number,
  ): Array<{ locationId: number; quantity: number }> {
    const allocation: Array<{ locationId: number; quantity: number }> = [];
    let remainingQuantity = requiredQuantity;

    for (const stockLevel of stockLevels) {
      if (remainingQuantity <= 0) break;

      if (stockLevel.quantity_available > 0) {
        const allocatedQuantity = Math.min(
          remainingQuantity,
          stockLevel.quantity_available,
        );

        allocation.push({
          locationId: stockLevel.location_id,
          quantity: allocatedQuantity,
        });

        remainingQuantity -= allocatedQuantity;
      }
    }

    return allocation;
  }

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts(
    organizationId: number,
    locationId?: number,
  ): Promise<
    Array<{
      productId: number;
      productName: string;
      locationId: number;
      locationName: string;
      currentStock: number;
      reorderPoint: number;
    }>
  > {
    const settings = await this.loadMergedSettings();

    const where: any = {
      inventory_locations: {
        organization_id: organizationId,
      },
    };

    if (locationId) {
      where.location_id = locationId;
    }

    const stockItems = await this.prisma.stock_levels.findMany({
      where,
      include: {
        products: {
          select: {
            id: true,
            name: true,
          },
        },
        inventory_locations: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Filter in memory since Prisma doesn't support field-to-field comparison
    const lowStockItems = stockItems.filter((item) => {
      const threshold = resolveStockLevelLowStockThreshold(settings, item);
      return Number(item.quantity_available ?? 0) <= threshold;
    });

    return lowStockItems.map((item) => ({
      productId: item.product_id,
      productName: item.products.name,
      locationId: item.location_id,
      locationName: item.inventory_locations.name,
      currentStock: item.quantity_available,
      reorderPoint: resolveStockLevelLowStockThreshold(settings, item),
    }));
  }

  private async loadMergedSettings(): Promise<StoreSettings> {
    const row = await this.prisma.store_settings.findFirst({
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings);
  }

}
