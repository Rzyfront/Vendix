import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';

export interface ScopedLocationFilter {
  organization_id: number;
  store_id?: number;
}

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
  /**
   * Weighted-average cost of the RECEIVING location alone (used to update
   * that location's `stock_levels.cost_per_unit`).
   */
  new_cost_per_unit: number;
  /**
   * QUI-425 — scoped weighted-average cost across ALL in-scope locations
   * (the value persisted to `products/variants.cost_price`). Pricing/margin
   * recomputation MUST use this so `base_price = cost_price·(1+margin/100)`
   * stays consistent and matches the cost preview.
   */
  new_scoped_cost_per_unit: number;
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

  constructor(
    private prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly operatingScopeService: OperatingScopeService,
  ) {}

  /**
   * QUI-425 — Weighted-average cost aggregate across the in-scope location set.
   *
   * Reads via the UNSCOPED base client (`GlobalPrismaService`) on purpose:
   * `buildScopedLocationFilter` already encodes the EXACT operating-scope
   * predicate (STORE → same store, ORGANIZATION → whole org). Going through
   * the store-scoped client would AND an extra
   * `inventory_locations.store_id = <ctx store>` clause that silently DROPS
   * org-level central warehouses (`store_id = null`) and sibling stores from
   * the aggregate — which corrupted `cost_price`/`profit_margin` on receipt
   * for ORGANIZATION-scope orgs (the general-inventory cost was ignored).
   *
   * Returns the scoped on-hand quantity and its weighted-average unit cost.
   */
  async getScopedStockAggregate(
    params: { product_id: number; variant_id?: number; location_id: number },
    tx?: any,
  ): Promise<{ quantity: number; cost_per_unit: number }> {
    const organizationId = this.getOrganizationId();
    const locationFilter = await this.buildScopedLocationFilter(
      organizationId,
      params.location_id,
      tx,
    );
    const rows = await this.globalPrisma.stock_levels.findMany({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        quantity_on_hand: { gt: 0 },
        inventory_locations: { is: locationFilter },
      },
    });
    const quantity = rows.reduce(
      (sum, sl) => sum + (sl.quantity_on_hand ?? 0),
      0,
    );
    const value = rows.reduce(
      (sum, sl) =>
        sum + (sl.quantity_on_hand ?? 0) * Number(sl.cost_per_unit ?? 0),
      0,
    );
    return { quantity, cost_per_unit: quantity > 0 ? value / quantity : 0 };
  }

  /**
   * Build a scoped `inventory_locations` filter for cost aggregates based on
   * the organization's operating scope:
   *
   * - STORE → constrains to the same `store_id` as the receiving location
   *   (org-level central warehouses without a `store_id` fall back to org-level).
   * - ORGANIZATION → constrains to the entire organization.
   *
   * Validates that the location belongs to the given organization. Used by
   * `calculateCostOnReceipt` and by `getCostPreview` (purchase orders) so the
   * weighted-average cost never aggregates stock across organizations or, in
   * STORE scope, across sibling stores.
   */
  async buildScopedLocationFilter(
    organizationId: number,
    locationId: number,
    tx?: any,
  ): Promise<ScopedLocationFilter> {
    const prisma = tx || this.prisma;

    const location = await prisma.inventory_locations.findUnique({
      where: { id: locationId },
      select: { organization_id: true, store_id: true },
    });

    if (!location || location.organization_id !== organizationId) {
      throw new Error(
        `Location ${locationId} does not belong to organization ${organizationId}`,
      );
    }

    const scope = await this.operatingScopeService.getOperatingScope(
      organizationId,
      tx,
    );

    if (scope === 'STORE') {
      if (location.store_id == null) {
        this.logger.warn(
          `Location ${locationId} has scope STORE but store_id is null; ` +
            `falling back to ORGANIZATION-level cost aggregate.`,
        );
        return { organization_id: organizationId };
      }
      return { organization_id: organizationId, store_id: location.store_id };
    }

    return { organization_id: organizationId };
  }

  /**
   * Calculate new cost on inventory receipt and create cost layer.
   * Called when receiving a purchase order.
   *
   * MUST be called BEFORE the stock increment for this receipt — all
   * stock_levels reads are pre-receipt to avoid double-counting the incoming
   * quantity in the weighted average.
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

    // Scoped stock aggregate (multi-tenant safe): aggregate across the same
    // store (STORE scope) or organization (ORGANIZATION scope) — never cross
    // organizations or, in STORE scope, sibling stores. Reads via the UNSCOPED
    // base client so org-level central warehouses (store_id = null) and sibling
    // stores are included for ORGANIZATION scope — see getScopedStockAggregate.
    const { quantity: scopedQty, cost_per_unit: scopedCost } =
      await this.getScopedStockAggregate(
        {
          product_id: params.product_id,
          variant_id: params.variant_id,
          location_id: params.location_id,
        },
        tx,
      );

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

    // Calculate scoped cost per unit for product-level cost_price (within the
    // same store/organization, never cross-tenant).
    let scopedCostPerUnit: number;
    if (params.costing_method === 'weighted_average') {
      scopedCostPerUnit = this.calculateWeightedAverage(
        scopedQty,
        scopedCost,
        params.quantity_received,
        params.unit_cost,
      );
    } else {
      scopedCostPerUnit = params.unit_cost;
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

    // Update product or variant cost_price (scoped weighted average across
    // same-store / same-organization locations, per operating_scope)
    if (params.variant_id) {
      await prisma.product_variants.update({
        where: { id: params.variant_id },
        data: { cost_price: new Prisma.Decimal(scopedCostPerUnit) },
      });
    } else {
      await prisma.products.update({
        where: { id: params.product_id },
        data: { cost_price: new Prisma.Decimal(scopedCostPerUnit) },
      });
    }

    return {
      new_cost_per_unit: newCostPerUnit,
      new_scoped_cost_per_unit: scopedCostPerUnit,
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
      // For weighted average, COGS is quantity * current cost_per_unit (the
      // average). We ALSO decrement cost layers (received_at ASC) so that the
      // layers stay in sync with stock_levels; otherwise the layers would sum
      // to more than the real stock and break a future FIFO switch or the
      // historical valuation. The COGS amount is unaffected by which layers we
      // touch: we always cost consumed units at the average cost_per_unit.
      const stockLevel = await prisma.stock_levels.findFirst({
        where: {
          product_id: params.product_id,
          product_variant_id: params.variant_id || null,
          location_id: params.location_id,
        },
      });
      const costPerUnit = Number(stockLevel?.cost_per_unit ?? 0);

      const cppLayers = await prisma.inventory_cost_layers.findMany({
        where: {
          product_id: params.product_id,
          product_variant_id: params.variant_id || null,
          location_id: params.location_id,
          quantity_remaining: { gt: 0 },
        },
        orderBy: { received_at: 'asc' },
      });

      let remainingToConsume = params.quantity;
      let totalCogs = 0;

      for (const layer of cppLayers) {
        if (remainingToConsume <= 0) break;

        const consumeFromLayer = Math.min(
          remainingToConsume,
          layer.quantity_remaining,
        );

        // Average costing: cost consumed units at the average cost_per_unit,
        // NOT at the individual layer.unit_cost.
        totalCogs += consumeFromLayer * costPerUnit;
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
        // Preserve legacy CPP behavior: COGS must remain exactly
        // quantity * cost_per_unit even when layers are insufficient, so we
        // still charge the missing units at the average cost.
        totalCogs += remainingToConsume * costPerUnit;
      }

      return totalCogs;
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
