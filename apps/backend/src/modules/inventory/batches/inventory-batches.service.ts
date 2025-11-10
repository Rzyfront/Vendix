import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateBatchDto,
  BatchQueryDto,
  InventoryBatch,
  BatchResponse,
  BatchExpiringItem,
} from './interfaces/inventory-batch.interface';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';

@Injectable()
export class InventoryBatchesService {
  constructor(
    private prisma: PrismaService,
    private stockLevelManager: StockLevelManager,
  ) {}

  /**
   * Crea un nuevo batch de inventario
   */
  async createBatch(createBatchDto: CreateBatchDto): Promise<InventoryBatch> {
    return await this.prisma.$transaction(async (prisma) => {
      // 1. Validar que el batch number sea único para el producto
      const existingBatch = await prisma.inventory_batches.findFirst({
        where: {
          product_id: createBatchDto.productId,
          batch_number: createBatchDto.batchNumber,
        },
      });

      if (existingBatch) {
        throw new ConflictException(
          `Batch number ${createBatchDto.batchNumber} already exists for this product`,
        );
      }

      // 2. Validar fechas
      if (createBatchDto.expirationDate && createBatchDto.manufacturingDate) {
        if (createBatchDto.expirationDate <= createBatchDto.manufacturingDate) {
          throw new BadRequestException(
            'Expiration date must be after manufacturing date',
          );
        }
      }

      // 3. Crear batch
      const batch = await prisma.inventory_batches.create({
        data: {
          product_id: createBatchDto.productId,
          product_variant_id: createBatchDto.variantId,
          batch_number: createBatchDto.batchNumber,
          quantity: createBatchDto.quantity,
          manufacturing_date: createBatchDto.manufacturingDate,
          expiration_date: createBatchDto.expirationDate,
          location_id: createBatchDto.locationId,
          created_at: new Date(),
          updated_at: new Date(),
        },
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
            },
          },
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      // 4. Actualizar stock levels
      await this.stockLevelManager.updateStock({
        productId: createBatchDto.productId,
        variantId: createBatchDto.variantId,
        locationId: createBatchDto.locationId,
        quantityChange: createBatchDto.quantity,
        movementType: 'stock_in',
        reason: `Batch ${createBatchDto.batchNumber} received`,
        userId: createBatchDto.userId,
        createMovement: true,
        validateAvailability: false,
      });

      return batch;
    });
  }

  /**
   * Obtiene batches con filtros
   */
  async getBatches(query: BatchQueryDto): Promise<BatchResponse> {
    const where = {
      ...(query.productId && { product_id: query.productId }),
      ...(query.variantId && { product_variant_id: query.variantId }),
      ...(query.locationId && { location_id: query.locationId }),
      ...(query.batchNumber && {
        batch_number: { contains: query.batchNumber, mode: 'insensitive' },
      }),
      ...(query.status && {
        quantity: query.status === 'active' ? { gt: 0 } : { lte: 0 },
      }),
      ...(query.expiring && {
        expiration_date: {
          lte: new Date(Date.now() + query.expiring * 24 * 60 * 60 * 1000),
        },
      }),
      ...(query.manufacturingDate && {
        manufacturing_date: {
          gte: query.manufacturingDate,
        },
      }),
      ...(query.expirationDate && {
        expiration_date: {
          lte: query.expirationDate,
        },
      }),
    };

    const [batches, total] = await Promise.all([
      this.prisma.inventory_batches.findMany({
        where,
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
            },
          },
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          inventory_serial_numbers: {
            select: {
              id: true,
            },
          },
          _count: {
            select: {
              inventory_serial_numbers: true,
            },
          },
        },
        orderBy: [
          { expiration_date: 'asc' }, // Los que expiran primero
          { created_at: 'desc' },
        ],
        skip: query.offset || 0,
        take: query.limit || 50,
      }),
      this.prisma.inventory_batches.count({ where }),
    ]);

    return {
      batches,
      total,
      hasMore: (query.offset || 0) + batches.length < total,
    };
  }

  /**
   * Obtiene un batch por ID
   */
  async getBatchById(id: number): Promise<InventoryBatch> {
    const batch = await this.prisma.inventory_batches.findUnique({
      where: { id },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        product_variants: {
          select: {
            id: true,
            sku: true,
          },
        },
        inventory_locations: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        inventory_serial_numbers: {
          include: {
            products: {
              select: {
                name: true,
                sku: true,
              },
            },
          },
          orderBy: { serial_number: 'asc' },
        },
        _count: {
          select: {
            inventory_serial_numbers: true,
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID ${id} not found`);
    }

    return batch;
  }

  /**
   * Obtiene batches que están por expirar
   */
  async getExpiringBatches(
    daysAhead: number = 30,
  ): Promise<BatchExpiringItem[]> {
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + daysAhead);

    const batches = await this.prisma.inventory_batches.findMany({
      where: {
        expiration_date: {
          lte: expirationDate,
          gte: new Date(), // Solo batches que no han expirado aún
        },
        quantity: {
          gt: 0,
        },
      },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        product_variants: {
          select: {
            id: true,
            sku: true,
          },
        },
        inventory_locations: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: { expiration_date: 'asc' },
    });

    return batches.map((batch) => ({
      ...batch,
      daysToExpiration: Math.ceil(
        (batch.expiration_date.getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    }));
  }

  /**
   * Obtiene batches expirados
   */
  async getExpiredBatches(): Promise<InventoryBatch[]> {
    return await this.prisma.inventory_batches.findMany({
      where: {
        expiration_date: {
          lt: new Date(),
        },
        quantity: {
          gt: 0,
        },
      },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        product_variants: {
          select: {
            id: true,
            sku: true,
          },
        },
        inventory_locations: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: { expiration_date: 'asc' },
    });
  }

  /**
   * Actualiza la cantidad usada de un batch
   */
  async updateBatchQuantity(
    batchId: number,
    quantityUsed: number,
    userId?: number,
  ): Promise<InventoryBatch> {
    const batch = await this.prisma.inventory_batches.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }

    if (batch.quantity_used + quantityUsed > batch.quantity) {
      throw new BadRequestException(
        'Cannot use more quantity than available in batch',
      );
    }

    return await this.prisma.$transaction(async (prisma) => {
      const updatedBatch = await prisma.inventory_batches.update({
        where: { id: batchId },
        data: {
          quantity_used: batch.quantity_used + quantityUsed,
          updated_at: new Date(),
        },
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
            },
          },
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      // Actualizar stock levels (reducir stock)
      await this.stockLevelManager.updateStock({
        productId: batch.product_id,
        variantId: batch.product_variant_id,
        locationId: batch.location_id,
        quantityChange: -quantityUsed,
        movementType: 'sale',
        reason: `Batch ${batch.batch_number} quantity used`,
        userId: userId,
        createMovement: true,
        validateAvailability: true,
      });

      return updatedBatch;
    });
  }

  /**
   * Transfiere un batch a otra ubicación
   */
  async transferBatch(
    batchId: number,
    toLocationId: number,
    quantity: number,
    userId?: number,
  ): Promise<InventoryBatch> {
    const batch = await this.prisma.inventory_batches.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID ${batchId} not found`);
    }

    if (batch.quantity - batch.quantity_used < quantity) {
      throw new BadRequestException(
        'Insufficient quantity available for transfer',
      );
    }

    return await this.prisma.$transaction(async (prisma) => {
      // Crear nuevo batch en la ubicación de destino
      const newBatch = await prisma.inventory_batches.create({
        data: {
          product_id: batch.product_id,
          product_variant_id: batch.product_variant_id,
          batch_number: `${batch.batch_number}-TRANSFER-${Date.now()}`,
          quantity: quantity,
          manufacturing_date: batch.manufacturing_date,
          expiration_date: batch.expiration_date,
          location_id: toLocationId,
          created_at: new Date(),
          updated_at: new Date(),
        },
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
            },
          },
          inventory_locations: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      // Actualizar batch original (reducir cantidad)
      await prisma.inventory_batches.update({
        where: { id: batchId },
        data: {
          quantity: batch.quantity - quantity,
          updated_at: new Date(),
        },
      });

      // Crear movimiento de stock (salida de ubicación original)
      await this.stockLevelManager.updateStock({
        productId: batch.product_id,
        variantId: batch.product_variant_id,
        locationId: batch.location_id,
        quantityChange: -quantity,
        movementType: 'transfer',
        reason: `Batch ${batch.batch_number} transferred out`,
        userId: userId,
        createMovement: true,
        validateAvailability: true,
        fromLocationId: batch.location_id,
        toLocationId: toLocationId,
      });

      // Crear movimiento de stock (entrada a ubicación destino)
      await this.stockLevelManager.updateStock({
        productId: batch.product_id,
        variantId: batch.product_variant_id,
        locationId: toLocationId,
        quantityChange: quantity,
        movementType: 'transfer',
        reason: `Batch ${batch.batch_number} transferred in`,
        userId: userId,
        createMovement: true,
        validateAvailability: false,
        fromLocationId: batch.location_id,
        toLocationId: toLocationId,
      });

      return newBatch;
    });
  }

  /**
   * Elimina un batch (solo si no tiene cantidad)
   */
  async deleteBatch(id: number): Promise<void> {
    const batch = await this.prisma.inventory_batches.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            inventory_serial_numbers: true,
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID ${id} not found`);
    }

    if (batch.quantity > 0 || batch._count.inventory_serial_numbers > 0) {
      throw new ConflictException(
        'Cannot delete batch with remaining quantity or serial numbers',
      );
    }

    await this.prisma.inventory_batches.delete({
      where: { id },
    });
  }

  /**
   * Obtiene resumen de batches por producto
   */
  async getBatchSummary(productId?: number): Promise<any> {
    const where = productId ? { product_id: productId } : {};

    const summary = await this.prisma.inventory_batches.groupBy({
      by: ['product_id'],
      where: {
        ...where,
        quantity: { gt: 0 },
      },
      _sum: {
        quantity: true,
        quantity_used: true,
      },
      _count: {
        id: true,
      },
    });

    return await Promise.all(
      summary.map(async (item) => {
        const product = await this.prisma.products.findUnique({
          where: { id: item.product_id },
          select: { id: true, name: true, sku: true },
        });

        return {
          productId: item.product_id,
          product,
          totalBatches: item._count.id,
          totalQuantity: item._sum.quantity || 0,
          totalUsed: item._sum.quantity_used || 0,
          availableQuantity:
            (item._sum.quantity || 0) - (item._sum.quantity_used || 0),
        };
      }),
    );
  }
}
