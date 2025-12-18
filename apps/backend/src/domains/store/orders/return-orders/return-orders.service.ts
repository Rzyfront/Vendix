import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { UpdateReturnOrderDto } from './dto/update-return-order.dto';
import { ReturnOrderQueryDto } from './dto/return-order-query.dto';
import { return_order_status_enum } from '@prisma/client';

@Injectable()
export class ReturnOrdersService {
  constructor(private prisma: StorePrismaService) {}

  async create(createReturnOrderDto: CreateReturnOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // Generate return order number
      const returnNumber = await this.generateReturnNumber(
        tx,
        createReturnOrderDto.type || 'refund',
      );

      // Calculate total refund amount if not provided
      let totalRefundAmount = createReturnOrderDto.total_refund_amount;
      if (!totalRefundAmount) {
        totalRefundAmount = createReturnOrderDto.items.reduce(
          (sum, item) =>
            sum + (item.refund_amount || 0) * item.quantity_returned,
          0,
        );
      }

      // Create return order
      const returnOrder = await tx.return_orders.create({
        data: {
          ...createReturnOrderDto,
          return_number: returnNumber,
          return_date: createReturnOrderDto.return_date
            ? new Date(createReturnOrderDto.return_date)
            : new Date(),
          total_refund_amount: totalRefundAmount,
        },
        include: {
          return_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });

      return returnOrder;
    });
  }

  findAll(query: ReturnOrderQueryDto) {
    const where: any = {
      order_id: query.order_id,
      partner_id: query.partner_id,
      type: query.type,
      status: query.status,
      store_id: query.store_id,
    };

    // Add date range filter
    if (query.return_date_from || query.return_date_to) {
      where.return_date = {};
      if (query.return_date_from) {
        where.return_date.gte = query.return_date_from;
      }
      if (query.return_date_to) {
        where.return_date.lte = query.return_date_to;
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { return_number: { contains: query.search } },
        { reference_number: { contains: query.search } },
        { reason: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    // Add product filter
    if (query.product_id) {
      where.return_order_items = {
        some: {
          product_id: query.product_id,
        },
      };
    }

    return this.prisma.return_orders.findMany({
      where,
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
      orderBy: {
        return_date: 'desc',
      },
    });
  }

  findByStatus(status: return_order_status_enum, query: ReturnOrderQueryDto) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findByType(
    type: 'refund' | 'replacement' | 'credit',
    query: ReturnOrderQueryDto,
  ) {
    return this.findAll({
      ...query,
      type,
    });
  }

  findByPartner(partnerId: number, query: ReturnOrderQueryDto) {
    return this.findAll({
      ...query,
      partner_id: partnerId,
    });
  }

  findOne(id: number) {
    return this.prisma.return_orders.findUnique({
      where: { id },
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async update(id: number, updateReturnOrderDto: UpdateReturnOrderDto) {
    // Only allow updates if status is draft
    const existingReturn = await this.prisma.return_orders.findUnique({
      where: { id },
    });

    if (existingReturn.status !== return_order_status_enum.draft) {
      throw new BadRequestException('Only draft returns can be updated');
    }

    return this.prisma.return_orders.update({
      where: { id },
      data: updateReturnOrderDto,
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async process(
    id: number,
    items: Array<{ id: number; action: string; location_id?: number }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const returnOrder = await tx.return_orders.findUnique({
        where: { id },
        include: { return_order_items: true },
      });

      if (returnOrder.status !== return_order_status_enum.draft) {
        throw new BadRequestException('Only draft returns can be processed');
      }

      // Process each item
      for (const item of items) {
        const returnItem = returnOrder.return_order_items.find(
          (ri) => ri.id === item.id,
        );
        if (!returnItem) continue;

        switch (item.action) {
          case 'restock':
            // Add items back to inventory
            await this.restockItem(
              tx,
              returnOrder,
              returnItem,
              item.location_id,
            );
            break;

          case 'write_off':
            // Write off damaged items
            await this.writeOffItem(tx, returnOrder, returnItem);
            break;

          case 'repair':
            // Send items for repair
            await this.repairItem(
              tx,
              returnOrder,
              returnItem,
              item.location_id,
            );
            break;
        }
      }

      // Update return order status
      return tx.return_orders.update({
        where: { id },
        data: {
          status: return_order_status_enum.processed,
          processed_date: new Date(),
        },
        include: {
          return_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  async cancel(id: number) {
    const returnOrder = await this.prisma.return_orders.findUnique({
      where: { id },
    });

    if (returnOrder.status === return_order_status_enum.processed) {
      throw new BadRequestException('Processed returns cannot be cancelled');
    }

    return this.prisma.return_orders.update({
      where: { id },
      data: {
        status: return_order_status_enum.cancelled,
        cancelled_date: new Date(),
      },
      include: {
        return_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  remove(id: number) {
    return this.prisma.return_orders.delete({
      where: { id },
    });
  }

  private async restockItem(
    tx: any,
    returnOrder: any,
    returnItem: any,
    locationId?: number,
  ) {
    const target_location_id = locationId || returnOrder.location_id;

    // Create inventory movement for restocking
    await tx.inventory_movements.create({
      data: {
        organization_id: returnOrder.organization_id,
        product_id: returnItem.product_id,
        product_variant_id: returnItem.product_variant_id,
        to_location_id: target_location_id,
        quantity: returnItem.quantity,
        movement_type: 'return',
        source_order_type: 'return_order',
        source_order_id: returnOrder.id,
        reason: `Return restock: ${returnItem.reason}`,
        created_at: new Date(),
      },
    });

    // Update stock levels
    await this.updateStockLevel(
      tx,
      returnItem.product_id,
      target_location_id,
      returnItem.quantity,
      returnItem.product_variant_id,
    );
  }

  private async writeOffItem(tx: any, returnOrder: any, returnItem: any) {
    // Create inventory movement for write-off
    await tx.inventory_movements.create({
      data: {
        organization_id: returnOrder.organization_id,
        product_id: returnItem.product_id,
        product_variant_id: returnItem.product_variant_id,
        from_location_id: returnOrder.location_id,
        quantity: returnItem.quantity,
        movement_type: 'damage',
        source_order_type: 'return_order',
        source_order_id: returnOrder.id,
        reason: `Return write-off: ${returnItem.reason}`,
        created_at: new Date(),
      },
    });

    // Update stock levels (decrease)
    await this.updateStockLevel(
      tx,
      returnItem.product_id,
      returnOrder.location_id,
      returnItem.quantity,
      returnItem.product_variant_id,
    );
  }

  private async repairItem(
    tx: any,
    returnOrder: any,
    returnItem: any,
    locationId?: number,
  ) {
    const target_location_id = locationId || returnOrder.location_id;

    // Create inventory movement for repair
    await tx.inventory_movements.create({
      data: {
        organization_id: returnOrder.organization_id,
        product_id: returnItem.product_id,
        product_variant_id: returnItem.product_variant_id,
        to_location_id: target_location_id,
        quantity: returnItem.quantity,
        movement_type: 'adjustment',
        source_order_type: 'return_order',
        source_order_id: returnOrder.id,
        reason: `Return repair: ${returnItem.reason}`,
        created_at: new Date(),
      },
    });

    // Update stock levels
    await this.updateStockLevel(
      tx,
      returnItem.product_id,
      target_location_id,
      returnItem.quantity,
      returnItem.product_variant_id,
    );
  }

  private async generateReturnNumber(tx: any, type: string): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const prefix =
      type === 'purchase_return'
        ? `PR-${year}${month}${day}`
        : `SR-${year}${month}${day}`;

    // Find the last return number for today and type
    const lastReturn = await tx.return_orders.findFirst({
      where: {
        return_number: {
          startsWith: prefix,
        },
        type: type,
      },
      orderBy: {
        return_number: 'desc',
      },
    });

    let sequence = 1;
    if (lastReturn) {
      const lastSequence = parseInt(lastReturn.return_number.split('-')[2]);
      sequence = lastSequence + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
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
