import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CreateAdjustmentDto,
  AdjustmentQueryDto,
  InventoryAdjustment,
  AdjustmentResponse,
} from './interfaces/inventory-adjustment.interface';
import { InventoryTransactionsService } from '../transactions/inventory-transactions.service';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';

@Injectable()
export class InventoryAdjustmentsService {
  constructor(
    private prisma: StorePrismaService,
    private transactionsService: InventoryTransactionsService,
    private stockLevelManager: StockLevelManager,
  ) {}

  /**
   * Crea un ajuste de inventario
   */
  async createAdjustment(
    data: CreateAdjustmentDto,
  ): Promise<InventoryAdjustment> {
    return await this.prisma.$transaction(async (prisma) => {
      // 1. Validar stock level actual
      const currentStockLevel = await prisma.stock_levels.findUnique({
        where: {
          product_id_location_id_product_variant_id: {
            product_id: data.productId,
            location_id: data.locationId,
            product_variant_id: data.variantId || null,
          },
        },
      });

      if (!currentStockLevel) {
        throw new NotFoundException(
          'Stock level not found for this product/location combination',
        );
      }

      // 2. Validar que el adjustment_type sea válido
      const validTypes = [
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

      // 3. Calcular cambios
      const quantityChange =
        data.quantityAfter - currentStockLevel.quantity_on_hand;
      const adjustment = await prisma.inventory_adjustments.create({
        data: {
          organization_id: data.organizationId,
          product_id: data.productId,
          product_variant_id: data.variantId,
          location_id: data.locationId,
          adjustment_type: data.type,
          quantity_before: currentStockLevel.quantity_on_hand,
          quantity_after: data.quantityAfter,
          quantity_change: quantityChange,
          reason_code: data.reasonCode,
          description: data.description,
          created_by_user_id: data.createdByUserId,
          approved_by_user_id: data.approvedByUserId,
          approved_at: data.approvedByUserId ? new Date() : null,
          created_at: new Date(),
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
          organizations: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // 4. Actualizar stock levels
      await this.stockLevelManager.updateStock({
        product_id: data.productId,
        variant_id: data.variantId,
        location_id: data.locationId,
        quantity_change: quantityChange,
        movement_type: 'adjustment',
        reason: `Adjustment: ${data.type} - ${data.description}`,
        user_id: data.createdByUserId,
        create_movement: true,
        validate_availability: false,
      });

      // 5. Crear inventory transaction
      await this.transactionsService.createTransaction({
        productId: data.productId,
        variantId: data.variantId,
        type: 'adjustment_damage',
        quantityChange: quantityChange,
        reason: `Inventory adjustment: ${data.type}`,
        userId: data.createdByUserId,
      });

      return adjustment;
    });
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

    return await this.prisma.inventory_adjustments.update({
      where: { id: adjustmentId },
      data: {
        approved_by_user_id: approvedByUserId,
        approved_at: new Date(),
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
          organizations: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip: query.offset || 0,
        take: query.limit || 50,
      }),
      this.prisma.inventory_adjustments.count({ where }),
    ]);

    return {
      adjustments,
      total,
      hasMore: (query.offset || 0) + adjustments.length < total,
    };
  }

  /**
   * Obtiene un ajuste por ID
   */
  async getAdjustmentById(id: number): Promise<InventoryAdjustment> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
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
        organizations: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!adjustment) {
      throw new NotFoundException(`Adjustment with ID ${id} not found`);
    }

    return adjustment;
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
