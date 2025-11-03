import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';
import { transfer_status_enum } from '@prisma/client';

@Injectable()
export class StockTransfersService {
  constructor(private prisma: PrismaService) {}

  async create(createTransferDto: CreateTransferDto) {
    return this.prisma.$transaction(async (tx) => {
      // Validate source and destination locations are different
      if (
        createTransferDto.from_location_id === createTransferDto.to_location_id
      ) {
        throw new BadRequestException(
          'Source and destination locations must be different',
        );
      }

      // Validate stock availability for all items
      for (const item of createTransferDto.items) {
        const stockLevel = await tx.stock_levels.findUnique({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: item.product_id,
              product_variant_id: item.product_variant_id || null,
              location_id: createTransferDto.from_location_id,
            },
          },
        });

        if (!stockLevel || stockLevel.quantity_available < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product ${item.product_id} at source location`,
          );
        }
      }

      // Generate transfer number
      const transferNumber = await this.generateTransferNumber(tx);

      // Create stock transfer
      const stockTransfer = await tx.stock_transfers.create({
        data: {
          ...createTransferDto,
          transfer_number: transferNumber,
          transfer_date: new Date(),
          expected_date: createTransferDto.expected_date,
        },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });

      return stockTransfer;
    });
  }

  findAll(query: TransferQueryDto) {
    const where: any = {
      from_location_id: query.from_location_id,
      to_location_id: query.to_location_id,
      status: query.status,
    };

    // Add date range filter
    if (query.transfer_date_from || query.transfer_date_to) {
      where.transfer_date = {};
      if (query.transfer_date_from) {
        where.transfer_date.gte = query.transfer_date_from;
      }
      if (query.transfer_date_to) {
        where.transfer_date.lte = query.transfer_date_to;
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { transfer_number: { contains: query.search } },
        { reference_number: { contains: query.search } },
        { reason: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    // Add product filter
    if (query.product_id) {
      where.stock_transfer_items = {
        some: {
          product_id: query.product_id,
        },
      };
    }

    return this.prisma.stock_transfers.findMany({
      where,
      include: {
        from_location: true,
        to_location: true,
        stock_transfer_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
      orderBy: {
        transfer_date: 'desc',
      },
    });
  }

  findByStatus(status: transfer_status_enum, query: TransferQueryDto) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findByFromLocation(locationId: number, query: TransferQueryDto) {
    return this.findAll({
      ...query,
      from_location_id: locationId,
    });
  }

  findByToLocation(locationId: number, query: TransferQueryDto) {
    return this.findAll({
      ...query,
      to_location_id: locationId,
    });
  }

  findOne(id: number) {
    return this.prisma.stock_transfers.findUnique({
      where: { id },
      include: {
        from_location: true,
        to_location: true,
        stock_transfer_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async update(id: number, updateTransferDto: UpdateTransferDto) {
    // Only allow updates if status is draft
    const existingTransfer = await this.prisma.stock_transfers.findUnique({
      where: { id },
    });

    if (existingTransfer.status !== transfer_status_enum.draft) {
      throw new BadRequestException('Only draft transfers can be updated');
    }

    return this.prisma.stock_transfers.update({
      where: { id },
      data: updateTransferDto,
      include: {
        from_location: true,
        to_location: true,
        stock_transfer_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async approve(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (stockTransfer.status !== transfer_status_enum.draft) {
        throw new BadRequestException('Only draft transfers can be approved');
      }

      // Reserve stock at source location
      for (const item of stockTransfer.stock_transfer_items) {
        await this.reserveStock(
          tx,
          item.product_id,
          stockTransfer.from_location_id,
          item.quantity,
          item.product_variant_id,
        );
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.in_transit,
          approved_date: new Date(),
        },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  async startTransfer(id: number) {
    const stockTransfer = await this.prisma.stock_transfers.findUnique({
      where: { id },
    });

    if (stockTransfer.status !== transfer_status_enum.in_transit) {
      throw new BadRequestException('Only in-transit transfers can be started');
    }

    return this.prisma.stock_transfers.update({
      where: { id },
      data: {
        started_date: new Date(),
      },
      include: {
        from_location: true,
        to_location: true,
        stock_transfer_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async complete(
    id: number,
    items: Array<{ id: number; quantity_received: number }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Update stock transfer items with received quantities
      for (const item of items) {
        await tx.stock_transfer_items.update({
          where: { id: item.id },
          data: {
            quantity_received: item.quantity_received,
            received_date: new Date(),
          },
        });
      }

      // Create inventory movements and update stock levels
      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: {
          stock_transfer_items: true,
        },
      });

      for (const item of stockTransfer.stock_transfer_items) {
        const receivedItem = items.find((i) => i.id === item.id);
        if (receivedItem && receivedItem.quantity_received > 0) {
          // Create inventory movement from source
          await tx.inventory_movements.create({
            data: {
              organization_id: stockTransfer.organization_id,
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              from_location_id: stockTransfer.from_location_id,
              quantity: receivedItem.quantity_received,
              movement_type: 'transfer',
              source_order_type: 'stock_transfer',
              source_order_id: id,
              reason: 'Stock transfer - source',
              created_at: new Date(),
            },
          });

          // Create inventory movement to destination
          await tx.inventory_movements.create({
            data: {
              organization_id: stockTransfer.organization_id,
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              to_location_id: stockTransfer.to_location_id,
              quantity: receivedItem.quantity_received,
              movement_type: 'transfer',
              source_order_type: 'stock_transfer',
              source_order_id: id,
              reason: 'Stock transfer - destination',
              created_at: new Date(),
            },
          });

          // Update stock levels at source
          await this.updateStockLevel(
            tx,
            item.product_id,
            stockTransfer.from_location_id,
            -receivedItem.quantity_received,
            item.product_variant_id,
          );

          // Update stock levels at destination
          await this.updateStockLevel(
            tx,
            item.product_id,
            stockTransfer.to_location_id,
            receivedItem.quantity_received,
            item.product_variant_id,
          );

          // Release reserved stock at source
          await this.releaseStock(
            tx,
            item.product_id,
            stockTransfer.from_location_id,
            receivedItem.quantity_received,
            item.product_variant_id,
          );
        }
      }

      // Check if all items are received
      const allItemsReceived = stockTransfer.stock_transfer_items.every(
        (item) => {
          const receivedItem = items.find((i) => i.id === item.id);
          return (
            receivedItem && receivedItem.quantity_received >= item.quantity
          );
        },
      );

      // Update stock transfer status
      const newStatus = allItemsReceived
        ? transfer_status_enum.completed
        : transfer_status_enum.in_transit;

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: newStatus,
          completed_date: allItemsReceived ? new Date() : null,
        },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: {
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
    return this.prisma.$transaction(async (tx) => {
      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      if (stockTransfer.status === transfer_status_enum.completed) {
        throw new BadRequestException(
          'Completed transfers cannot be cancelled',
        );
      }

      // Release any reserved stock
      if (stockTransfer.status === transfer_status_enum.in_transit) {
        for (const item of stockTransfer.stock_transfer_items) {
          await this.releaseStock(
            tx,
            item.product_id,
            stockTransfer.from_location_id,
            item.quantity,
            item.product_variant_id,
          );
        }
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.cancelled,
          cancelled_date: new Date(),
        },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  remove(id: number) {
    return this.prisma.stock_transfers.delete({
      where: { id },
    });
  }

  private async generateTransferNumber(tx: any): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const prefix = `TRF-${year}${month}${day}`;

    // Find the last transfer number for today
    const lastTransfer = await tx.stock_transfers.findFirst({
      where: {
        transfer_number: {
          startsWith: prefix,
        },
      },
      orderBy: {
        transfer_number: 'desc',
      },
    });

    let sequence = 1;
    if (lastTransfer) {
      const lastSequence = parseInt(lastTransfer.transfer_number.split('-')[2]);
      sequence = lastSequence + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }

  private async reserveStock(
    tx: any,
    productId: number,
    locationId: number,
    quantity: number,
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
      const newQuantityReserved = existingStock.quantity_reserved + quantity;
      const newQuantityAvailable = existingStock.quantity_available - quantity;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_reserved: Math.max(0, newQuantityReserved),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
    }
  }

  private async releaseStock(
    tx: any,
    productId: number,
    locationId: number,
    quantity: number,
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
      const newQuantityReserved = existingStock.quantity_reserved - quantity;
      const newQuantityAvailable = existingStock.quantity_available + quantity;

      return tx.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: productVariantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_reserved: Math.max(0, newQuantityReserved),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
        },
      });
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
