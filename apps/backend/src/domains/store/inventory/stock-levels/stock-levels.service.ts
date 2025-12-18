import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';

@Injectable()
export class StockLevelsService {
  constructor(private prisma: StorePrismaService) { }

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

  async updateStockLevel(
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    // Validate validation of location membership in store
    const location = await this.prisma.inventory_locations.findFirst({
      where: { id: locationId }
    });
    if (!location) {
      throw new ForbiddenException('Location not found in this store context');
    }

    // Use findFirst for scoped query compatibility
    const existingStock = await this.prisma.stock_levels.findFirst({
      where: {
        product_id: productId,
        product_variant_id: productVariantId || null,
        location_id: locationId,
      },
    });

    if (existingStock) {
      // Use updateMany for scoped query compatibility
      return this.prisma.stock_levels.updateMany({
        where: {
          // Using ID is safer if we found it, but updateMany via composite key + scope is also fine.
          // Using ID from existingStock makes it specific.
          id: existingStock.id
        },
        data: {
          quantity_on_hand: existingStock.quantity_on_hand + quantityChange,
          quantity_available: existingStock.quantity_available + quantityChange,
          last_updated: new Date(),
        },
      });
    } else {
      return this.prisma.stock_levels.create({
        data: {
          product_id: productId,
          product_variant_id: productVariantId,
          location_id: locationId,
          quantity_on_hand: Math.max(0, quantityChange),
          quantity_reserved: 0,
          quantity_available: Math.max(0, quantityChange),
          last_updated: new Date(),
        },
      });
    }
  }
}
