import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { InventoryTransactionsService } from '../../transactions/inventory-transactions.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface UpdateStockParams {
  productId: number;
  variantId?: number;
  locationId: number;
  quantityChange: number;
  movementType:
    | 'stock_in'
    | 'stock_out'
    | 'transfer'
    | 'adjustment'
    | 'sale'
    | 'return'
    | 'damage'
    | 'expiration'
    | 'initial';
  reason?: string;
  userId?: number;
  orderItemId?: number;
  createMovement?: boolean;
  validateAvailability?: boolean;
  fromLocationId?: number;
  toLocationId?: number;
}

export interface StockUpdateResult {
  stockLevel: any;
  transaction: any;
  previousQuantity: number;
}

export interface StockUpdatedEvent {
  productId: number;
  variantId?: number;
  locationId: number;
  newQuantity: number;
  transactionId: number;
  movementType: string;
  userId?: number;
}

@Injectable()
export class StockLevelManager {
  constructor(
    private prisma: PrismaService,
    private transactionsService: InventoryTransactionsService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Actualiza stock de forma atómica con auditoría completa
   */
  async updateStock(params: UpdateStockParams): Promise<StockUpdateResult> {
    return await this.prisma.$transaction(async (prisma) => {
      // 1. Obtener o crear stock level
      const stockLevel = await this.getOrCreateStockLevel(
        prisma,
        params.productId,
        params.variantId,
        params.locationId,
      );

      // 2. Validar stock disponible si es necesario
      if (
        params.validateAvailability &&
        stockLevel.quantity_available < Math.abs(params.quantityChange)
      ) {
        throw new ConflictException('Insufficient stock available');
      }

      // 3. Calcular nuevas cantidades
      const newQuantityOnHand =
        stockLevel.quantity_on_hand + params.quantityChange;
      const newQuantityReserved = stockLevel.quantity_reserved;
      let newQuantityAvailable = newQuantityOnHand - newQuantityReserved;

      // Para ventas, reducir available directamente
      if (params.movementType === 'sale') {
        newQuantityAvailable =
          stockLevel.quantity_available - Math.abs(params.quantityChange);
      }

      // 4. Actualizar stock levels
      const updatedStock = await prisma.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: params.productId,
            product_variant_id: params.variantId || null,
            location_id: params.locationId,
          },
        },
        data: {
          quantity_on_hand: Math.max(0, newQuantityOnHand),
          quantity_available: Math.max(0, newQuantityAvailable),
          last_updated: new Date(),
          updated_at: new Date(),
        },
      });

      // 5. Crear inventory transaction
      const transaction = await this.transactionsService.createTransaction({
        productId: params.productId,
        variantId: params.variantId,
        type:
          params.movementType === 'adjustment'
            ? 'adjustment_damage'
            : params.movementType,
        quantityChange: params.quantityChange,
        reason: params.reason,
        userId: params.userId,
        orderItemId: params.orderItemId,
      });

      // 6. Crear inventory movement si aplica
      if (params.createMovement) {
        await this.createInventoryMovement(prisma, {
          ...params,
          transactionId: transaction.id,
        });
      }

      // 7. Sincronizar con products.stock_quantity
      await this.syncProductStock(prisma, params.productId);

      // 8. Emitir evento
      this.eventEmitter.emit('stock.updated', {
        productId: params.productId,
        variantId: params.variantId,
        locationId: params.locationId,
        newQuantity: updatedStock.quantity_available,
        transactionId: transaction.id,
        movementType: params.movementType,
        userId: params.userId,
      } as StockUpdatedEvent);

      return {
        stockLevel: updatedStock,
        transaction,
        previousQuantity: stockLevel.quantity_available,
      };
    });
  }

  /**
   * Reserva stock para una orden
   */
  async reserveStock(
    productId: number,
    variantId: number | undefined,
    locationId: number,
    quantity: number,
    reservedForType: 'order' | 'transfer' | 'adjustment',
    reservedForId: number,
    userId?: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (prisma) => {
      // 1. Obtener stock level
      const stockLevel = await this.getOrCreateStockLevel(
        prisma,
        productId,
        variantId,
        locationId,
      );

      // 2. Validar disponibilidad
      if (stockLevel.quantity_available < quantity) {
        throw new ConflictException(
          'Insufficient stock available for reservation',
        );
      }

      // 3. Crear reserva
      await prisma.stock_reservations.create({
        data: {
          organization_id: await this.getOrganizationId(productId),
          product_id: productId,
          product_variant_id: variantId,
          location_id: locationId,
          quantity: quantity,
          reserved_for_type: reservedForType,
          reserved_for_id: reservedForId,
          status: 'active',
          user_id: userId,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
          created_at: new Date(),
        },
      });

      // 4. Actualizar stock level
      await prisma.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: variantId || null,
            location_id: locationId,
          },
        },
        data: {
          quantity_reserved: stockLevel.quantity_reserved + quantity,
          quantity_available: stockLevel.quantity_available - quantity,
          last_updated: new Date(),
          updated_at: new Date(),
        },
      });

      // 5. La reserva misma sirve como registro de auditoría
      // No se crea transacción con quantityChange: 0 para evitar contaminar el historial
      // El registro en stock_reservations es suficiente para trazabilidad
    });
  }

  /**
   * Libera stock reservado
   */
  async releaseReservation(
    productId: number,
    variantId: number | undefined,
    locationId: number,
    reservedForType: 'order' | 'transfer' | 'adjustment',
    reservedForId: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (prisma) => {
      // 1. Obtener reservas activas
      const reservations = await prisma.stock_reservations.findMany({
        where: {
          product_id: productId,
          product_variant_id: variantId,
          location_id: locationId,
          reserved_for_type: reservedForType,
          reserved_for_id: reservedForId,
          status: 'active',
        },
      });

      if (reservations.length === 0) {
        return; // No hay reservas que liberar
      }

      const totalReserved = reservations.reduce(
        (sum, r) => sum + r.quantity,
        0,
      );

      // 2. Actualizar reservas a consumidas
      await prisma.stock_reservations.updateMany({
        where: {
          id: { in: reservations.map((r) => r.id) },
        },
        data: {
          status: 'consumed',
          updated_at: new Date(),
        },
      });

      // 3. Actualizar stock level
      const stockLevel = await prisma.stock_levels.findUnique({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: productId,
            product_variant_id: variantId || null,
            location_id: locationId,
          },
        },
      });

      if (stockLevel) {
        await prisma.stock_levels.update({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: productId,
              product_variant_id: variantId || null,
              location_id: locationId,
            },
          },
          data: {
            quantity_reserved: Math.max(
              0,
              stockLevel.quantity_reserved - totalReserved,
            ),
            quantity_available: stockLevel.quantity_available + totalReserved,
            last_updated: new Date(),
            updated_at: new Date(),
          },
        });
      }
    });
  }

  /**
   * Obtiene o crea un stock level
   */
  private async getOrCreateStockLevel(
    prisma: any,
    productId: number,
    variantId: number | undefined,
    locationId: number,
  ): Promise<any> {
    let stockLevel = await prisma.stock_levels.findUnique({
      where: {
        product_id_product_variant_id_location_id: {
          product_id: productId,
          product_variant_id: variantId || null,
          location_id: locationId,
        },
      },
    });

    if (!stockLevel) {
      stockLevel = await prisma.stock_levels.create({
        data: {
          product_id: productId,
          product_variant_id: variantId,
          location_id: locationId,
          quantity_on_hand: 0,
          quantity_reserved: 0,
          quantity_available: 0,
          last_updated: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    return stockLevel;
  }

  /**
   * Crea un inventory movement
   */
  private async createInventoryMovement(
    prisma: any,
    params: UpdateStockParams & { transactionId: number },
  ): Promise<void> {
    const organizationId = await this.getOrganizationId(params.productId);

    await prisma.inventory_movements.create({
      data: {
        organization_id: organizationId,
        product_id: params.productId,
        product_variant_id: params.variantId,
        from_location_id: params.fromLocationId,
        to_location_id: params.toLocationId || params.locationId,
        quantity: Math.abs(params.quantityChange),
        movement_type: params.movementType,
        reason: params.reason,
        notes: params.reason,
        user_id: params.userId,
        created_at: new Date(),
      },
    });
  }

  /**
   * Sincroniza el stock agregado con products.stock_quantity
   * Incluye tanto el stock base del producto como el de todas sus variantes
   */
  private async syncProductStock(
    prisma: any,
    productId: number,
  ): Promise<void> {
    // Sumar TODO el stock disponible del producto (base + variantes) across all locations
    const totalStock = await prisma.stock_levels.aggregate({
      where: {
        product_id: productId,
        // Incluir tanto stock base como variantes para el cálculo total
      },
      _sum: {
        quantity_available: true,
      },
    });

    // Actualizar products.stock_quantity con el stock total consolidado
    await prisma.products.update({
      where: { id: productId },
      data: {
        stock_quantity: totalStock._sum.quantity_available || 0,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Obtiene el organization_id de un producto
   */
  private async getOrganizationId(productId: number): Promise<number> {
    const product = await this.prisma.products.findUnique({
      where: { id: productId },
      include: {
        stores: {
          select: {
            organization_id: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${productId} not found`);
    }

    return product.stores.organization_id;
  }

  /**
   * Inicializa stock levels para todas las ubicaciones de una organización
   */
  async initializeStockLevelsForProduct(
    productId: number,
    organizationId: number,
  ): Promise<void> {
    const locations = await this.prisma.inventory_locations.findMany({
      where: { organization_id: organizationId },
    });

    for (const location of locations) {
      await this.getOrCreateStockLevel(
        this.prisma,
        productId,
        undefined,
        location.id,
      );
    }
  }

  /**
   * Obtiene stock levels por producto
   */
  async getStockLevels(productId: number, variantId?: number): Promise<any[]> {
    return await this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        ...(variantId && { product_variant_id: variantId }),
      },
      include: {
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
   * Verifica puntos de reorden
   */
  async checkReorderPoints(productId: number): Promise<any[]> {
    const stockLevels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        reorder_point: { not: null },
      },
      include: {
        inventory_locations: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    return stockLevels.filter(
      (sl) => sl.quantity_available <= (sl.reorder_point || 0),
    );
  }
}
