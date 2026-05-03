import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';

@Injectable()
export class InventoryIntegrationService {
  constructor(private prisma: StorePrismaService) {}

  /**
   * Reserve stock for a specific order
   */
  async reserveStock(
    organizationId: number,
    productId: number,
    locationId: number,
    quantity: number,
    orderType: string,
    orderId: number,
    productVariantId?: number,
  ) {
    // Skip reservation for products that don't track inventory
    const product = await this.prisma.products.findUnique({
      where: { id: productId },
      select: { track_inventory: true },
    });
    if (!product?.track_inventory) return null;

    return this.prisma.$transaction(async (tx) => {
      // Check stock availability
      const stockLevel = await tx.stock_levels.findUnique({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
      });

      if (!stockLevel || stockLevel.quantity_available < quantity) {
        throw new BadRequestException(
          `Insufficient stock available. Required: ${quantity}, Available: ${stockLevel?.quantity_available || 0}`,
        );
      }

      // Update stock levels
      const updatedStock = await tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_reserved: stockLevel.quantity_reserved + quantity,
          quantity_available: stockLevel.quantity_available - quantity,
          last_updated: new Date(),
        },
      });

      // Create stock reservation record
      await tx.stock_reservations.create({
        data: {
          organization_id: organizationId,
          product_id: productId,
          product_variant_id: productVariantId,
          location_id: locationId,
          quantity,
          reserved_for_type: orderType,
          reserved_for_id: orderId,
          status: 'active',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          created_at: new Date(),
        },
      });

      return updatedStock;
    });
  }

  /**
   * Release reserved stock
   */
  async releaseStock(
    organizationId: number,
    productId: number,
    locationId: number,
    quantity: number,
    orderType: string,
    orderId: number,
    productVariantId?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Find and update reservation
      const reservation = await tx.stock_reservations.findFirst({
        where: {
          organization_id: organizationId,
          product_id: productId,
          product_variant_id: productVariantId,
          location_id: locationId,
          reserved_for_type: orderType,
          reserved_for_id: orderId,
          status: 'active',
        },
      });

      if (reservation) {
        await tx.stock_reservations.update({
          where: { id: reservation.id },
          data: {
            status: 'consumed',
            updated_at: new Date(),
          },
        });
      }

      // Update stock levels
      const stockLevel = await tx.stock_levels.findUnique({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
      });

      if (stockLevel) {
        const releaseQuantity = Math.min(
          quantity,
          stockLevel.quantity_reserved,
        );
        return tx.stock_levels.update({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: productId,
              product_variant_id: productVariantId || null,
              location_id: locationId,
            },
          },
          data: {
            quantity_reserved: Math.max(
              0,
              stockLevel.quantity_reserved - releaseQuantity,
            ),
            quantity_available: stockLevel.quantity_available + releaseQuantity,
            last_updated: new Date(),
          },
        });
      }
    });
  }

  /**
   * Update stock levels and create movement
   */
  async updateStockAndCreateMovement(
    organizationId: number,
    productId: number,
    locationId: number,
    quantityChange: number,
    movementType: string,
    sourceOrderType?: string,
    sourceOrderId?: number,
    reason?: string,
    productVariantId?: number,
    fromLocationId?: number,
    toLocationId?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Create inventory movement
      await tx.inventory_movements.create({
        data: {
          organization_id: organizationId,
          product_id: productId,
          product_variant_id: productVariantId,
          from_location_id: fromLocationId,
          to_location_id: toLocationId || locationId,
          quantity: Math.abs(quantityChange),
          movement_type: movementType,
          source_order_type: sourceOrderType,
          source_order_id: sourceOrderId,
          reason: reason || 'Stock update',
          created_at: new Date(),
        },
      });

      // Update stock levels
      const targetLocationId = toLocationId || locationId;
      const existingStock = await tx.stock_levels.findUnique({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: targetLocationId,
          },
        },
      });

      if (existingStock) {
        const newQuantityOnHand =
          existingStock.quantity_on_hand + quantityChange;
        const newQuantityAvailable =
          existingStock.quantity_available + quantityChange;

        return tx.stock_levels.update({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: productId,
              product_variant_id: productVariantId || null,
              location_id: targetLocationId,
            },
          },
          data: {
            quantity_on_hand: Math.max(0, newQuantityOnHand),
            quantity_available: Math.max(0, newQuantityAvailable),
            last_updated: new Date(),
          },
        });
      } else {
        // Create new stock level if it doesn't exist
        return tx.stock_levels.create({
          data: {
            organization_id: organizationId,
            product_id: productId,
            product_variant_id: productVariantId,
            location_id: targetLocationId,
            quantity_on_hand: Math.max(0, quantityChange),
            quantity_reserved: 0,
            quantity_available: Math.max(0, quantityChange),
            last_updated: new Date(),
          },
        });
      }
    });
  }

  /**
   * Calculate weighted average cost for a product
   */
  async calculateWeightedAverageCost(
    organizationId: number,
    productId: number,
    locationId?: number,
    productVariantId?: number,
  ): Promise<number> {
    const stockWhere: any = {
      product_id: productId,
      product_variant_id: productVariantId ?? null,
      quantity_on_hand: { gt: 0 },
      inventory_locations: { organization_id: organizationId },
    };

    if (locationId) stockWhere.location_id = locationId;

    const stockLevels = await this.prisma.stock_levels.findMany({
      where: stockWhere,
      select: { quantity_on_hand: true, cost_per_unit: true },
    });

    const stockValue = stockLevels.reduce(
      (sum, stock) =>
        sum + Number(stock.quantity_on_hand || 0) * Number(stock.cost_per_unit || 0),
      0,
    );
    const stockQty = stockLevels.reduce(
      (sum, stock) => sum + Number(stock.quantity_on_hand || 0),
      0,
    );

    if (stockQty > 0 && stockValue > 0) {
      return stockValue / stockQty;
    }

    const layerWhere: any = {
      organization_id: organizationId,
      product_id: productId,
      product_variant_id: productVariantId ?? null,
      quantity_remaining: { gt: 0 },
    };

    if (locationId) layerWhere.location_id = locationId;

    const layers = await this.prisma.inventory_cost_layers.findMany({
      where: layerWhere,
      select: { quantity_remaining: true, unit_cost: true },
    });

    const layerValue = layers.reduce(
      (sum, layer) =>
        sum + Number(layer.quantity_remaining || 0) * Number(layer.unit_cost || 0),
      0,
    );
    const layerQty = layers.reduce(
      (sum, layer) => sum + Number(layer.quantity_remaining || 0),
      0,
    );

    return layerQty > 0 ? layerValue / layerQty : 0;
  }

  /**
   * Check stock availability across multiple locations
   * Returns individual location availability
   */
  async checkStockAvailability(
    organizationId: number,
    productId: number,
    requiredQuantity: number,
    productVariantId?: number,
  ): Promise<
    Array<{ locationId: number; available: number; locationName: string }>
  > {
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        product_variant_id: productVariantId ?? null,
        quantity_available: { gt: 0 },
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
    });

    return stockLevels.map((stock) => ({
      locationId: stock.location_id,
      available: stock.quantity_available,
      locationName: stock.inventory_locations.name,
    }));
  }

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
    const where: any = {
      reorder_point: { not: null },
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
    const lowStockItems = stockItems.filter(
      (item) => item.quantity_available <= (item.reorder_point ?? Infinity),
    );

    return lowStockItems.map((item) => ({
      productId: item.product_id,
      productName: item.products.name,
      locationId: item.location_id,
      locationName: item.inventory_locations.name,
      currentStock: item.quantity_available,
      reorderPoint: item.reorder_point ?? 0,
    }));
  }

  /**
   * Get inventory valuation
   */
  async getInventoryValuation(
    organizationId: number,
    locationId?: number,
  ): Promise<{
    totalValue: number;
    itemCount: number;
    locationBreakdown: Array<{
      locationId: number;
      locationName: string;
      value: number;
    }>;
  }> {
    const where: any = {
      inventory_locations: {
        organization_id: organizationId,
      },
    };

    if (locationId) {
      where.location_id = locationId;
    }

    const stockLevels = await this.prisma.stock_levels.findMany({
      where,
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    let totalValue = 0;
    const locationBreakdown = new Map<
      number,
      { name: string; value: number }
    >();

    for (const stockLevel of stockLevels) {
      const avgCost = await this.calculateWeightedAverageCost(
        organizationId,
        stockLevel.product_id,
        stockLevel.location_id,
        stockLevel.product_variant_id,
      );

      const itemValue = stockLevel.quantity_on_hand * avgCost;
      totalValue += itemValue;

      const locationId = stockLevel.location_id;
      const current = locationBreakdown.get(locationId) || {
        name: stockLevel.inventory_locations.name,
        value: 0,
      };
      current.value += itemValue;
      locationBreakdown.set(locationId, current);
    }

    return {
      totalValue,
      itemCount: stockLevels.length,
      locationBreakdown: Array.from(locationBreakdown.entries()).map(
        ([locationId, data]) => ({
          locationId,
          locationName: data.name,
          value: data.value,
        }),
      ),
    };
  }

  /**
   * Clean up expired reservations
   */
  async cleanupExpiredReservations(organizationId: number): Promise<number> {
    const now = new Date();

    const expiredReservations = await this.prisma.stock_reservations.findMany({
      where: {
        organization_id: organizationId,
        status: 'active',
        expires_at: { lt: now },
      },
    });

    if (expiredReservations.length === 0) {
      return 0;
    }

    // Update expired reservations and release stock
    await this.prisma.$transaction(async (tx) => {
      for (const reservation of expiredReservations) {
        // Update reservation status
        await tx.stock_reservations.update({
          where: { id: reservation.id },
          data: {
            status: 'expired',
            updated_at: now,
          },
        });

        // Release stock
        const stockLevel = await tx.stock_levels.findUnique({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: reservation.product_id,
              product_variant_id: reservation.product_variant_id,
              location_id: reservation.location_id,
            },
          },
        });

        if (stockLevel) {
          await tx.stock_levels.update({
            where: {
              product_id_product_variant_id_location_id: {
                product_id: reservation.product_id,
                product_variant_id: reservation.product_variant_id,
                location_id: reservation.location_id,
              },
            },
            data: {
              quantity_reserved: Math.max(
                0,
                stockLevel.quantity_reserved - reservation.quantity,
              ),
              quantity_available:
                stockLevel.quantity_available + reservation.quantity,
              last_updated: now,
            },
          });
        }
      }
    });

    return expiredReservations.length;
  }
}
