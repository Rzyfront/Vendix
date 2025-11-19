import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateInventorySerialNumberDto } from '../dto/create-inventory-serial-number.dto';
import { UpdateInventorySerialNumberDto } from '../dto/create-inventory-serial-number.dto';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '../../../common/context/request-context.service';

// Using local enum definitions until Prisma client is regenerated
enum InventoryTransactionType {
  STOCK_IN = 'stock_in',
  STOCK_OUT = 'stock_out',
  SALE = 'sale',
  RETURN = 'return',
  TRANSFER_IN = 'transfer_in',
  TRANSFER_OUT = 'transfer_out',
  ADJUSTMENT_IN = 'adjustment_in',
  ADJUSTMENT_OUT = 'adjustment_out',
  ADJUSTMENT_DAMAGE = 'adjustment_damage',
  INITIAL = 'initial',
}

enum SerialNumberStatus {
  IN_STOCK = 'in_stock',
  RESERVED = 'reserved',
  SOLD = 'sold',
  RETURNED = 'returned',
  DAMAGED = 'damaged',
  EXPIRED = 'expired',
  IN_TRANSIT = 'in_transit',
}

@Injectable()
export class InventorySerialNumbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create serial numbers for a batch
   */
  async createSerialNumbersForBatch(
    batch_id: string,
    serial_numbers: string[],
    organization_id?: string,
  ) {
    // Obtener contexto de organización
    const context = RequestContextService.getContext();
    const target_organization_id = context?.organization_id || organization_id;

    if (!target_organization_id && !context?.is_super_admin) {
      throw new BadRequestException('Organization context is required');
    }

    // Verify batch exists and belongs to organization
    const batch = await this.prisma.inventory_batches.findFirst({
      where: {
        id: batch_id,
        ...(!context?.is_super_admin && { organization_id: target_organization_id }),
      },
    });

    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    // Check if serial numbers already exist
    const existing_serials = await this.prisma.inventory_serial_numbers.findMany(
      {
        where: {
          serial_number: {
            in: serial_numbers,
          },
          ...(!context?.is_super_admin && { organization_id: target_organization_id }),
        },
      },
    );

    if (existing_serials.length > 0) {
      const existing_numbers = existing_serials.map((s) => s.serial_number);
      throw new ConflictException(
        `Serial numbers already exist: ${existing_numbers.join(', ')}`,
      );
    }

    // Create serial numbers
    const serial_numbers_data = serial_numbers.map((serial_number) => ({
      serial_number: serial_number,
      batch_id: batch_id,
      product_id: batch.product_id,
      product_variant_id: batch.product_variant_id,
      status: SerialNumberStatus.IN_STOCK,
      location_id: batch.location_id,
      cost: batch.unit_cost,
    }));

    // Validate serial_numbers_data before mapping to prevent transaction errors
    const valid_serial_numbers_data = serial_numbers_data.filter(
      (data) => data != null && data.serial_number,
    );

    if (valid_serial_numbers_data.length === 0) {
      throw new BadRequestException('No valid serial numbers data provided');
    }

    const created_serials = await this.prisma.$transaction(
      valid_serial_numbers_data.map((data) =>
        this.prisma.inventory_serial_numbers.create({
          data,
        }),
      ),
    );

    // Emit event
    this.eventEmitter.emit('inventory.serial-numbers.created', {
      batch_id,
      serial_numbers: created_serials,
      organization_id: target_organization_id,
    });

    return created_serials;
  }

  /**
   * Get serial number by ID
   */
  async getSerialNumberById(id: string, organization_id?: string) {
    const context = RequestContextService.getContext();
    const target_organization_id = context?.organization_id || organization_id;

    const serial_number = await this.prisma.inventory_serial_numbers.findFirst({
      where: {
        id,
        // Aplicar scope a través de producto o ubicación
        ...(context?.is_super_admin ? {} : {
          OR: [
            {
              products: {
                stores: {
                  organization_id: target_organization_id,
                },
              },
            },
            {
              inventory_locations: {
                organization_id: target_organization_id,
              },
            },
          ],
        }),
      },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
            stores: {
              select: {
                organization_id: true,
              },
            },
          },
        },
        product_variants: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        inventory_batches: {
          select: {
            id: true,
            batch_number: true,
            expiration_date: true,
          },
        },
        inventory_locations: {
          select: {
            id: true,
            name: true,
            organization_id: true,
          },
        },
      },
    });

    if (!serial_number) {
      throw new NotFoundException('Serial number not found');
    }

    return serial_number;
  }

  /**
   * Get serial number by serial number string
   */
  async getSerialNumberByNumber(serialNumber: string, organizationId: string) {
    return this.getSerialNumberByNumberWithIncludes(
      serialNumber,
      organizationId,
    );
  }

  private async getSerialNumberByNumberWithIncludes(
    serialNumber: string,
    organizationId: string,
  ) {
    const serial = await this.prisma.inventory_serial_numbers.findFirst({
      where: {
        serialNumber,
        organizationId,
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        productVariant: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!serial) {
      throw new NotFoundException('Serial number not found');
    }

    return serial;
  }

  /**
   * Get all serial numbers for an organization
   */
  async getSerialNumbers(
    organizationId: string,
    filters?: {
      productId?: string;
      productVariantId?: string;
      batchId?: string;
      locationId?: string;
      status?: SerialNumberStatus;
      search?: string;
    },
  ) {
    const where: any = {
      organizationId,
    };

    if (filters?.productId) {
      where.productId = filters.productId;
    }

    if (filters?.productVariantId) {
      where.productVariantId = filters.productVariantId;
    }

    if (filters?.batchId) {
      where.batchId = filters.batchId;
    }

    if (filters?.locationId) {
      where.locationId = filters.locationId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.search) {
      where.OR = [
        {
          serialNumber: {
            contains: filters.search,
            mode: 'insensitive',
          },
        },
        {
          product: {
            name: {
              contains: filters.search,
              mode: 'insensitive',
            },
          },
        },
        {
          product: {
            sku: {
              contains: filters.search,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    return this.prisma.inventory_serial_numbers.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        productVariant: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Update serial number status
   */
  async updateSerialNumberStatus(
    id: string,
    status: SerialNumberStatus,
    organizationId: string,
    metadata?: {
      salesOrderId?: string;
      purchaseOrderId?: string;
      locationId?: string;
      notes?: string;
    },
  ) {
    const serialNumber = await this.prisma.inventory_serial_numbers.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!serialNumber) {
      throw new NotFoundException('Serial number not found');
    }

    const updateData: any = {
      status,
    };

    if (metadata?.locationId) {
      updateData.locationId = metadata.locationId;
    }

    if (metadata?.notes) {
      updateData.notes = metadata.notes;
    }

    const updatedSerial = await this.prisma.$transaction(async (tx) => {
      // Update serial number
      const updated = await tx.inventory_serial_numbers.update({
        where: { id },
        data: updateData,
      });

      // Create inventory transaction for status change
      let transactionType: InventoryTransactionType;
      let quantity = 0;

      switch (status) {
        case SerialNumberStatus.SOLD:
          transactionType = InventoryTransactionType.SALE;
          quantity = -1;
          break;
        case SerialNumberStatus.RETURNED:
          transactionType = InventoryTransactionType.RETURN;
          quantity = 1;
          break;
        case SerialNumberStatus.DAMAGED:
          transactionType = InventoryTransactionType.ADJUSTMENT_DAMAGE;
          quantity = -1;
          break;
        case SerialNumberStatus.IN_TRANSIT:
          transactionType = InventoryTransactionType.STOCK_OUT;
          quantity = -1;
          break;
        default:
          transactionType = InventoryTransactionType.ADJUSTMENT_IN;
          quantity = 1;
      }

      await tx.inventory_transactions.create({
        data: {
          productId: serialNumber.productId,
          productVariantId: serialNumber.productVariantId,
          locationId: metadata?.locationId || serialNumber.locationId,
          organizationId,
          transactionType,
          quantity,
          referenceType: metadata?.salesOrderId
            ? 'SALES_ORDER'
            : metadata?.purchaseOrderId
              ? 'PURCHASE_ORDER'
              : 'SERIAL_NUMBER',
          referenceId:
            metadata?.salesOrderId || metadata?.purchaseOrderId || id,
          notes: `Serial number ${serialNumber.serialNumber} status changed to ${status}${metadata?.notes ? ': ' + metadata.notes : ''}`,
          unitCost: serialNumber.cost,
          batchId: serialNumber.batchId,
          serialNumberId: id,
        },
      });

      // Update stock levels if quantity changes
      if (quantity !== 0) {
        await this.stockLevelManager.updateStock({
          product_id: serialNumber.product_id,
          variant_id: serialNumber.product_variant_id,
          location_id: metadata?.location_id || serialNumber.location_id,
          quantity_change: quantity,
          movement_type: transactionType as any,
          reason: `Serial number status change: ${status}`,
        });
      }

      return updated;
    });

    // Emit event
    this.eventEmitter.emit('inventory.serial-number.status-updated', {
      serialNumber: updatedSerial,
      previousStatus: serialNumber.status,
      newStatus: status,
      organizationId,
      metadata,
    });

    return updatedSerial;
  }

  /**
   * Transfer serial number to another location
   */
  async transferSerialNumber(
    id: string,
    targetLocationId: string,
    organizationId: string,
    notes?: string,
  ) {
    const serialNumber = await this.prisma.inventory_serial_numbers.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!serialNumber) {
      throw new NotFoundException('Serial number not found');
    }

    if (serialNumber.locationId === targetLocationId) {
      throw new ConflictException(
        'Serial number is already at the target location',
      );
    }

    const transferredSerial = await this.prisma.$transaction(async (tx) => {
      // Update serial number location and status
      const updated = await tx.inventory_serial_numbers.update({
        where: { id },
        data: {
          locationId: targetLocationId,
          status: SerialNumberStatus.IN_TRANSIT,
          notes,
        },
      });

      // Create transfer out transaction
      await tx.inventory_transactions.create({
        data: {
          productId: serialNumber.productId,
          productVariantId: serialNumber.productVariantId,
          locationId: serialNumber.locationId,
          organizationId,
          transactionType: InventoryTransactionType.STOCK_OUT,
          quantity: -1,
          referenceType: 'SERIAL_NUMBER',
          referenceId: id,
          notes: `Transfer out: ${serialNumber.serialNumber}${notes ? ' - ' + notes : ''}`,
          unitCost: serialNumber.cost,
          batchId: serialNumber.batchId,
          serialNumberId: id,
        },
      });

      // Create transfer in transaction
      await tx.inventory_transactions.create({
        data: {
          productId: serialNumber.productId,
          productVariantId: serialNumber.productVariantId,
          locationId: targetLocationId,
          organizationId,
          transactionType: InventoryTransactionType.TRANSFER_IN,
          quantity: 1,
          referenceType: 'SERIAL_NUMBER',
          referenceId: id,
          notes: `Transfer in: ${serialNumber.serialNumber}${notes ? ' - ' + notes : ''}`,
          unitCost: serialNumber.cost,
          batchId: serialNumber.batchId,
          serialNumberId: id,
        },
      });

      // Update stock levels
      await this.stockLevelManager.updateStock({
        product_id: serialNumber.product_id,
        variant_id: serialNumber.product_variant_id,
        location_id: serialNumber.location_id,
        quantity_change: -1,
        movement_type: InventoryTransactionType.STOCK_OUT,
        reason: `Transfer out: ${serialNumber.serial_number}`,
      });

      await this.stockLevelManager.updateStock({
        product_id: serialNumber.product_id,
        variant_id: serialNumber.product_variant_id,
        location_id: Number(target_location_id),
        quantity_change: 1,
        movement_type: 'transfer',
        reason: `Transfer in: ${serialNumber.serial_number}`,
      });

      return updated;
    });

    // Emit event
    this.eventEmitter.emit('inventory.serial-number.transferred', {
      serialNumber: transferredSerial,
      fromLocationId: serialNumber.locationId,
      toLocationId: targetLocationId,
      organizationId,
    });

    return transferredSerial;
  }

  /**
   * Mark serial number as sold
   */
  async markAsSold(id: string, salesOrderId: string, organizationId: string) {
    return this.updateSerialNumberStatus(
      id,
      SerialNumberStatus.SOLD,
      organizationId,
      { salesOrderId },
    );
  }

  /**
   * Mark serial number as returned
   */
  async markAsReturned(
    id: string,
    locationId: string,
    organizationId: string,
    notes?: string,
  ) {
    return this.updateSerialNumberStatus(
      id,
      SerialNumberStatus.RETURNED,
      organizationId,
      { locationId, notes },
    );
  }

  /**
   * Mark serial number as damaged
   */
  async markAsDamaged(id: string, organizationId: string, notes?: string) {
    return this.updateSerialNumberStatus(
      id,
      SerialNumberStatus.DAMAGED,
      organizationId,
      { notes },
    );
  }

  /**
   * Get serial numbers by status
   */
  async getSerialNumbersByStatus(
    status: SerialNumberStatus,
    organizationId: string,
    additionalFilters?: {
      productId?: string;
      productVariantId?: string;
      locationId?: string;
    },
  ) {
    const where: any = {
      status,
      organizationId,
    };

    if (additionalFilters?.productId) {
      where.productId = additionalFilters.productId;
    }

    if (additionalFilters?.productVariantId) {
      where.productVariantId = additionalFilters.productVariantId;
    }

    if (additionalFilters?.locationId) {
      where.locationId = additionalFilters.locationId;
    }

    return this.prisma.inventory_serial_numbers.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        productVariant: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        batch: {
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Get available serial numbers for a product/variant at a location
   */
  async getAvailableSerialNumbers(
    productId: string,
    productVariantId: string | undefined,
    locationId: string,
    organizationId: string,
  ) {
    return this.prisma.inventory_serial_numbers.findMany({
      where: {
        productId,
        productVariantId,
        locationId,
        organizationId,
        status: SerialNumberStatus.IN_STOCK,
      },
      include: {
        batch: {
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  /**
   * Delete serial number (only if not sold or in active transactions)
   */
  async deleteSerialNumber(id: string, organizationId: string) {
    const serialNumber = await this.prisma.inventory_serial_numbers.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!serialNumber) {
      throw new NotFoundException('Serial number not found');
    }

    if (serialNumber.status === SerialNumberStatus.SOLD) {
      throw new ConflictException('Cannot delete sold serial number');
    }

    await this.prisma.$transaction(async (tx) => {
      // Delete related inventory transactions
      await tx.inventoryTransaction.deleteMany({
        where: {
          serialNumberId: id,
        },
      });

      // Delete serial number
      await tx.inventory_serial_numbers.delete({
        where: { id },
      });

      // Adjust stock levels
      if (serialNumber.status === SerialNumberStatus.IN_STOCK) {
        await this.stockLevelManager.updateStock({
          product_id: serialNumber.product_id,
          variant_id: serialNumber.product_variant_id,
          location_id: serialNumber.location_id,
          quantity_change: 1,
          movement_type: 'transfer',
          reason: `Transfer in: ${serialNumber.serial_number}`,
        });
      }
    });

    // Emit event
    this.eventEmitter.emit('inventory.serial-number.deleted', {
      serialNumber,
      organizationId,
    });

    return { message: 'Serial number deleted successfully' };
  }
}
