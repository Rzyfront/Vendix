import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CreateAdjustmentDto,
  AdjustmentQueryDto,
  InventoryAdjustment,
  AdjustmentResponse,
  AdjustmentType,
} from './interfaces/inventory-adjustment.interface';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StockLevelManager } from '../shared/services/stock-level-manager.service';
import { Prisma } from '@prisma/client';

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
      store_id: true,
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

@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private eventEmitter: EventEmitter2,
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
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }

    const organizationId = Number(orgIdRaw);
    const userId = userIdRaw ? Number(userIdRaw) : null;

    if (isNaN(organizationId)) {
      throw new BadRequestException('Invalid organization ID in context');
    }

    const adjustment_result = await this.prisma.$transaction(async (prisma) => {
      // Ensure IDs are numbers (handling string payload from frontend)
      const productId = Number(data.product_id);
      const locationId = Number(data.location_id);
      const variantId = data.product_variant_id
        ? Number(data.product_variant_id)
        : null;
      const batchId = data.batch_id ? Number(data.batch_id) : null;
      const quantityAfter = Number(data.quantity_after);

      // 0. Validate location belongs to user's org (cross-tenant safety)
      await this.validateLocationScope(prisma, locationId, organizationId);

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
          throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
        }

        if (batch.product_id !== productId) {
          throw new VendixHttpException(ErrorCodes.INV_VALIDATE_001);
        }

        if (batch.location_id !== locationId) {
          throw new VendixHttpException(ErrorCodes.INV_VALIDATE_001);
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
          throw new VendixHttpException(ErrorCodes.INV_FIND_001);
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
      const stockUpdate = await this.stockLevelManager.updateStock({
        product_id: productId,
        variant_id: variantId ?? undefined,
        location_id: locationId,
        quantity_change: quantityChange,
        movement_type: 'adjustment',
        reason: `Adjustment: ${data.type}${batchId ? ` (Batch ID: ${batchId})` : ''} - ${data.description || 'No description'}`,
        user_id: userId || undefined,
        create_movement: true,
        validate_availability: false,
      }, prisma);

      // 5. Transformar respuesta para mapear nombres de relaciones
      return {
        adjustment: this.mapAdjustmentResponse(adjustment),
        quantity_change: quantityChange,
        cost_amount: Number(stockUpdate.cost_snapshot?.total_cost || 0),
      };
    });

    // Emit inventory.adjusted for accounting after successful transaction
    try {
      const cost_amount = Math.abs(Number(adjustment_result.cost_amount || 0));
      if (cost_amount > 0) {
        this.eventEmitter.emit('inventory.adjusted', {
          adjustment_id: adjustment_result.adjustment.id,
          organization_id: organizationId,
          store_id: adjustment_result.adjustment.inventory_locations?.store_id,
          quantity_change: adjustment_result.quantity_change,
          cost_amount,
          user_id: userId,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit inventory.adjusted for adjustment #${adjustment_result.adjustment.id}: ${error.message}`,
      );
    }

    return adjustment_result.adjustment;
  }

  /**
   * Valida que una bodega pertenece al organization_id del contexto.
   * Throws INV_LOCATION_SCOPE_001 (403) si no coincide — previene
   * cross-tenant stock manipulation.
   */
  private async validateLocationScope(
    prisma: Prisma.TransactionClient,
    locationId: number,
    organizationId: number,
  ): Promise<void> {
    const location = await prisma.inventory_locations.findUnique({
      where: { id: locationId },
      select: { organization_id: true },
    });
    if (!location || location.organization_id !== organizationId) {
      throw new VendixHttpException(ErrorCodes.INV_LOCATION_SCOPE_001);
    }
  }

  /**
   * Crea un ajuste atómico en una bodega (sin abrir transacción propia;
   * el caller maneja la transacción para soportar batch atómico).
   * Devuelve el adjustment creado con su quantity_change y cost_amount.
   */
  private async createAdjustmentInTx(
    prisma: Prisma.TransactionClient,
    params: {
      location_id: number;
      product_id: number;
      product_variant_id?: number;
      batch_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
      organization_id: number;
      created_by_user_id: number | null;
      approved_by_user_id?: number;
    },
  ): Promise<{
    adjustment: InventoryAdjustment;
    quantity_change: number;
    cost_amount: number;
  }> {
    const productId = Number(params.product_id);
    const locationId = Number(params.location_id);
    const variantId = params.product_variant_id
      ? Number(params.product_variant_id)
      : null;
    const batchId = params.batch_id ? Number(params.batch_id) : null;
    const quantityAfter = Number(params.quantity_after);

    // 0. Validate location belongs to user's org (cross-tenant safety)
    await this.validateLocationScope(prisma, locationId, params.organization_id);

    // 1. Validar adjustment_type
    const validTypes: AdjustmentType[] = [
      'damage',
      'loss',
      'theft',
      'expiration',
      'count_variance',
      'manual_correction',
    ];
    if (!validTypes.includes(params.type as AdjustmentType)) {
      throw new BadRequestException(
        `Invalid adjustment type: ${params.type}`,
      );
    }

    let quantityBefore: number;
    let quantityChange: number;

    if (batchId) {
      const batch = await prisma.inventory_batches.findUnique({
        where: { id: batchId },
      });
      if (!batch) {
        throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
      }
      if (batch.product_id !== productId) {
        throw new VendixHttpException(ErrorCodes.INV_VALIDATE_001);
      }
      if (batch.location_id !== locationId) {
        throw new VendixHttpException(ErrorCodes.INV_VALIDATE_001);
      }

      quantityBefore = batch.quantity - batch.quantity_used;
      quantityChange = quantityAfter - quantityBefore;
      const newQuantity = batch.quantity + quantityChange;
      if (newQuantity < batch.quantity_used) {
        throw new BadRequestException(
          'Cannot reduce batch quantity below used amount',
        );
      }
      await prisma.inventory_batches.update({
        where: { id: batchId },
        data: { quantity: newQuantity, updated_at: new Date() },
      });
    } else {
      const currentStockLevel = await prisma.stock_levels.findFirst({
        where: {
          product_id: productId,
          product_variant_id: variantId,
          location_id: locationId,
        },
      });
      if (!currentStockLevel) {
        throw new VendixHttpException(ErrorCodes.INV_FIND_001);
      }
      quantityBefore = currentStockLevel.quantity_on_hand;
      quantityChange = quantityAfter - quantityBefore;
    }

    const adjustment = await prisma.inventory_adjustments.create({
      data: {
        organization_id: params.organization_id,
        product_id: productId,
        product_variant_id: variantId,
        location_id: locationId,
        batch_id: batchId,
        adjustment_type: params.type as any,
        quantity_before: quantityBefore,
        quantity_after: quantityAfter,
        quantity_change: quantityChange,
        reason_code: params.reason_code || null,
        description: params.description || null,
        created_by_user_id: params.created_by_user_id,
        approved_by_user_id: params.approved_by_user_id
          ? Number(params.approved_by_user_id)
          : null,
        approved_at: params.approved_by_user_id ? new Date() : null,
        created_at: new Date(),
      },
      include: ADJUSTMENT_INCLUDE,
    });

    const stockUpdate = await this.stockLevelManager.updateStock(
      {
        product_id: productId,
        variant_id: variantId ?? undefined,
        location_id: locationId,
        quantity_change: quantityChange,
        movement_type: 'adjustment',
        reason: `Adjustment: ${params.type}${batchId ? ` (Batch ID: ${batchId})` : ''} - ${params.description || 'No description'}`,
        user_id: params.created_by_user_id || undefined,
        create_movement: true,
        validate_availability: false,
        // Poblamos explícitamente solo la ubicación relevante al signo:
        //   quantityChange > 0 → entrada (to_location_id)
        //   quantityChange < 0 → salida (from_location_id)
        // Así el frontend puede distinguir +/- sin parsear el reason.
        from_location_id: quantityChange < 0 ? locationId : undefined,
        to_location_id: quantityChange > 0 ? locationId : undefined,
      },
      prisma,
    );

    return {
      adjustment: this.mapAdjustmentResponse(adjustment),
      quantity_change: quantityChange,
      cost_amount: Number(stockUpdate.cost_snapshot?.total_cost || 0),
    };
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
   * Crea múltiples ajustes de inventario en batch (como borrador, sin aprobar).
   * Soporta multi-bodega: si se pasa `locationIds: number[]`, aplica
   * el mismo set de items a cada bodega en un único `prisma.$transaction`.
   * Si CUALQUIER par (location, item) falla, TODAS las bodegas hacen
   * rollback — previene estados parciales donde algunas bodegas quedan
   * ajustadas y otras no.
   */
  async batchCreateAdjustments(
    locationIds: number[],
    items: {
      product_id: number;
      product_variant_id?: number;
      batch_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
    }[],
  ): Promise<InventoryAdjustment[]> {
    return this.runMultiLocationBatch(locationIds, items, null);
  }

  /**
   * Crea múltiples ajustes y los aprueba inmediatamente.
   * Misma semántica atómica multi-bodega que `batchCreateAdjustments`.
   */
  async batchCreateAndComplete(
    locationIds: number[],
    items: {
      product_id: number;
      product_variant_id?: number;
      batch_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
    }[],
  ): Promise<InventoryAdjustment[]> {
    const userIdRaw = RequestContextService.getUserId();
    const userId = userIdRaw ? Number(userIdRaw) : null;
    return this.runMultiLocationBatch(locationIds, items, userId);
  }

  /**
   * Helper interno: ejecuta un batch multi-bodega en un único
   * `prisma.$transaction`. Si cualquier par (location × item) lanza,
   * el batch entero hace rollback. Devuelve todos los adjustments
   * creados.
   */
  private async runMultiLocationBatch(
    locationIds: number[],
    items: {
      product_id: number;
      product_variant_id?: number;
      batch_id?: number;
      type: string;
      quantity_after: number;
      reason_code?: string;
      description?: string;
    }[],
    approvedByUserId: number | null,
  ): Promise<InventoryAdjustment[]> {
    const orgIdRaw = RequestContextService.getOrganizationId();
    const userIdRaw = RequestContextService.getUserId();
    if (!orgIdRaw) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }
    const organizationId = Number(orgIdRaw);
    const userId = userIdRaw ? Number(userIdRaw) : null;

    if (!Array.isArray(locationIds) || locationIds.length === 0) {
      throw new BadRequestException(
        'locationIds must be a non-empty array (multi-warehouse mode)',
      );
    }

    return this.prisma.$transaction(async (prisma) => {
      const results: InventoryAdjustment[] = [];

      for (const locationId of locationIds) {
        for (const item of items) {
          const { adjustment } = await this.createAdjustmentInTx(prisma, {
            location_id: locationId,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id,
            batch_id: item.batch_id,
            type: item.type,
            quantity_after: item.quantity_after,
            reason_code: item.reason_code,
            description: item.description,
            organization_id: organizationId,
            created_by_user_id: userId,
            approved_by_user_id: approvedByUserId ?? undefined,
          });
          results.push(adjustment);
        }
      }

      return results;
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
      throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
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
      throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
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
   * Busca productos con stock en una ubicación para ajustes
   */
  async searchAdjustableProducts(
    search: string,
    locationId: number,
    limit = 10,
  ) {
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        location_id: locationId,
        products: {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
      include: {
        products: {
          select: { id: true, name: true, sku: true },
        },
      },
      take: limit,
    });

    return stockLevels.map((sl) => ({
      id: sl.products.id,
      name: sl.products.name,
      sku: sl.products.sku,
      stock_at_location: {
        quantity_on_hand: sl.quantity_on_hand,
        quantity_reserved: sl.quantity_reserved,
        quantity_available: sl.quantity_available,
      },
    }));
  }

  /**
   * Libera todas las reservas activas de un producto
   */
  async releaseReservationsByProduct(
    product_id: number,
    product_variant_id?: number,
  ): Promise<{ released_count: number; total_quantity: number }> {
    return this.stockLevelManager.releaseAllReservationsForProduct(
      product_id,
      product_variant_id,
    );
  }

  /**
   * Libera TODAS las reservas activas de la organización
   */
  async releaseAllReservations(): Promise<{
    released_count: number;
    total_quantity: number;
  }> {
    return this.stockLevelManager.releaseAllActiveReservations();
  }

  /**
   * Elimina un ajuste (solo si no está aprobado)
   */
  async deleteAdjustment(id: number): Promise<void> {
    const adjustment = await this.prisma.inventory_adjustments.findUnique({
      where: { id },
    });

    if (!adjustment) {
      throw new VendixHttpException(ErrorCodes.INV_ADJ_001);
    }

    if (adjustment.approved_by_user_id) {
      throw new ConflictException('Cannot delete approved adjustment');
    }

    await this.prisma.inventory_adjustments.delete({
      where: { id },
    });
  }
}
