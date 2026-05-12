import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

export interface CalculateCostParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity_received: number;
  unit_cost: number;
  costing_method: 'weighted_average' | 'fifo' | 'lifo';
  purchase_order_id?: number;
  batch_number?: string;
  manufacturing_date?: Date;
  expiration_date?: Date;
}

export interface CostCalculationResult {
  new_cost_per_unit: number;
  previous_cost_per_unit: number;
}

export interface ConsumeCostParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity: number;
  costing_method: 'weighted_average' | 'fifo' | 'lifo';
}

@Injectable()
export class CostingService {
  private readonly logger = new Logger(CostingService.name);

  constructor(private prisma: StorePrismaService) {}

  /**
   * Calculate new cost on inventory receipt and create cost layer.
   * Called when receiving a purchase order.
   */
  async calculateCostOnReceipt(
    params: CalculateCostParams,
    tx?: any,
  ): Promise<CostCalculationResult> {
    const prisma = tx || this.prisma;
    const organizationId = this.getOrganizationId();

    // Get current stock level for existing cost/quantity
    const stockLevel = await prisma.stock_levels.findFirst({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
      },
    });

    const existingQty = stockLevel?.quantity_on_hand ?? 0;
    const existingCost = Number(stockLevel?.cost_per_unit ?? 0);

    // Global stock across all locations (for product-level cost_price)
    const allStockLevels = await prisma.stock_levels.findMany({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        quantity_on_hand: { gt: 0 },
      },
    });
    const globalQty = allStockLevels.reduce(
      (sum, sl) => sum + (sl.quantity_on_hand ?? 0),
      0,
    );
    const globalValue = allStockLevels.reduce(
      (sum, sl) =>
        sum + (sl.quantity_on_hand ?? 0) * Number(sl.cost_per_unit ?? 0),
      0,
    );
    const globalCost = globalQty > 0 ? globalValue / globalQty : 0;

    let newCostPerUnit: number;

    switch (params.costing_method) {
      case 'weighted_average':
        newCostPerUnit = this.calculateWeightedAverage(
          existingQty,
          existingCost,
          params.quantity_received,
          params.unit_cost,
        );
        break;

      case 'fifo':
      case 'lifo':
        // For FIFO/LIFO, the cost_per_unit on stock_levels represents the
        // latest receipt cost. The actual COGS is determined at consumption time.
        newCostPerUnit = params.unit_cost;
        break;

      default:
        newCostPerUnit = params.unit_cost;
    }

    // Calculate global cost per unit for product-level cost_price
    let globalCostPerUnit: number;
    if (params.costing_method === 'weighted_average') {
      globalCostPerUnit = this.calculateWeightedAverage(
        globalQty,
        globalCost,
        params.quantity_received,
        params.unit_cost,
      );
    } else {
      globalCostPerUnit = params.unit_cost;
    }

    // Always create a cost layer (useful for FIFO/LIFO, and for audit in weighted avg)
    await prisma.inventory_cost_layers.create({
      data: {
        organization_id: organizationId,
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
        purchase_order_id: params.purchase_order_id || null,
        quantity_remaining: params.quantity_received,
        unit_cost: new Prisma.Decimal(params.unit_cost),
        received_at: new Date(),
        batch_number: params.batch_number || null,
        manufacturing_date: params.manufacturing_date || null,
        expiration_date: params.expiration_date || null,
      },
    });

    // Update cost_per_unit on stock_levels
    if (stockLevel) {
      await prisma.stock_levels.update({
        where: { id: stockLevel.id },
        data: {
          cost_per_unit: new Prisma.Decimal(newCostPerUnit),
          updated_at: new Date(),
        },
      });
    }

    // Update product or variant cost_price (global weighted average across all locations)
    if (params.variant_id) {
      await prisma.product_variants.update({
        where: { id: params.variant_id },
        data: { cost_price: new Prisma.Decimal(globalCostPerUnit) },
      });
    } else {
      await prisma.products.update({
        where: { id: params.product_id },
        data: { cost_price: new Prisma.Decimal(globalCostPerUnit) },
      });
    }

    return {
      new_cost_per_unit: newCostPerUnit,
      previous_cost_per_unit: existingCost,
    };
  }

  /**
   * Consume cost layers when selling/removing stock.
   * Returns the total COGS (Cost of Goods Sold) for the consumed quantity.
   */
  async consumeCostLayers(
    params: ConsumeCostParams,
    tx?: any,
  ): Promise<number> {
    const prisma = tx || this.prisma;

    if (params.costing_method === 'weighted_average') {
      // For weighted average, COGS is simply quantity * current cost_per_unit
      const stockLevel = await prisma.stock_levels.findFirst({
        where: {
          product_id: params.product_id,
          product_variant_id: params.variant_id || null,
          location_id: params.location_id,
        },
      });
      const costPerUnit = Number(stockLevel?.cost_per_unit ?? 0);
      return params.quantity * costPerUnit;
    }

    // FIFO or LIFO: consume layers in order
    const orderDirection = params.costing_method === 'fifo' ? 'asc' : 'desc';

    const layers = await prisma.inventory_cost_layers.findMany({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
        quantity_remaining: { gt: 0 },
      },
      orderBy: { received_at: orderDirection },
    });

    let remainingToConsume = params.quantity;
    let totalCogs = 0;

    for (const layer of layers) {
      if (remainingToConsume <= 0) break;

      const consumeFromLayer = Math.min(
        remainingToConsume,
        layer.quantity_remaining,
      );

      totalCogs += consumeFromLayer * Number(layer.unit_cost);
      remainingToConsume -= consumeFromLayer;

      await prisma.inventory_cost_layers.update({
        where: { id: layer.id },
        data: {
          quantity_remaining: layer.quantity_remaining - consumeFromLayer,
        },
      });
    }

    if (remainingToConsume > 0) {
      this.logger.warn(
        `Insufficient cost layers for product ${params.product_id}. ` +
          `${remainingToConsume} units consumed without layer data.`,
      );
    }

    return totalCogs;
  }

  /**
   * Initialize cost layers for existing stock (migration utility).
   */
  async initializeCostLayers(organizationId: number, tx?: any): Promise<void> {
    const prisma = tx || this.prisma;

    const stockLevels = await prisma.stock_levels.findMany({
      where: {
        quantity_on_hand: { gt: 0 },
      },
      include: {
        products: {
          select: { cost_price: true },
        },
        product_variants: {
          select: { cost_price: true },
        },
        inventory_locations: {
          select: { organization_id: true },
        },
      },
    });

    for (const sl of stockLevels) {
      const orgId = sl.inventory_locations?.organization_id;
      if (orgId !== organizationId) continue;

      // Skip if layer already exists
      const existingLayer = await prisma.inventory_cost_layers.findFirst({
        where: {
          product_id: sl.product_id,
          product_variant_id: sl.product_variant_id,
          location_id: sl.location_id,
        },
      });

      if (existingLayer) continue;

      const costPerUnit =
        Number(sl.cost_per_unit) ||
        Number(sl.product_variants?.cost_price) ||
        Number(sl.products?.cost_price) ||
        0;

      await prisma.inventory_cost_layers.create({
        data: {
          organization_id: organizationId,
          product_id: sl.product_id,
          product_variant_id: sl.product_variant_id,
          location_id: sl.location_id,
          quantity_remaining: sl.quantity_on_hand,
          unit_cost: new Prisma.Decimal(costPerUnit),
          received_at: sl.created_at || new Date(),
        },
      });
    }

    this.logger.log(
      `Initialized cost layers for organization ${organizationId}`,
    );
  }

  /**
   * Weighted average formula:
   * new_cost = ((existing_qty * existing_cost) + (received_qty * received_cost)) / (existing_qty + received_qty)
   */
  private calculateWeightedAverage(
    existingQty: number,
    existingCost: number,
    receivedQty: number,
    receivedCost: number,
  ): number {
    const totalQty = existingQty + receivedQty;
    if (totalQty <= 0) return receivedCost;

    const totalValue = existingQty * existingCost + receivedQty * receivedCost;
    return totalValue / totalQty;
  }

  private getOrganizationId(): number {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new Error('Organization context required for costing operations');
    }
    return context.organization_id;
  }
}
