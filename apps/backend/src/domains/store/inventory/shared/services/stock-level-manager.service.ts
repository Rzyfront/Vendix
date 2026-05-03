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
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { OperatingScopeService } from '@common/services/operating-scope.service';

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
  source_module?: string;
  unit_cost?: number;
}

export interface StockUpdateResult {
  stock_level: any;
  transaction: any;
  previous_quantity: number;
  cost_snapshot?: {
    unit_cost: number;
    total_cost: number;
    stock_value: number;
  };
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
    private readonly operatingScopeService: OperatingScopeService,
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
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }

    // Skip stock operations for products that don't track inventory
    const productForTracking = await prisma.products.findUnique({
      where: { id: params.product_id },
      select: { track_inventory: true },
    });

    if (!productForTracking || !productForTracking.track_inventory) {
      return {
        stock_level: null,
        transaction: null,
        previous_quantity: 0,
      };
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
    const movementCostSnapshot = await this.calculateAndConsumeMovementCost(
      prisma,
      params,
      stock_level,
    );
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
      throw new VendixHttpException(ErrorCodes.INV_FIND_001);
    }

    const stockUpdateData: any = {
      quantity_on_hand: Math.max(0, new_quantity_on_hand),
      quantity_available: Math.max(0, new_quantity_available),
      last_updated: new Date(),
      updated_at: new Date(),
    };

    if (params.quantity_change > 0 && params.unit_cost !== undefined) {
      stockUpdateData.cost_per_unit = new Prisma.Decimal(params.unit_cost);
    }

    const updated_stock = await prisma.stock_levels.update({
      where: {
        id: existing_stock_level.id,
      },
      data: stockUpdateData,
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
        type: this.mapMovementToTransactionType(params.movement_type),
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

    if (params.movement_type === 'transfer' && params.quantity_change > 0) {
      await this.createTransferCostLayer(
        prisma,
        params,
        movementCostSnapshot.unit_cost,
      );
    }

    const costSnapshot = await this.recordValuationSnapshot(
      prisma,
      updated_stock,
      params,
      transaction?.id,
      movementCostSnapshot,
    );

    // 7. Sincronizar con products.stock_quantity y product_variants.stock_quantity
    await this.syncProductStock(prisma, params.product_id, params.variant_id);

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

    // 9. Emitir alerta de stock bajo si aplica
    const low_threshold = existing_stock_level.reorder_point ?? 5;
    if (
      updated_stock.quantity_available <= low_threshold &&
      updated_stock.quantity_available >= 0
    ) {
      const product = await prisma.products.findUnique({
        where: { id: params.product_id },
        select: { name: true, store_id: true },
      });
      if (product?.store_id) {
        this.eventEmitter.emit('stock.low', {
          store_id: product.store_id,
          product_id: params.product_id,
          product_name: product.name || 'Producto',
          quantity: updated_stock.quantity_available,
          threshold: low_threshold,
        });
      }
    }

    return {
      stock_level: updated_stock,
      transaction,
      previous_quantity: stock_level.quantity_available,
      cost_snapshot: costSnapshot,
    };
  }

  private async recordValuationSnapshot(
    prisma: any,
    stockLevel: any,
    params: UpdateStockParams,
    transactionId?: number,
    movementCostSnapshot?: { unit_cost: number; total_cost: number },
  ): Promise<{ unit_cost: number; total_cost: number; stock_value: number }> {
    const context = RequestContextService.getContext();
    const organizationId = context?.organization_id;
    if (!organizationId || !stockLevel) {
      return { unit_cost: 0, total_cost: 0, stock_value: 0 };
    }

    const [location, product, variant] = await Promise.all([
      prisma.inventory_locations.findUnique({
        where: { id: params.location_id },
        select: { store_id: true },
      }),
      prisma.products.findUnique({
        where: { id: params.product_id },
        select: { cost_price: true },
      }),
      params.variant_id
        ? prisma.product_variants.findUnique({
            where: { id: params.variant_id },
            select: { cost_price: true },
          })
        : Promise.resolve(null),
    ]);

    const accountingEntity =
      await this.operatingScopeService.resolveAccountingEntity({
        organization_id: organizationId,
        store_id: location?.store_id ?? null,
        tx: prisma,
      });
    const operatingScope = await this.operatingScopeService.getOperatingScope(
      organizationId,
      prisma,
    );
    const unitCost =
      Number(movementCostSnapshot?.unit_cost || 0) ||
      Number(stockLevel.cost_per_unit || 0) ||
      Number(variant?.cost_price || 0) ||
      Number(product?.cost_price || 0);
    const stockValue = Number(stockLevel.quantity_on_hand || 0) * unitCost;
    const totalCost =
      Number(movementCostSnapshot?.total_cost || 0) ||
      Math.abs(params.quantity_change) * unitCost;

    await prisma.inventory_valuation_snapshots.create({
      data: {
        organization_id: organizationId,
        store_id: location?.store_id ?? null,
        accounting_entity_id: accountingEntity.id,
        location_id: params.location_id,
        product_id: params.product_id,
        product_variant_id: params.variant_id ?? null,
        snapshot_at: new Date(),
        quantity_on_hand: new Prisma.Decimal(stockLevel.quantity_on_hand || 0),
        quantity_reserved: new Prisma.Decimal(
          stockLevel.quantity_reserved || 0,
        ),
        quantity_available: new Prisma.Decimal(
          stockLevel.quantity_available || 0,
        ),
        unit_cost: new Prisma.Decimal(unitCost),
        total_value: new Prisma.Decimal(stockValue),
        costing_method: 'weighted_average',
        operating_scope: operatingScope,
        source_type: params.movement_type,
        source_id: transactionId ?? null,
      },
    });

    return {
      unit_cost: unitCost,
      total_cost: totalCost,
      stock_value: stockValue,
    };
  }

  private async calculateAndConsumeMovementCost(
    prisma: any,
    params: UpdateStockParams,
    stockLevel: any,
  ): Promise<{ unit_cost: number; total_cost: number }> {
    const quantity = Math.abs(params.quantity_change);
    if (quantity === 0) return { unit_cost: 0, total_cost: 0 };

    if (params.quantity_change >= 0) {
      const unitCost = Number(
        params.unit_cost ?? stockLevel.cost_per_unit ?? 0,
      );
      return { unit_cost: unitCost, total_cost: unitCost * quantity };
    }

    const layers = await prisma.inventory_cost_layers.findMany({
      where: {
        product_id: params.product_id,
        product_variant_id: params.variant_id ?? null,
        location_id: params.location_id,
        quantity_remaining: { gt: 0 },
      },
      orderBy: { received_at: 'asc' },
    });

    let remaining = quantity;
    let totalCost = 0;

    for (const layer of layers) {
      if (remaining <= 0) break;
      const consumed = Math.min(remaining, layer.quantity_remaining);
      totalCost += consumed * Number(layer.unit_cost || 0);
      remaining -= consumed;

      await prisma.inventory_cost_layers.update({
        where: { id: layer.id },
        data: { quantity_remaining: layer.quantity_remaining - consumed },
      });
    }

    if (remaining > 0) {
      totalCost += remaining * Number(stockLevel.cost_per_unit || 0);
    }

    const unitCost =
      totalCost > 0
        ? totalCost / quantity
        : Number(stockLevel.cost_per_unit || 0);
    return { unit_cost: unitCost, total_cost: totalCost };
  }

  private async createTransferCostLayer(
    prisma: any,
    params: UpdateStockParams,
    unitCost: number,
  ): Promise<void> {
    if (!unitCost) return;

    const location = await prisma.inventory_locations.findUnique({
      where: { id: params.location_id },
      select: { organization_id: true },
    });

    const organizationId =
      location?.organization_id ??
      RequestContextService.getContext()?.organization_id;

    if (!organizationId) return;

    await prisma.inventory_cost_layers.create({
      data: {
        organization_id: organizationId,
        product_id: params.product_id,
        product_variant_id: params.variant_id ?? null,
        location_id: params.location_id,
        quantity_remaining: Math.abs(params.quantity_change),
        unit_cost: new Prisma.Decimal(unitCost),
        received_at: new Date(),
      },
    });
  }

  /**
   * Resolves the best location_id for a product when no explicit location is provided.
   * Used by POS and e-commerce where items don't carry location context.
   * Priority: location with highest available stock → first org location as fallback.
   */
  async getDefaultLocationForProduct(
    product_id: number,
    variant_id?: number,
  ): Promise<number> {
    const stockLevel = await this.prisma.stock_levels.findFirst({
      where: {
        product_id,
        product_variant_id: variant_id || null,
        quantity_available: { gt: 0 },
      },
      orderBy: { quantity_available: 'desc' },
      select: { location_id: true },
    });
    if (stockLevel) return stockLevel.location_id;

    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }
    const location = await this.prisma.inventory_locations.findFirst({
      where: { organization_id: context.organization_id },
      orderBy: { id: 'asc' },
    });
    if (!location) throw new VendixHttpException(ErrorCodes.INV_LOC_001);
    return location.id;
  }

  /**
   * Reserva stock para una orden
   */
  async reserveStock(
    product_id: number,
    variant_id: number | undefined,
    location_id: number,
    quantity: number,
    reserved_for_type: 'order' | 'transfer' | 'adjustment' | 'layaway',
    reserved_for_id: number,
    user_id?: number,
    validate_availability = true,
    tx?: any,
    expires_at?: Date | null,
  ): Promise<void> {
    const execute = async (prisma: any) => {
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

      // 2. Validar disponibilidad (skip for POS/non-restrictive channels)
      if (validate_availability && stock_level.quantity_available < quantity) {
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
          expires_at:
            expires_at !== undefined
              ? expires_at
              : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // null = no expira (layaway), undefined = default 7 días
          created_at: new Date(),
        },
      });

      // 4. Actualizar stock level (use id to avoid composite key null issues)
      await prisma.stock_levels.update({
        where: { id: stock_level.id },
        data: {
          quantity_reserved: stock_level.quantity_reserved + quantity,
          quantity_available: stock_level.quantity_available - quantity,
          last_updated: new Date(),
          updated_at: new Date(),
        },
      });

      // 5. Sincronizar con products.stock_quantity y product_variants.stock_quantity
      await this.syncProductStock(prisma, product_id, variant_id);
    };

    if (tx) {
      await execute(tx);
    } else {
      await this.prisma.$transaction(async (prisma) => execute(prisma));
    }
  }

  /**
   * Libera stock reservado
   */
  async releaseReservation(
    product_id: number,
    variant_id: number | undefined,
    location_id: number,
    reserved_for_type: 'order' | 'transfer' | 'adjustment' | 'layaway',
    reserved_for_id: number,
    tx?: any,
  ): Promise<void> {
    const execute = async (prisma: any) => {
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

      // 3. Actualizar stock level (use findFirst for nullable variant_id in composite key)
      const stock_level = await prisma.stock_levels.findFirst({
        where: {
          product_id: product_id,
          product_variant_id: variant_id || null,
          location_id: location_id,
        },
      });

      if (stock_level) {
        await prisma.stock_levels.update({
          where: { id: stock_level.id },
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

        // 4. Sincronizar con products.stock_quantity y product_variants.stock_quantity
        await this.syncProductStock(prisma, product_id, variant_id);
      }
    };

    if (tx) {
      await execute(tx);
    } else {
      await this.prisma.$transaction(async (prisma) => execute(prisma));
    }
  }

  /**
   * Libera reservas por referencia (order/transfer/adjustment ID).
   * No requiere location_id — busca directamente en stock_reservations.
   */
  async releaseReservationsByReference(
    reserved_for_type: 'order' | 'transfer' | 'adjustment' | 'layaway',
    reserved_for_id: number,
    status: 'consumed' | 'cancelled' = 'consumed',
    tx?: any,
    options: { decrementOnHand?: boolean } = {},
  ): Promise<void> {
    const execute = async (prisma: any) => {
      // 1. Buscar todas las reservas activas para esta referencia
      const reservations = await prisma.stock_reservations.findMany({
        where: {
          reserved_for_type,
          reserved_for_id,
          status: 'active',
        },
      });

      if (reservations.length === 0) return;

      // 2. Agrupar por (product_id, product_variant_id, location_id) para batch updates
      const groups = new Map<
        string,
        {
          product_id: number;
          product_variant_id: number | null;
          location_id: number;
          total_quantity: number;
        }
      >();

      for (const r of reservations) {
        const key = `${r.product_id}-${r.product_variant_id ?? 'null'}-${r.location_id}`;
        const existing = groups.get(key);
        if (existing) {
          existing.total_quantity += r.quantity;
        } else {
          groups.set(key, {
            product_id: r.product_id,
            product_variant_id: r.product_variant_id,
            location_id: r.location_id,
            total_quantity: r.quantity,
          });
        }
      }

      // 3. Marcar reservas con el status correspondiente
      await prisma.stock_reservations.updateMany({
        where: {
          id: { in: reservations.map((r) => r.id) },
        },
        data: {
          status,
          updated_at: new Date(),
        },
      });

      // 4. Actualizar stock_levels por grupo y sincronizar producto
      const syncedProducts = new Set<string>();

      for (const group of groups.values()) {
        const stock_level = await prisma.stock_levels.findFirst({
          where: {
            product_id: group.product_id,
            product_variant_id: group.product_variant_id,
            location_id: group.location_id,
          },
        });

        if (stock_level) {
          const newReserved = Math.max(
            0,
            stock_level.quantity_reserved - group.total_quantity,
          );
          const data: any = {
            quantity_reserved: newReserved,
            last_updated: new Date(),
            updated_at: new Date(),
          };

          if (status === 'consumed') {
            const newOnHand =
              options.decrementOnHand === false
                ? stock_level.quantity_on_hand
                : Math.max(
                    0,
                    stock_level.quantity_on_hand - group.total_quantity,
                  );
            data.quantity_on_hand = newOnHand;
            data.quantity_available = Math.max(0, newOnHand - newReserved);
          } else {
            data.quantity_available =
              stock_level.quantity_available + group.total_quantity;
          }

          await prisma.stock_levels.update({
            where: { id: stock_level.id },
            data,
          });
        }

        const productKey = `${group.product_id}-${group.product_variant_id ?? 'null'}`;
        if (!syncedProducts.has(productKey)) {
          syncedProducts.add(productKey);
          await this.syncProductStock(
            prisma,
            group.product_id,
            group.product_variant_id ?? undefined,
          );
        }
      }
    };

    if (tx) {
      await execute(tx);
    } else {
      await this.prisma.$transaction(async (prisma) => execute(prisma));
    }
  }

  /**
   * Libera TODAS las reservas activas de un producto (herramienta administrativa).
   */
  async releaseAllReservationsForProduct(
    product_id: number,
    product_variant_id?: number,
    tx?: any,
  ): Promise<{ released_count: number; total_quantity: number }> {
    const execute = async (prisma: any) => {
      const where: any = {
        product_id,
        status: 'active',
      };
      if (product_variant_id !== undefined) {
        where.product_variant_id = product_variant_id;
      }

      const reservations = await prisma.stock_reservations.findMany({ where });

      if (reservations.length === 0) {
        return { released_count: 0, total_quantity: 0 };
      }

      // Agrupar por location para batch update
      const groups = new Map<
        string,
        {
          location_id: number;
          product_variant_id: number | null;
          total_quantity: number;
        }
      >();

      let total_quantity = 0;
      for (const r of reservations) {
        total_quantity += r.quantity;
        const key = `${r.product_variant_id ?? 'null'}-${r.location_id}`;
        const existing = groups.get(key);
        if (existing) {
          existing.total_quantity += r.quantity;
        } else {
          groups.set(key, {
            location_id: r.location_id,
            product_variant_id: r.product_variant_id,
            total_quantity: r.quantity,
          });
        }
      }

      await prisma.stock_reservations.updateMany({
        where: { id: { in: reservations.map((r) => r.id) } },
        data: { status: 'cancelled', updated_at: new Date() },
      });

      for (const group of groups.values()) {
        const stock_level = await prisma.stock_levels.findFirst({
          where: {
            product_id,
            product_variant_id: group.product_variant_id,
            location_id: group.location_id,
          },
        });

        if (stock_level) {
          await prisma.stock_levels.update({
            where: { id: stock_level.id },
            data: {
              quantity_reserved: Math.max(
                0,
                stock_level.quantity_reserved - group.total_quantity,
              ),
              quantity_available:
                stock_level.quantity_available + group.total_quantity,
              last_updated: new Date(),
              updated_at: new Date(),
            },
          });
        }
      }

      await this.syncProductStock(prisma, product_id, product_variant_id);

      return { released_count: reservations.length, total_quantity };
    };

    if (tx) {
      return execute(tx);
    }
    return this.prisma.$transaction(async (prisma) => execute(prisma));
  }

  /**
   * Libera TODAS las reservas activas de la organización (emergencia administrativa).
   */
  async releaseAllActiveReservations(
    tx?: any,
  ): Promise<{ released_count: number; total_quantity: number }> {
    const execute = async (prisma: any) => {
      const reservations = await prisma.stock_reservations.findMany({
        where: { status: 'active' },
      });

      if (reservations.length === 0) {
        return { released_count: 0, total_quantity: 0 };
      }

      // Agrupar por (product_id, product_variant_id, location_id)
      const groups = new Map<
        string,
        {
          product_id: number;
          product_variant_id: number | null;
          location_id: number;
          total_quantity: number;
        }
      >();

      let total_quantity = 0;
      for (const r of reservations) {
        total_quantity += r.quantity;
        const key = `${r.product_id}-${r.product_variant_id ?? 'null'}-${r.location_id}`;
        const existing = groups.get(key);
        if (existing) {
          existing.total_quantity += r.quantity;
        } else {
          groups.set(key, {
            product_id: r.product_id,
            product_variant_id: r.product_variant_id,
            location_id: r.location_id,
            total_quantity: r.quantity,
          });
        }
      }

      await prisma.stock_reservations.updateMany({
        where: { id: { in: reservations.map((r) => r.id) } },
        data: { status: 'cancelled', updated_at: new Date() },
      });

      const syncedProducts = new Set<string>();

      for (const group of groups.values()) {
        const stock_level = await prisma.stock_levels.findFirst({
          where: {
            product_id: group.product_id,
            product_variant_id: group.product_variant_id,
            location_id: group.location_id,
          },
        });

        if (stock_level) {
          await prisma.stock_levels.update({
            where: { id: stock_level.id },
            data: {
              quantity_reserved: Math.max(
                0,
                stock_level.quantity_reserved - group.total_quantity,
              ),
              quantity_available:
                stock_level.quantity_available + group.total_quantity,
              last_updated: new Date(),
              updated_at: new Date(),
            },
          });
        }

        const productKey = `${group.product_id}-${group.product_variant_id ?? 'null'}`;
        if (!syncedProducts.has(productKey)) {
          syncedProducts.add(productKey);
          await this.syncProductStock(
            prisma,
            group.product_id,
            group.product_variant_id ?? undefined,
          );
        }
      }

      return { released_count: reservations.length, total_quantity };
    };

    if (tx) {
      return execute(tx);
    }
    return this.prisma.$transaction(async (prisma) => execute(prisma));
  }

  /**
   * Maps movement_type_enum to inventory_transaction_type_enum
   * movement_type_enum: stock_in, stock_out, transfer, adjustment, sale, return, damage, expiration
   * inventory_transaction_type_enum: stock_in, sale, return, adjustment_damage, initial
   */
  private mapMovementToTransactionType(movementType: string): any {
    const map: Record<string, string> = {
      stock_in: 'stock_in',
      stock_out: 'stock_in',
      transfer: 'stock_in',
      adjustment: 'adjustment_damage',
      sale: 'sale',
      return: 'return',
      damage: 'adjustment_damage',
      expiration: 'adjustment_damage',
      initial: 'initial',
    };
    return map[movementType] || 'stock_in';
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
        throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
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
        throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
      }

      // Validar que la ubicación pertenezca a la organización
      const location = await prisma.inventory_locations.findFirst({
        where: {
          id: location_id,
          organization_id: context.organization_id,
        },
      });

      if (!location) {
        throw new VendixHttpException(ErrorCodes.INV_LOC_001);
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
        source_module: params.source_module,
        reason: params.reason,
        notes: params.reason,
        user_id: params.user_id,
        created_at: new Date(),
      },
    });
  }

  /**
   * Limpia el stock base (product_variant_id IS NULL) cuando un producto transiciona a variantes.
   * Retorna las location_ids donde existía stock base para heredarlas en las variantes.
   */
  async clearBaseStock(
    product_id: number,
    user_id: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number[]> {
    const prisma: any = tx || this.prisma;
    const basePrisma = prisma._baseClient || prisma;

    // Find all base stock levels (no variant)
    const baseStockLevels = await basePrisma.stock_levels.findMany({
      where: {
        product_id: product_id,
        product_variant_id: null,
      },
    });

    const locationIds: number[] = [];

    for (const sl of baseStockLevels) {
      locationIds.push(sl.location_id);

      if (sl.quantity_on_hand > 0) {
        // Zero out the stock level
        await basePrisma.stock_levels.update({
          where: { id: sl.id },
          data: {
            quantity_on_hand: 0,
            quantity_available: 0,
            last_updated: new Date(),
            updated_at: new Date(),
          },
        });

        // Create audit transaction
        await this.transactionsService.createTransaction(
          {
            productId: product_id,
            type: 'adjustment_damage',
            quantityChange: -sl.quantity_on_hand,
            reason:
              'Stock base reiniciado: producto transicionó a inventario por variantes',
            userId: user_id,
          },
          prisma,
        );

        // Create audit movement
        const context = RequestContextService.getContext();
        const organization_id =
          context?.organization_id ||
          (await this.getOrganizationId(product_id));

        await basePrisma.inventory_movements.create({
          data: {
            organization_id,
            product_id,
            product_variant_id: null,
            from_location_id: sl.location_id,
            to_location_id: sl.location_id,
            quantity: sl.quantity_on_hand,
            movement_type: 'adjustment',
            reason:
              'Stock base reiniciado: producto transicionó a inventario por variantes',
            notes:
              'Stock base reiniciado: producto transicionó a inventario por variantes',
            user_id,
            created_at: new Date(),
          },
        });
      }
    }

    // Sync product stock after clearing
    await this.syncProductStock(prisma, product_id);

    return [...new Set(locationIds)];
  }

  /**
   * Sincroniza el stock agregado con products.stock_quantity y product_variants.stock_quantity
   * - Si variant_id está presente, sincroniza esa variante específica
   * - Si el producto tiene variantes, solo suma stock de variantes (excluye stock base)
   * - Si no tiene variantes, suma todo el stock (comportamiento legacy)
   */
  async syncProductStock(
    prisma: any,
    product_id: number,
    variant_id?: number,
  ): Promise<void> {
    // 1. Si hay variant_id, sincronizar esa variante específica
    if (variant_id) {
      const variant_stock = await prisma.stock_levels.aggregate({
        where: {
          product_id: product_id,
          product_variant_id: variant_id,
        },
        _sum: {
          quantity_available: true,
        },
      });

      await prisma.product_variants.update({
        where: { id: variant_id },
        data: {
          stock_quantity: variant_stock._sum.quantity_available || 0,
          updated_at: new Date(),
        },
      });
    }

    // 2. Check if product has variants
    const variantCount = await prisma.product_variants.count({
      where: { product_id: product_id },
    });

    // 3. Build the aggregate filter: exclude base stock when variants exist
    const stockFilter: any = { product_id: product_id };
    if (variantCount > 0) {
      stockFilter.product_variant_id = { not: null };
    }

    const total_stock = await prisma.stock_levels.aggregate({
      where: stockFilter,
      _sum: {
        quantity_available: true,
      },
    });

    // Actualizar products.stock_quantity
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
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
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
   * Initializes stock levels for a variant at the given locations with quantity 0.
   */
  async initializeVariantStockAtLocations(
    product_id: number,
    variant_id: number,
    location_ids: number[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;
    const basePrisma = (prisma as any)._baseClient || prisma;

    for (const location_id of location_ids) {
      const existing = await basePrisma.stock_levels.findFirst({
        where: {
          product_id,
          product_variant_id: variant_id,
          location_id,
        },
      });

      if (!existing) {
        await basePrisma.stock_levels.create({
          data: {
            product_id,
            product_variant_id: variant_id,
            location_id,
            quantity_on_hand: 0,
            quantity_reserved: 0,
            quantity_available: 0,
            last_updated: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      }
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

  async transferBaseStockToVariants(
    product_id: number,
    variant_ids: number[],
    user_id: number,
    mode: 'first' | 'distribute' | 'reset',
    tx?: Prisma.TransactionClient,
  ): Promise<number[]> {
    const prisma: any = tx || this.prisma;
    const basePrisma = prisma._baseClient || prisma;

    const baseStockLevels = await basePrisma.stock_levels.findMany({
      where: {
        product_id,
        product_variant_id: null,
      },
    });

    const locationIds: number[] = [];

    if (mode === 'reset') {
      for (const sl of baseStockLevels) {
        locationIds.push(sl.location_id);

        if (sl.quantity_on_hand > 0) {
          await basePrisma.stock_levels.update({
            where: { id: sl.id },
            data: {
              quantity_on_hand: 0,
              quantity_available: 0,
              last_updated: new Date(),
              updated_at: new Date(),
            },
          });

          await this.createStockTransferAuditEntries(
            basePrisma,
            product_id,
            null,
            sl.location_id,
            -sl.quantity_on_hand,
            user_id,
            'Stock base reiniciado: producto transicionó a inventario por variantes',
          );
        }
      }
    } else {
      for (const sl of baseStockLevels) {
        locationIds.push(sl.location_id);
        const totalStock = sl.quantity_on_hand;

        if (totalStock <= 0) continue;

        for (const variant_id of variant_ids) {
          await this.getOrCreateStockLevel(
            prisma,
            product_id,
            variant_id,
            sl.location_id,
          );
        }

        const distribution = this.calculateStockDistribution(
          totalStock,
          variant_ids.length,
          mode,
        );

        for (let i = 0; i < variant_ids.length; i++) {
          const allocated = distribution[i];
          if (allocated > 0) {
            const variantSl = await basePrisma.stock_levels.findFirst({
              where: {
                product_id,
                product_variant_id: variant_ids[i],
                location_id: sl.location_id,
              },
            });

            if (variantSl) {
              const newQty = (variantSl.quantity_on_hand || 0) + allocated;
              const newReserved = variantSl.quantity_reserved || 0;
              await basePrisma.stock_levels.update({
                where: { id: variantSl.id },
                data: {
                  quantity_on_hand: newQty,
                  quantity_available: newQty - newReserved,
                  last_updated: new Date(),
                  updated_at: new Date(),
                },
              });
            }
          }
        }

        await basePrisma.stock_levels.update({
          where: { id: sl.id },
          data: {
            quantity_on_hand: 0,
            quantity_available: 0,
            last_updated: new Date(),
            updated_at: new Date(),
          },
        });

        await this.createStockTransferAuditEntries(
          basePrisma,
          product_id,
          null,
          sl.location_id,
          -totalStock,
          user_id,
          `Stock base transferido a variantes (modo: ${mode === 'first' ? 'primera variante' : 'distribuido'})`,
        );
      }
    }

    await this.enforceStockLevelsMode(prisma, product_id);

    return [...new Set(locationIds)];
  }

  /**
   * Mantiene stock_levels coherente con el modo del producto.
   * - Producto con variantes: elimina filas base (product_variant_id IS NULL).
   * - Producto sin variantes: no-op (las filas de variantes se eliminan al borrar la variante).
   *
   * Invariante: un producto NUNCA coexiste con filas base y filas de variante simultáneamente.
   * Esto evita doble conteo en findOne/findAll y stock fantasma heredado de transiciones previas.
   */
  async enforceStockLevelsMode(prisma: any, product_id: number): Promise<void> {
    const basePrisma = prisma._baseClient || prisma;
    const variantCount = await basePrisma.product_variants.count({
      where: { product_id },
    });

    if (variantCount > 0) {
      await basePrisma.stock_levels.deleteMany({
        where: {
          product_id,
          product_variant_id: null,
        },
      });
    }

    await this.syncProductStock(prisma, product_id);
  }

  async transferVariantStockToBase(
    product_id: number,
    variant_ids: number[],
    user_id: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma: any = tx || this.prisma;
    const basePrisma = prisma._baseClient || prisma;

    const variantStockLevels = await basePrisma.stock_levels.findMany({
      where: {
        product_id,
        product_variant_id: { in: variant_ids },
      },
    });

    const stockByLocation = new Map<number, number>();
    for (const sl of variantStockLevels) {
      const current = stockByLocation.get(sl.location_id) || 0;
      stockByLocation.set(sl.location_id, current + sl.quantity_on_hand);
    }

    for (const [location_id, totalQuantity] of stockByLocation) {
      await this.getOrCreateStockLevel(
        prisma,
        product_id,
        undefined,
        location_id,
      );

      const baseSl = await basePrisma.stock_levels.findFirst({
        where: {
          product_id,
          product_variant_id: null,
          location_id,
        },
      });

      if (baseSl && totalQuantity > 0) {
        const newQty = (baseSl.quantity_on_hand || 0) + totalQuantity;
        const newReserved = baseSl.quantity_reserved || 0;
        await basePrisma.stock_levels.update({
          where: { id: baseSl.id },
          data: {
            quantity_on_hand: newQty,
            quantity_available: newQty - newReserved,
            last_updated: new Date(),
            updated_at: new Date(),
          },
        });

        await this.createStockTransferAuditEntries(
          basePrisma,
          product_id,
          null,
          location_id,
          totalQuantity,
          user_id,
          'Stock de variantes transferido al producto base al desactivar variantes',
        );
      }
    }

    for (const sl of variantStockLevels) {
      if (sl.quantity_on_hand > 0) {
        await basePrisma.stock_levels.update({
          where: { id: sl.id },
          data: {
            quantity_on_hand: 0,
            quantity_available: 0,
            last_updated: new Date(),
            updated_at: new Date(),
          },
        });

        await this.createStockTransferAuditEntries(
          basePrisma,
          product_id,
          sl.product_variant_id,
          sl.location_id,
          -sl.quantity_on_hand,
          user_id,
          'Stock de variante transferido al producto base',
        );
      }
    }

    await this.syncProductStock(prisma, product_id);
  }

  private calculateStockDistribution(
    totalStock: number,
    variantCount: number,
    mode: 'first' | 'distribute' | 'reset',
  ): number[] {
    const distribution = new Array(variantCount).fill(0);

    if (mode === 'first') {
      distribution[0] = totalStock;
    } else if (mode === 'distribute') {
      const perVariant = Math.floor(totalStock / variantCount);
      const remainder = totalStock - perVariant * variantCount;

      for (let i = 0; i < variantCount; i++) {
        distribution[i] = perVariant;
      }
      distribution[0] += remainder;
    }

    return distribution;
  }

  private async createStockTransferAuditEntries(
    prisma: any,
    product_id: number,
    variant_id: number | null,
    location_id: number,
    quantity_change: number,
    user_id: number,
    reason: string,
  ): Promise<void> {
    await this.transactionsService.createTransaction(
      {
        productId: product_id,
        type: 'adjustment_damage',
        quantityChange: quantity_change,
        reason,
        userId: user_id,
      },
      prisma,
    );

    const context = RequestContextService.getContext();
    const organization_id =
      context?.organization_id || (await this.getOrganizationId(product_id));

    await prisma.inventory_movements.create({
      data: {
        organization_id,
        product_id,
        product_variant_id: variant_id,
        from_location_id: location_id,
        to_location_id: location_id,
        quantity: Math.abs(quantity_change),
        movement_type: 'adjustment',
        reason,
        notes: reason,
        user_id,
        created_at: new Date(),
      },
    });
  }
}
