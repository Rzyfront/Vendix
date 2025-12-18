import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateMovementDto } from './dto/create-movement.dto';
import { MovementQueryDto } from './dto/movement-query.dto';

@Injectable()
export class MovementsService {
  constructor(private prisma: StorePrismaService) {}

  async create(createMovementDto: CreateMovementDto) {
    return this.prisma.$transaction(async (tx) => {
      // Create the movement record
      const movement = await tx.inventory_movements.create({
        data: {
          ...createMovementDto,
          created_at: new Date(),
        },
        include: {
          products: true,
          product_variants: true,
          from_location: true,
          to_location: true,
          users: true,
        },
      });

      // Update stock levels based on movement type
      await this.updateStockLevels(tx, movement);

      return movement;
    });
  }

  findAll(query: MovementQueryDto) {
    const where: any = {
      product_id: query.product_id,
      product_variant_id: query.product_variant_id,
      from_location_id: query.from_location_id,
      to_location_id: query.to_location_id,
      movement_type: query.movement_type,
      user_id: query.user_id,
    };

    // Add date range filter
    if (query.start_date || query.end_date) {
      where.created_at = {};
      if (query.start_date) {
        where.created_at.gte = new Date(query.start_date);
      }
      if (query.end_date) {
        where.created_at.lte = new Date(query.end_date);
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { reason: { contains: query.search } },
        { notes: { contains: query.search } },
        { reference_number: { contains: query.search } },
        { batch_number: { contains: query.search } },
        { serial_number: { contains: query.search } },
      ];
    }

    return this.prisma.inventory_movements.findMany({
      where,
      include: {
        products: true,
        product_variants: true,
        from_location: true,
        to_location: true,
        users: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  findByProduct(productId: number, query: MovementQueryDto) {
    return this.findAll({
      ...query,
      product_id: productId,
    });
  }

  findByLocation(locationId: number, query: MovementQueryDto) {
    return this.findAll({
      ...query,
      from_location_id: locationId,
    });
  }

  findByUser(userId: number, query: MovementQueryDto) {
    return this.findAll({
      ...query,
      user_id: userId,
    });
  }

  findOne(id: number) {
    return this.prisma.inventory_movements.findUnique({
      where: { id },
      include: {
        products: true,
        product_variants: true,
        from_location: true,
        to_location: true,
        users: true,
      },
    });
  }

  private async updateStockLevels(tx: any, movement: any) {
    const {
      product_id,
      product_variant_id,
      from_location_id,
      to_location_id,
      quantity,
      movement_type,
    } = movement;

    switch (movement_type) {
      case 'stock_in':
        if (to_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            to_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;

      case 'stock_out':
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
        }
        break;

      case 'transfer':
        if (from_location_id && to_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
          await this.updateStockLevel(
            tx,
            product_id,
            to_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;

      case 'sale':
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
        }
        break;

      case 'return':
        if (to_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            to_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;

      case 'damage':
      case 'expiration':
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            -quantity,
            product_variant_id,
          );
        }
        break;

      case 'adjustment':
        // Adjustments can be positive or negative based on quantity
        if (from_location_id) {
          await this.updateStockLevel(
            tx,
            product_id,
            from_location_id,
            quantity,
            product_variant_id,
          );
        }
        break;
    }
  }

  private async updateStockLevel(
    tx: any,
    productId: number,
    locationId: number,
    quantityChange: number,
    productVariantId?: number,
  ) {
    const existingStock = await tx.stock_levels.findUnique({
      where: {
        product_id_product_variant_id_location_id: {
          product_id: productId,
          product_variant_id: productVariantId || null,
          location_id: locationId,
        },
      },
    });

    if (existingStock) {
      const newQuantityOnHand = existingStock.quantity_on_hand + quantityChange;
      const newQuantityAvailable =
        existingStock.quantity_available + quantityChange;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_on_hand: Math.max(0, newQuantityOnHand),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
    } else {
      return tx.stock_levels.create({
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
