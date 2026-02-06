import { Injectable, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';

@Injectable()
export class StockLevelsService {
  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
  ) {}

  findAll(query: StockLevelQueryDto) {
    return this.prisma.stock_levels.findMany({
      where: {
        product_id: query.product_id,
        location_id: query.location_id,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
  }

  findByProduct(productId: number, query: StockLevelQueryDto) {
    return this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        location_id: query.location_id,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
  }

  findByLocation(locationId: number, query: StockLevelQueryDto) {
    // Validate location access implicitly by the query scope? 
    // If locationId is not in store, findMany returns empty. Correct.
    return this.prisma.stock_levels.findMany({
      where: {
        location_id: locationId,
        product_id: query.product_id,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
  }

  getStockAlerts(query: StockLevelQueryDto) {
    return this.prisma.stock_levels.findMany({
      where: {
        quantity_available: {
          lte: this.prisma.stock_levels.fields.reorder_point,
        },
        product_id: query.product_id,
        location_id: query.location_id,
      },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
  }

  findOne(id: number) {
    // Changed to findFirst to allow scoping injections
    return this.prisma.stock_levels.findFirst({
      where: { id },
      include: {
        products: true,
        product_variants: true,
        inventory_locations: true,
      },
    });
  }

  /**
   * Updates stock level using StockLevelManager to ensure synchronization
   * with products.stock_quantity and product_variants.stock_quantity
   */
  async updateStockLevel(
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    // Validate location membership in store
    const location = await this.prisma.inventory_locations.findFirst({
      where: { id: locationId },
    });
    if (!location) {
      throw new ForbiddenException('Location not found in this store context');
    }

    // Delegate to StockLevelManager to ensure proper sync
    const result = await this.stockLevelManager.updateStock({
      product_id: productId,
      variant_id: productVariantId,
      location_id: locationId,
      quantity_change: quantityChange,
      movement_type: 'adjustment',
      reason: 'Direct stock level update',
      create_movement: false,
    });

    return result.stock_level;
  }
}
