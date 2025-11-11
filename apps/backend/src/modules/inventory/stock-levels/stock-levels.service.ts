import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { StockLevelQueryDto } from './dto/stock-level-query.dto';

@Injectable()
export class StockLevelsService {
  constructor(private prisma: PrismaService) {}

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
    return this.prisma.stock_levels.findUnique({
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
    const existingStock = await this.prisma.stock_levels.findUnique({
      where: {
        product_id_product_variant_id_location_id: {
          product_id: productId,
          product_variant_id: productVariantId || null,
          location_id: locationId,
        },
      },
    });

    if (existingStock) {
      return this.prisma.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
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
