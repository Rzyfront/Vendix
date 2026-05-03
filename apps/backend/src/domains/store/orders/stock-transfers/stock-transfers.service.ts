import { Injectable, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';
import { transfer_status_enum } from '@prisma/client';
import { OperatingScopeService } from '@common/services/operating-scope.service';

@Injectable()
export class StockTransfersService {
  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private readonly event_emitter: EventEmitter2,
    private readonly operatingScopeService: OperatingScopeService,
  ) {}

  private async validateTransferScope(
    organizationId: number,
    fromLocationId: number,
    toLocationId: number,
    tx: any,
  ): Promise<{ store_id?: number | null }> {
    const context = RequestContextService.getContext();
    const { scope, locations } =
      await this.operatingScopeService.validateLocationScope(
        organizationId,
        [fromLocationId, toLocationId],
        tx,
      );

    if (scope === 'ORGANIZATION') {
      return { store_id: null };
    }

    const storeId = locations[0].store_id;
    if (!context?.store_id || context.store_id !== storeId) {
      throw new BadRequestException(
        'Cross-store stock transfers are not allowed in STORE operating scope',
      );
    }

    return { store_id: storeId };
  }

  private async calculateTransferTotalCost(
    items: any[] = [],
    fromLocationId: number,
    quantitySelector: (item: any) => number,
  ): Promise<number> {
    let totalCost = 0;

    for (const item of items) {
      const quantity = quantitySelector(item);
      if (quantity <= 0) continue;

      const stockLevel = await this.prisma.stock_levels.findFirst({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
          location_id: fromLocationId,
        },
        select: {
          cost_per_unit: true,
          products: { select: { cost_price: true } },
          product_variants: { select: { cost_price: true } },
        },
      });

      const unitCost =
        Number(stockLevel?.cost_per_unit || 0) ||
        Number(stockLevel?.product_variants?.cost_price || 0) ||
        Number(stockLevel?.products?.cost_price || 0);
      totalCost += quantity * unitCost;
    }

    return totalCost;
  }

  async getStats() {
    const [total, draft, in_transit, completed, cancelled] = await Promise.all([
      this.prisma.stock_transfers.count(),
      this.prisma.stock_transfers.count({ where: { status: 'draft' } }),
      this.prisma.stock_transfers.count({ where: { status: 'in_transit' } }),
      this.prisma.stock_transfers.count({ where: { status: 'completed' } }),
      this.prisma.stock_transfers.count({ where: { status: 'cancelled' } }),
    ]);

    return {
      success: true,
      data: { total, draft, in_transit, completed, cancelled },
    };
  }

  async create(createTransferDto: CreateTransferDto) {
    return this.prisma.$transaction(async (tx) => {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new BadRequestException('Organization context is required');
      }

      if (
        createTransferDto.from_location_id === createTransferDto.to_location_id
      ) {
        throw new BadRequestException(
          'Source and destination locations must be different',
        );
      }

      await this.validateTransferScope(
        context.organization_id,
        createTransferDto.from_location_id,
        createTransferDto.to_location_id,
        tx,
      );

      // Validate stock availability for all items
      for (const item of createTransferDto.items) {
        const stockLevel = await tx.stock_levels.findFirst({
          where: {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            location_id: createTransferDto.from_location_id,
          },
        });

        if (!stockLevel || stockLevel.quantity_available < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product ${item.product_id} at source location`,
          );
        }
      }

      const transferNumber = await this.generateTransferNumber(tx);

      const stockTransfer = await tx.stock_transfers.create({
        data: {
          organization_id: context.organization_id,
          from_location_id: createTransferDto.from_location_id,
          to_location_id: createTransferDto.to_location_id,
          notes: createTransferDto.notes,
          transfer_number: transferNumber,
          transfer_date: new Date(),
          expected_date: createTransferDto.expected_date,
          created_by_user_id: context.user_id,
          stock_transfer_items: {
            create: createTransferDto.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity: item.quantity,
              notes: item.notes,
            })),
          },
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

  async createAndComplete(createTransferDto: CreateTransferDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new BadRequestException('Organization context is required');
      }

      if (
        createTransferDto.from_location_id === createTransferDto.to_location_id
      ) {
        throw new BadRequestException(
          'Source and destination locations must be different',
        );
      }

      const transferScope = await this.validateTransferScope(
        context.organization_id,
        createTransferDto.from_location_id,
        createTransferDto.to_location_id,
        tx,
      );

      // Validate stock availability for all items
      for (const item of createTransferDto.items) {
        const stockLevel = await tx.stock_levels.findFirst({
          where: {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            location_id: createTransferDto.from_location_id,
          },
        });

        if (!stockLevel || stockLevel.quantity_available < item.quantity) {
          throw new BadRequestException(
            `Insufficient stock for product ${item.product_id} at source location`,
          );
        }
      }

      const transferNumber = await this.generateTransferNumber(tx);

      const stockTransfer = await tx.stock_transfers.create({
        data: {
          organization_id: context.organization_id,
          from_location_id: createTransferDto.from_location_id,
          to_location_id: createTransferDto.to_location_id,
          notes: createTransferDto.notes,
          transfer_number: transferNumber,
          transfer_date: new Date(),
          expected_date: createTransferDto.expected_date,
          created_by_user_id: context.user_id,
          approved_by_user_id: context.user_id,
          completed_date: new Date(),
          status: transfer_status_enum.completed,
          stock_transfer_items: {
            create: createTransferDto.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity: item.quantity,
              quantity_received: item.quantity,
              notes: item.notes,
            })),
          },
        },
        include: {
          from_location: true,
          to_location: true,
          stock_transfer_items: true,
        },
      });

      // Move stock using StockLevelManager
      for (const item of stockTransfer.stock_transfer_items) {
        const sourceStockUpdate = await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: stockTransfer.from_location_id,
            quantity_change: -item.quantity,
            movement_type: 'transfer',
            reason: `Stock transfer ${stockTransfer.transfer_number} - source`,
            user_id: context?.user_id,
            create_movement: true,
            from_location_id: stockTransfer.from_location_id,
            to_location_id: stockTransfer.to_location_id,
          },
          tx,
        );

        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: stockTransfer.to_location_id,
            quantity_change: item.quantity,
            movement_type: 'transfer',
            reason: `Stock transfer ${stockTransfer.transfer_number} - destination`,
            user_id: context?.user_id,
            create_movement: true,
            from_location_id: stockTransfer.from_location_id,
            to_location_id: stockTransfer.to_location_id,
            unit_cost: Number(sourceStockUpdate.cost_snapshot?.unit_cost || 0),
          },
          tx,
        );
      }

      return tx.stock_transfers.findUnique({
        where: { id: stockTransfer.id },
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

    // Emit accounting event for completed stock transfer
    this.event_emitter.emit('stock_transfer.completed', {
      transfer_id: result.id,
      transfer_number: result.transfer_number,
      organization_id: result.organization_id,
      store_id:
        result.from_location?.store_id === result.to_location?.store_id
          ? result.from_location?.store_id
          : undefined,
      from_location_id: result.from_location_id,
      to_location_id: result.to_location_id,
      total_cost: await this.calculateTransferTotalCost(
        result.stock_transfer_items,
        result.from_location_id,
        (item) => Number(item.quantity || 0),
      ),
      user_id: RequestContextService.getUserId(),
    });

    return result;
  }

  findAll(query: TransferQueryDto) {
    const where: any = {
      from_location_id: query.from_location_id,
      to_location_id: query.to_location_id,
      status: query.status,
    };

    if (query.transfer_date_from || query.transfer_date_to) {
      where.transfer_date = {};
      if (query.transfer_date_from) {
        where.transfer_date.gte = query.transfer_date_from;
      }
      if (query.transfer_date_to) {
        where.transfer_date.lte = query.transfer_date_to;
      }
    }

    if (query.search) {
      where.OR = [
        { transfer_number: { contains: query.search } },
        { reference_number: { contains: query.search } },
        { reason: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

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

      await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      if (stockTransfer.status !== transfer_status_enum.draft) {
        throw new BadRequestException('Only draft transfers can be approved');
      }

      const context = RequestContextService.getContext();

      // Reserve stock at source location using StockLevelManager
      for (const item of stockTransfer.stock_transfer_items) {
        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id ?? undefined,
          stockTransfer.from_location_id,
          item.quantity,
          'transfer',
          stockTransfer.id,
          context?.user_id,
          true,
          tx,
        );
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.in_transit,
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

  async complete(
    id: number,
    items: Array<{ id: number; quantity_received: number }>,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        await tx.stock_transfer_items.update({
          where: { id: item.id },
          data: {
            quantity_received: item.quantity_received,
          },
        });
      }

      const stockTransfer = await tx.stock_transfers.findUnique({
        where: { id },
        include: { stock_transfer_items: true },
      });

      const transferScope = await this.validateTransferScope(
        stockTransfer.organization_id,
        stockTransfer.from_location_id,
        stockTransfer.to_location_id,
        tx,
      );

      const context = RequestContextService.getContext();

      for (const item of stockTransfer.stock_transfer_items) {
        const receivedItem = items.find((i) => i.id === item.id);
        if (receivedItem && receivedItem.quantity_received > 0) {
          // Subtract from source
          const sourceStockUpdate = await this.stockLevelManager.updateStock(
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id: stockTransfer.from_location_id,
              quantity_change: -receivedItem.quantity_received,
              movement_type: 'transfer',
              reason: `Stock transfer ${stockTransfer.transfer_number} - source`,
              user_id: context?.user_id,
              create_movement: true,
              from_location_id: stockTransfer.from_location_id,
              to_location_id: stockTransfer.to_location_id,
            },
            tx,
          );

          // Add to destination
          await this.stockLevelManager.updateStock(
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id: stockTransfer.to_location_id,
              quantity_change: receivedItem.quantity_received,
              movement_type: 'transfer',
              reason: `Stock transfer ${stockTransfer.transfer_number} - destination`,
              user_id: context?.user_id,
              create_movement: true,
              from_location_id: stockTransfer.from_location_id,
              to_location_id: stockTransfer.to_location_id,
              unit_cost: Number(
                sourceStockUpdate.cost_snapshot?.unit_cost || 0,
              ),
            },
            tx,
          );
        }
      }

      // Release reservations created during approve
      await this.stockLevelManager.releaseReservationsByReference(
        'transfer',
        stockTransfer.id,
        'consumed',
        tx,
        { decrementOnHand: false },
      );

      const allItemsReceived = stockTransfer.stock_transfer_items.every(
        (item) => {
          const receivedItem = items.find((i) => i.id === item.id);
          return (
            receivedItem && receivedItem.quantity_received >= item.quantity
          );
        },
      );

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

    // Emit accounting event only if transfer is fully completed
    if (result.status === transfer_status_enum.completed) {
      this.event_emitter.emit('stock_transfer.completed', {
        transfer_id: result.id,
        transfer_number: result.transfer_number,
        organization_id: result.organization_id,
        store_id:
          result.from_location?.store_id === result.to_location?.store_id
            ? result.from_location?.store_id
            : undefined,
        from_location_id: result.from_location_id,
        to_location_id: result.to_location_id,
        total_cost: await this.calculateTransferTotalCost(
          result.stock_transfer_items,
          result.from_location_id,
          (item) => Number(item.quantity_received || 0),
        ),
        user_id: RequestContextService.getUserId(),
      });
    }

    return result;
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

      // Release any reservations if transfer was in_transit
      if (stockTransfer.status === transfer_status_enum.in_transit) {
        await this.stockLevelManager.releaseReservationsByReference(
          'transfer',
          stockTransfer.id,
          'cancelled',
          tx,
        );
      }

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.cancelled,
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

  async searchTransferableProducts(
    search: string,
    fromLocationId: number,
    toLocationId: number,
    limit = 10,
  ) {
    const products = await this.prisma.products.findMany({
      where: {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ],
        stock_levels: {
          some: { location_id: fromLocationId },
        },
      },
      select: {
        id: true,
        name: true,
        sku: true,
        stock_levels: {
          where: {
            location_id: { in: [fromLocationId, toLocationId] },
          },
          select: {
            location_id: true,
            quantity_on_hand: true,
            quantity_reserved: true,
            quantity_available: true,
          },
        },
      },
      take: limit,
    });

    const defaultStock = {
      quantity_on_hand: 0,
      quantity_reserved: 0,
      quantity_available: 0,
    };

    return products.map((p) => {
      const originStock = p.stock_levels.find(
        (sl) => sl.location_id === fromLocationId,
      );
      const destStock = p.stock_levels.find(
        (sl) => sl.location_id === toLocationId,
      );
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        stock_at_origin: originStock
          ? {
              quantity_on_hand: originStock.quantity_on_hand,
              quantity_reserved: originStock.quantity_reserved,
              quantity_available: originStock.quantity_available,
            }
          : defaultStock,
        stock_at_destination: destStock
          ? {
              quantity_on_hand: destStock.quantity_on_hand,
              quantity_reserved: destStock.quantity_reserved,
              quantity_available: destStock.quantity_available,
            }
          : defaultStock,
      };
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
}
