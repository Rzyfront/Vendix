import { Prisma } from '@prisma/client';
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { InventoryTransactionsService } from '../../transactions/inventory-transactions.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';

export interface UpdateStockParams {
  product_id: number;
  variant_id?: number;
  location_id: number;
  quantity_change: number;
  movement_type:
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
  user_id?: number;
  order_item_id?: number;
  create_movement?: boolean;
  validate_availability?: boolean;
  from_location_id?: number;
  to_location_id?: number;
}

export interface StockUpdateResult {
  stock_level: any;
  transaction: any;
  previous_quantity: number;
}

export interface StockUpdatedEvent {
  product_id: number;
  variant_id?: number;
  location_id: number;
  new_quantity: number;
  transaction_id: number;
  movement_type: string;
  user_id?: number;
}

@Injectable()
export class StockLevelManager {
  constructor(
    private prisma: StorePrismaService,
    private transactionsService: InventoryTransactionsService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Actualiza stock de forma atómica con auditoría completa
   */
  async updateStock(
    params: UpdateStockParams,
    tx?: Prisma.TransactionClient,
  ): Promise<StockUpdateResult> {
    if (tx) {
      return this.executeStockUpdate(tx, params);
    }

    return await this.prisma.$transaction(async (prisma) => {
      return this.executeStockUpdate(prisma, params);
    });
  }

  private async executeStockUpdate(
    prisma: any,
    params: UpdateStockParams,
  ): Promise<StockUpdateResult> {
    // Validar contexto de organización
    const context = RequestContextService.getContext();
    if (!context?.organization_id && !context?.is_super_admin) {
      throw new BadRequestException('Organization context is required');
    }

    // 1. Obtener o crear stock level
    const stock_level = await this.getOrCreateStockLevel(
      prisma,
      params.product_id,
      params.variant_id,
      params.location_id,
    );

    // 2. Validar stock disponible si es necesario
    if (
      params.validate_availability &&
      stock_level.quantity_available < Math.abs(params.quantity_change)
    ) {
      throw new ConflictException('Insufficient stock available');
    }

    // 3. Calcular nuevas cantidades
    const new_quantity_on_hand =
      stock_level.quantity_on_hand + params.quantity_change;
    const new_quantity_reserved = stock_level.quantity_reserved;
    let new_quantity_available = new_quantity_on_hand - new_quantity_reserved;

    // Para ventas, reducir available directamente
    if (params.movement_type === 'sale') {
      new_quantity_available =
        stock_level.quantity_available - Math.abs(params.quantity_change);
    }

    // 4. Actualizar stock levels usando scoped client
    const existing_stock_level = await prisma.stock_levels.findFirst({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id || null,
        location_id: params.location_id,
      },
    });

    if (!existing_stock_level) {
      throw new BadRequestException('Stock level not found');
    }

    const updated_stock = await prisma.stock_levels.update({
      where: {
        id: existing_stock_level.id,
      },
      data: {
        quantity_on_hand: Math.max(0, new_quantity_on_hand),
        quantity_available: Math.max(0, new_quantity_available),
        last_updated: new Date(),
        updated_at: new Date(),
      },
    });

    // 5. Crear inventory transaction
    // Nota: transactionsService debe manejar su propia conexión o aceptar prisma client si queremos que sea parte de la misma tx.
    // Por ahora asumimos que transactionsService.createTransaction es seguro o independiente,
    // PERO idealmente también debería aceptar el tx.
    // Sin embargo, para arreglar el "Product not found", lo crucial es que getOrCreateStockLevel use el tx donde el producto existe.
    const transaction = await this.transactionsService.createTransaction(
      {
        productId: params.product_id,
        variantId: params.variant_id,
        type:
          params.movement_type === 'adjustment'
            ? 'adjustment_damage'
            : params.movement_type,
        quantityChange: params.quantity_change,
        reason: params.reason,
        userId: params.user_id,
        orderItemId: params.order_item_id,
      },
      prisma,
    );

    // 6. Crear inventory movement si aplica
    if (params.create_movement) {
      await this.createInventoryMovement(prisma, {
        ...params,
        // Map 'initial' to 'stock_in' for movement_type enum compliance
        movement_type:
          params.movement_type === 'initial'
            ? 'stock_in'
            : params.movement_type,
        transaction_id: transaction.id,
      });
    }

    // 7. Sincronizar con products.stock_quantity
    await this.syncProductStock(prisma, params.product_id);

    // 8. Emitir evento
    this.eventEmitter.emit('stock.updated', {
      product_id: params.product_id,
      variant_id: params.variant_id,
      location_id: params.location_id,
      new_quantity: updated_stock.quantity_available,
      transaction_id: transaction.id,
      movement_type: params.movement_type,
      user_id: params.user_id,
    } as StockUpdatedEvent);

    return {
      stock_level: updated_stock,
      transaction,
      previous_quantity: stock_level.quantity_available,
    };
  }

  /**
   * Reserva stock para una orden
   */
  async reserveStock(
    product_id: number,
    variant_id: number | undefined,
    location_id: number,
    quantity: number,
    reserved_for_type: 'order' | 'transfer' | 'adjustment',
    reserved_for_id: number,
    user_id?: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (prisma) => {
      // Validar contexto
      const context = RequestContextService.getContext();
      const organization_id =
        context?.organization_id || (await this.getOrganizationId(product_id));

      // 1. Obtener stock level
      const stock_level = await this.getOrCreateStockLevel(
        prisma,
        product_id,
        variant_id,
        location_id,
      );

      // 2. Validar disponibilidad
      if (stock_level.quantity_available < quantity) {
        throw new ConflictException(
          'Insufficient stock available for reservation',
        );
      }

      // 3. Crear reserva
      await prisma.stock_reservations.create({
        data: {
          organization_id: organization_id,
          product_id: product_id,
          product_variant_id: variant_id,
          location_id: location_id,
          quantity: quantity,
          reserved_for_type: reserved_for_type,
          reserved_for_id: reserved_for_id,
          status: 'active',
          user_id: user_id,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 días
          created_at: new Date(),
        },
      });

      // 4. Actualizar stock level
      await prisma.stock_levels.update({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: product_id,
            product_variant_id: variant_id || null,
            location_id: location_id,
          },
        },
        data: {
          quantity_reserved: stock_level.quantity_reserved + quantity,
          quantity_available: stock_level.quantity_available - quantity,
          last_updated: new Date(),
          updated_at: new Date(),
        },
      });

      // 5. La reserva misma sirve como registro de auditoría
      // No se crea transacción con quantity_change: 0 para evitar contaminar el historial
      // El registro en stock_reservations es suficiente para trazabilidad
    });
  }

  /**
   * Libera stock reservado
   */
  async releaseReservation(
    product_id: number,
    variant_id: number | undefined,
    location_id: number,
    reserved_for_type: 'order' | 'transfer' | 'adjustment',
    reserved_for_id: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (prisma) => {
      // 1. Obtener reservas activas
      const reservations = await prisma.stock_reservations.findMany({
        where: {
          product_id: product_id,
          product_variant_id: variant_id,
          location_id: location_id,
          reserved_for_type: reserved_for_type,
          reserved_for_id: reserved_for_id,
          status: 'active',
        },
      });

      if (reservations.length === 0) {
        return; // No hay reservas que liberar
      }

      const total_reserved = reservations.reduce(
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
      const stock_level = await prisma.stock_levels.findUnique({
        where: {
          product_id_product_variant_id_location_id: {
            product_id: product_id,
            product_variant_id: variant_id || null,
            location_id: location_id,
          },
        },
      });

      if (stock_level) {
        await prisma.stock_levels.update({
          where: {
            product_id_product_variant_id_location_id: {
              product_id: product_id,
              product_variant_id: variant_id || null,
              location_id: location_id,
            },
          },
          data: {
            quantity_reserved: Math.max(
              0,
              stock_level.quantity_reserved - total_reserved,
            ),
            quantity_available: stock_level.quantity_available + total_reserved,
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
    product_id: number,
    variant_id: number | undefined,
    location_id: number,
  ): Promise<any> {
    const context = RequestContextService.getContext();

    // Validar manualmente el scope antes de operar
    if (!context?.is_super_admin) {
      // Validar que el contexto tenga organization_id
      if (!context?.organization_id) {
        throw new BadRequestException(
          'Organization context is required for stock level operations',
        );
      }

      // Validar que el producto pertenezca a la organización del contexto
      const product = await prisma.products.findFirst({
        where: {
          id: product_id,
          stores: {
            organization_id: context.organization_id,
          },
        },
      });

      if (!product) {
        throw new BadRequestException(
          'Product not found or out of organization scope',
        );
      }

      // Validar que la ubicación pertenezca a la organización
      const location = await prisma.inventory_locations.findFirst({
        where: {
          id: location_id,
          organization_id: context.organization_id,
        },
      });

      if (!location) {
        throw new BadRequestException(
          'Location not found or out of organization scope',
        );
      }
    }

    // Para stock_levels, necesitamos usar el cliente base para evitar scoping automático
    // que podría interferir con las relaciones cruzadas
    const basePrisma = prisma._baseClient || prisma;

    // Use findFirst to avoid issues with unique constraint and null values
    let stock_level = await basePrisma.stock_levels.findFirst({
      where: {
        product_id: product_id,
        product_variant_id: variant_id || null,
        location_id: location_id,
      },
    });

    if (!stock_level) {
      stock_level = await basePrisma.stock_levels.create({
        data: {
          product_id: product_id,
          product_variant_id: variant_id || null,
          location_id: location_id,
          quantity_on_hand: 0,
          quantity_reserved: 0,
          quantity_available: 0,
          last_updated: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    return stock_level;
  }

  /**
   * Crea un inventory movement
   */
  private async createInventoryMovement(
    prisma: any,
    params: UpdateStockParams & { transaction_id: number },
  ): Promise<void> {
    const context = RequestContextService.getContext();
    const organization_id =
      context?.organization_id ||
      (await this.getOrganizationId(params.product_id));

    // Ensure movement_type is valid for the enum (map 'initial' to 'stock_in')
    const movementType =
      params.movement_type === 'initial' ? 'stock_in' : params.movement_type;

    await prisma.inventory_movements.create({
      data: {
        organization_id: organization_id,
        product_id: params.product_id,
        product_variant_id: params.variant_id,
        from_location_id: params.from_location_id,
        to_location_id: params.to_location_id || params.location_id,
        quantity: Math.abs(params.quantity_change),
        movement_type: movementType,
        reason: params.reason,
        notes: params.reason,
        user_id: params.user_id,
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
    product_id: number,
  ): Promise<void> {
    // Sumar TODO el stock disponible del producto (base + variantes) across all locations
    const total_stock = await prisma.stock_levels.aggregate({
      where: {
        product_id: product_id,
        // Incluir tanto stock base como variantes para el cálculo total
      },
      _sum: {
        quantity_available: true,
      },
    });

    // Actualizar products.stock_quantity con el stock total consolidado
    await prisma.products.update({
      where: { id: product_id },
      data: {
        stock_quantity: total_stock._sum.quantity_available || 0,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Obtiene el organization_id de un producto
   */
  private async getOrganizationId(product_id: number): Promise<number> {
    const context = RequestContextService.getContext();

    // Si ya tenemos el contexto, usarlo
    if (context?.organization_id) {
      return context.organization_id;
    }

    // De lo contrario, obtenerlo del producto (fallback)
    const product = await this.prisma.products.findUnique({
      where: { id: product_id },
      include: {
        stores: {
          select: {
            organization_id: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${product_id} not found`);
    }

    return product.stores.organization_id;
  }

  /**
   * Inicializa stock levels para todas las ubicaciones de una organización
   */
  async initializeStockLevelsForProduct(
    product_id: number,
    organization_id: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;
    // Validar contexto o usar el proporcionado
    const context = RequestContextService.getContext();
    const target_organization_id = context?.organization_id || organization_id;

    const locations = await prisma.inventory_locations.findMany({
      where: { organization_id: target_organization_id },
    });

    for (const location of locations) {
      await this.getOrCreateStockLevel(
        prisma,
        product_id,
        undefined,
        location.id,
      );
    }
  }

  /**
   * Obtiene stock levels por producto
   */
  async getStockLevels(
    product_id: number,
    variant_id?: number,
  ): Promise<any[]> {
    return await this.prisma.stock_levels.findMany({
      where: {
        product_id: product_id,
        ...(variant_id && { product_variant_id: variant_id }),
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
  async checkReorderPoints(product_id: number): Promise<any[]> {
    const stock_levels = await this.prisma.stock_levels.findMany({
      where: {
        product_id: product_id,
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

    return stock_levels.filter(
      (sl) => sl.quantity_available <= (sl.reorder_point || 0),
    );
  }
}
