import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import {
  CreateAdjustmentDto,
  AdjustmentQueryDto,
  InventoryAdjustment,
  AdjustmentResponse,
  AdjustmentType,
} from './interfaces/inventory-adjustment.interface';
import { InventoryTransactionsService } from '../transactions/inventory-transactions.service';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';

// Common include object for adjustment queries
const ADJUSTMENT_INCLUDE = {
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
      name: true,
    },
  },
  inventory_locations: {
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
    },
  },
  inventory_batches: {
    select: {
      id: true,
      batch_number: true,
      expiration_date: true,
      quantity: true,
      quantity_used: true,
    },
  },
  organizations: {
    select: {
      id: true,
      name: true,
    },
  },
  users_inventory_adjustments_created_by_user_idTousers: {
    select: {
      id: true,
      username: true,
      email: true,
    },
  },
  users_inventory_adjustments_approved_by_user_idTousers: {
    select: {
      id: true,
      username: true,
      email: true,
    },
  },
};

// Map transaction type based on adjustment type
// Note: Only 'adjustment_damage', 'damage', and 'expiration' are valid transaction types
const getTransactionType = (
  adjustmentType: AdjustmentType,
): 'adjustment_damage' | 'damage' | 'expiration' => {
  if (adjustmentType === 'damage') return 'damage';
  if (adjustmentType === 'expiration') return 'expiration';
  return 'adjustment_damage'; // Default for loss, theft, count_variance, manual_correction
};

@Injectable()
export class InventoryAdjustmentsService {
  constructor(
    private prisma: StorePrismaService,
    private transactionsService: InventoryTransactionsService,
    private stockLevelManager: StockLevelManager,
  ) {}

  /**
   * Crea un ajuste de inventario
   * Soporta ajuste a nivel de bodega o a nivel de lote específico
   */
  async createAdjustment(
    data: CreateAdjustmentDto,
  ): Promise<InventoryAdjustment> {
    const orgIdRaw = RequestContextService.getOrganizationId();
    const userIdRaw = RequestContextService.getUserId();

    if (!orgIdRaw) {
      throw new BadRequestException('Organization context is required');
    }

    const organizationId = Number(orgIdRaw);
    const userId = userIdRaw ? Number(userIdRaw) : null;

    if (isNaN(organizationId)) {
      throw new BadRequestException('Invalid organization ID in context');
    }

    return await this.prisma.$transaction(async (prisma) => {
      // Ensure IDs are numbers (handling string payload from frontend)
      const productId = Number(data.product_id);
      const locationId = Number(data.location_id);
      const variantId = data.product_variant_id
        ? Number(data.product_variant_id)
        : null;
      const batchId = data.batch_id ? Number(data.batch_id) : null;
      const quantityAfter = Number(data.quantity_after);

      // 1. Validar que el adjustment_type sea válido
      const validTypes: AdjustmentType[] = [
        'damage',
        'loss',
        'theft',
        'expiration',
        'count_variance',
        'manual_correction',
      ];
      if (!validTypes.includes(data.type)) {
        throw new BadRequestException(`Invalid adjustment type: ${data.type}`);
      }

      let quantityBefore: number;
      let quantityChange: number;

      // 2. Determinar la cantidad actual según si es ajuste de lote o de stock general
      if (batchId) {
        // Ajuste a nivel de LOTE
        const batch = await prisma.inventory_batches.findUnique({
          where: { id: batchId },
        });

        if (!batch) {
          throw new NotFoundException(`Batch with ID ${batchId} not found`);
        }

        if (batch.product_id !== productId) {
          throw new BadRequestException(
            'Batch does not belong to the specified product',
          );
        }

        if (batch.location_id !== locationId) {
          throw new BadRequestException(
            'Batch does not belong to the specified location',
          );
        }

        // Cantidad actual del lote (quantity - quantity_used)
        quantityBefore = batch.quantity - batch.quantity_used;
        quantityChange = quantityAfter - quantityBefore;

        // Actualizar el lote
        const newQuantity = batch.quantity + quantityChange;
        if (newQuantity < batch.quantity_used) {
          throw new BadRequestException(
            'Cannot reduce batch quantity below used amount',
          );
        }

        await prisma.inventory_batches.update({
          where: { id: batchId },
          data: {
            quantity: newQuantity,
            updated_at: new Date(),
          },
        });
      } else {
        // Ajuste a nivel de STOCK GENERAL (bodega)
        // Usamos findFirst porque el índice único incluye product_variant_id que es nullable
        const currentStockLevel = await prisma.stock_levels.findFirst({
          where: {
            product_id: productId,
            product_variant_id: variantId, // null se maneja correctamente con findFirst
            location_id: locationId,
          },
        });

        if (!currentStockLevel) {
          throw new NotFoundException(
            'Stock level not found for this product/location combination',
          );
        }

        quantityBefore = currentStockLevel.quantity_on_hand;
        quantityChange = quantityAfter - quantityBefore;
      }

      // 3. Crear registro de ajuste
      const adjustment = await prisma.inventory_adjustments.create({
        data: {
          organization_id: organizationId,
          product_id: productId,
          product_variant_id: variantId,
          location_id: locationId,
          batch_id: batchId,
          adjustment_type: data.type as any,
          quantity_before: quantityBefore,
          quantity_after: quantityAfter,
          quantity_change: quantityChange,
          reason_code: data.reason_code || null,
          description: data.description || null,
          created_by_user_id: userId ?? null,
          approved_by_user_id: data.approved_by_user_id
            ? Number(data.approved_by_user_id)
            : null,
          approved_at: data.approved_by_user_id ? new Date() : null,
          created_at: new Date(),
        },
        include: ADJUSTMENT_INCLUDE,
      });

      // 4. Actualizar stock levels (siempre, tanto para lote como para stock general)
      await this.stockLevelManager.updateStock({
        product_id: productId,
        variant_id: variantId ?? undefined,
        location_id: locationId,
        quantity_change: quantityChange,
        movement_type: 'adjustment',
        reason: `Adjustment: ${data.type}${batchId ? ` (Batch ID: ${batchId})` : ''} - ${data.description || 'No description'}`,
        user_id: userId || undefined,
        create_movement: true,
        validate_availability: false,
      });

      // 5. Crear inventory transaction
      await this.transactionsService.createTransaction({
        productId: productId,
        variantId: variantId ?? undefined,
        type: getTransactionType(data.type),
        quantityChange: quantityChange,
        reason: `Inventory adjustment: ${data.type}${batchId ? ` (Batch: ${batchId})` : ''}`,
        userId: userId || undefined,
      });

      // 6. Transformar respuesta para mapear nombres de relaciones
      return this.mapAdjustmentResponse(adjustment);
    });
  }

  /**
   * Mapea la respuesta del ajuste para normalizar nombres de relaciones
   */
  private mapAdjustmentResponse(adjustment: any): InventoryAdjustment {
    const createdBy =
      adjustment.users_inventory_adjustments_created_by_user_idTousers;
    const approvedBy =
      adjustment.users_inventory_adjustments_approved_by_user_idTousers;

    return {
      ...adjustment,
      created_by_user: createdBy
        ? {
            id: createdBy.id,
            user_name: createdBy.username,
            email: createdBy.email,
          }
        : null,
      approved_by_user: approvedBy
        ? {
            id: approvedBy.id,
            user_name: approvedBy.username,
            email: approvedBy.email,
          }
        : null,
    };
  }

  /**
   * Aprueba un ajuste de inventario
   */
  async approveAdjustment(
    adjustmentId: number,
    approvedByUserId: number,
  ): Promise<InventoryAdjustment> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id: adjustmentId },
    });

    if (!adjustment) {
      throw new NotFoundException(
        `Adjustment with ID ${adjustmentId} not found`,
      );
    }

    if (adjustment.approved_by_user_id) {
      throw new ConflictException('Adjustment already approved');
    }

    const updated = await this.prisma.inventory_adjustments.update({
      where: { id: adjustmentId },
      data: {
        approved_by_user_id: approvedByUserId,
        approved_at: new Date(),
      },
      include: ADJUSTMENT_INCLUDE,
    });

    return this.mapAdjustmentResponse(updated);
  }

  /**
   * Obtiene ajustes con filtros
   */
  async getAdjustments(query: AdjustmentQueryDto): Promise<AdjustmentResponse> {
    const where = {
      ...(query.organizationId && { organization_id: query.organizationId }),
      ...(query.productId && { product_id: query.productId }),
      ...(query.variantId && { product_variant_id: query.variantId }),
      ...(query.locationId && { location_id: query.locationId }),
      ...(query.batchId && { batch_id: query.batchId }),
      ...(query.type && { adjustment_type: query.type }),
      ...(query.status && {
        approved_by_user_id: query.status === 'approved' ? { not: null } : null,
      }),
      ...(query.createdByUserId && {
        created_by_user_id: query.createdByUserId,
      }),
      ...(query.startDate && {
        created_at: {
          gte: query.startDate,
        },
      }),
      ...(query.endDate && {
        created_at: {
          lte: query.endDate,
        },
      }),
    };

    const [adjustments, total] = await Promise.all([
      this.prisma.inventory_adjustments.findMany({
        where,
        include: ADJUSTMENT_INCLUDE,
        orderBy: { created_at: 'desc' },
        skip: Number(query.offset) || 0,
        take: Number(query.limit) || 50,
      }),
      this.prisma.inventory_adjustments.count({ where }),
    ]);

    return {
      adjustments: adjustments.map((a) => this.mapAdjustmentResponse(a)),
      total,
      hasMore: (Number(query.offset) || 0) + adjustments.length < total,
    };
  }

  /**
   * Obtiene un ajuste por ID con información completa
   */
  async getAdjustmentById(id: number): Promise<InventoryAdjustment> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id },
      include: ADJUSTMENT_INCLUDE,
    });

    if (!adjustment) {
      throw new NotFoundException(`Adjustment with ID ${id} not found`);
    }

    return this.mapAdjustmentResponse(adjustment);
  }

  /**
   * Obtiene resumen de ajustes por tipo
   */
  async getAdjustmentSummary(
    organizationId: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const where = {
      organization_id: organizationId,
      ...(startDate &&
        endDate && {
          created_at: {
            gte: startDate,
            lte: endDate,
          },
        }),
    };

    const summary = await this.prisma.inventory_adjustments.groupBy({
      by: ['adjustment_type'],
      where,
      _sum: {
        quantity_change: true,
      },
      _count: {
        id: true,
      },
    });

    return summary.map((item) => ({
      type: item.adjustment_type,
      totalQuantity: Math.abs(item._sum.quantity_change || 0),
      adjustmentCount: item._count.id,
    }));
  }

  /**
   * Elimina un ajuste (solo si no está aprobado)
   */
  async deleteAdjustment(id: number): Promise<void> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id },
    });

    if (!adjustment) {
      throw new NotFoundException(`Adjustment with ID ${id} not found`);
    }

    if (adjustment.approved_by_user_id) {
      throw new ConflictException('Cannot delete approved adjustment');
    }

    await this.prisma.inventory_adjustments.delete({
      where: { id },
    });
  }
}
