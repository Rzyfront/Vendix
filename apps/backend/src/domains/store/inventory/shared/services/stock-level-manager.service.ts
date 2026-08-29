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
import { mergeStoreSettingsWithDefaults } from '../../../settings/defaults/default-store-settings';
import type { StoreSettings } from '../../../settings/interfaces/store-settings.interface';
import { resolveStockLevelLowStockThreshold } from '../helpers/low-stock-threshold.helper';
import { sellableLocationsWhere } from '../helpers/pos-stock-scope.helper';
import { syncDenormalizedProductStock } from '../helpers/sync-product-stock.helper';
import { CostingService } from './costing.service';
import {
  CostingMethodResolverService,
  ResolvedCostingMethod,
} from './costing-method-resolver.service';

/**
 * Espacio de nombres de una reserva. `stock_reservations.reserved_for_id` es un
 * id de OTRA tabla y sólo significa algo junto a este tipo: la llave real es el
 * par `(reserved_for_type, reserved_for_id)`, nunca el id suelto.
 *
 * `dispatch_note` existe porque las remisiones standalone (sin `sales_order_id`
 * ni `order_id`) llavean por `dispatch_notes.id` y antes lo hacían bajo `order`
 * — de modo que la remisión #42 y la orden #42 compartían llave. Cualquier
 * lectura, liberación o conteo de reservas DEBE pasar el tipo que corresponde a
 * la tabla de la que salió el id; mezclar los dos vuelve a abrir la colisión.
 */
export type ReservationRefType =
  | 'order'
  | 'transfer'
  | 'adjustment'
  | 'layaway'
  | 'dispatch_note';

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
    | 'initial'
    | 'production'
    | 'consumption';
  reason?: string;
  user_id?: number;
  order_item_id?: number;
  create_movement?: boolean;
  validate_availability?: boolean;
  from_location_id?: number;
  to_location_id?: number;
  source_module?: string;
  unit_cost?: number;
  /**
   * Costo real del movimiento individual (e.g. costo unitario de la recepción
   * de compra). A diferencia de `unit_cost` — que es el CPP/cost_per_unit
   * a persistir en `stock_levels` — `movement_unit_cost` se usa solo para
   * valorar este movimiento puntual (asiento, snapshot, cost layer) sin
   * sobrescribir el CPP del stock.
   */
  movement_unit_cost?: number;
  /**
   * Método de costeo a aplicar en movimientos de salida (consumo negativo).
   * Si no se provee, `executeStockUpdate` lo resuelve internamente vía
   * `CostingMethodResolverService` (precedencia ORG → STORE → default
   * `'weighted_average'`) usando el contexto de request o el store_id del
   * stock_level como fallback. Pasar el método resuelto explícitamente
   * mejora la observabilidad y evita una segunda lectura cuando el caller
   * ya lo conoce (e.g. `PurchaseOrdersService` en recepción).
   */
  costing_method?: ResolvedCostingMethod;
  /**
   * QUI-651 — sesión de la estación de KDS que consumió el insumo. Solo la pasa
   * el fire; el resto de los flujos la dejan sin definir.
   *
   * Se persiste en `inventory_transactions.kds_session_id` y responde una
   * pregunta distinta a `user_id`: ese es quién PIDIÓ que se cocine, esta es
   * quién COCINÓ. NULL es un caso válido — el fire consume al disparar, que
   * puede ocurrir antes de que la estación abra sesión.
   */
  kds_session_id?: number | null;
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
    private readonly costingService: CostingService,
    private readonly costingMethodResolver: CostingMethodResolverService,
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
      select: {
        track_inventory: true,
        store_id: true,
        name: true,
        cost_price: true,
      },
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

    // RECORTE A CERO — red residual, NO la política de sobreventa.
    //
    // La sobreventa se bloquea AGUAS ARRIBA, y con mensaje al usuario:
    //   - venta POS  → `payments.service.ts` fija `allowOversell = false` y
    //     lanza `POS_STOCK_INSUFFICIENT_001` nombrando requerido y disponible;
    //   - reserva    → `reserveStock` lanza `INV_STOCK_001` antes de escribir
    //     un disponible negativo (ver ~689 y ~771 en este mismo archivo);
    //   - entrega    → `order-stock-commit.service.ts` lanza `INV_STOCK_002`.
    //
    // Este `Math.max(0, …)` sólo puede actuar en un camino que NO pasó por esas
    // guardas (ajustes, producción, integraciones) o si una de ellas pierde una
    // carrera. Cuando actúa, oculta el faltante: el cero de descuadre se ve
    // idéntico al cero de "se agotó normal". Por eso no es inofensivo, pero
    // tampoco es lo que gobierna la venta.
    //
    // `store_settings.inventory.allow_negative_stock` NO lo controla — nadie la
    // lee (ver settings-schemas.dto.ts). Si algún día se quiere que el faltante
    // quede registrado en vez de taparse, hay que tocar los cuatro sitios a la
    // vez: aquí (~223 y ~992), movements.service.ts (~371, ~382),
    // inventory-integration.service.ts (~228) y
    // sellable-stock-allocator.service.ts (~108-130).
    const stockUpdateData: any = {
      quantity_on_hand: Math.max(0, new_quantity_on_hand),
      quantity_available: Math.max(0, new_quantity_available),
      last_updated: new Date(),
      updated_at: new Date(),
    };

    if (params.quantity_change > 0 && params.unit_cost !== undefined) {
      stockUpdateData.cost_per_unit = new Prisma.Decimal(params.unit_cost);
    } else if (params.quantity_change > 0) {
      // Fix colapso CPP — semillado central del costo. Entrada de stock SIN
      // costo explícito (crear/editar producto, ajustes, importación, seeds):
      // si la fila quedaría con `cost_per_unit` NULL/0, sembrarlo desde el
      // `cost_price` de la variante/producto para que el stock histórico aporte
      // su valor real al CPP en vez de 0. Reglas duras:
      //   (a) NUNCA sembrar en salidas (quantity_change <= 0): ventas/consumos
      //       no deben tocar el costo (rama else-if ya excluye ese caso).
      //   (b) NUNCA clobberear un cost_per_unit ya válido (>0) existente.
      //   (c) Solo sembrar si hay un cost_price > 0 disponible.
      const currentCost = Number(existing_stock_level.cost_per_unit) || 0;
      if (currentCost <= 0) {
        let seedCost = 0;
        if (params.variant_id) {
          const variantForCost = await prisma.product_variants.findUnique({
            where: { id: params.variant_id },
            select: { cost_price: true },
          });
          seedCost =
            Number(variantForCost?.cost_price) ||
            Number(productForTracking.cost_price) ||
            0;
        } else {
          seedCost = Number(productForTracking.cost_price) || 0;
        }
        if (seedCost > 0) {
          stockUpdateData.cost_per_unit = new Prisma.Decimal(seedCost);
        }
      }
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
        // QUI-651 — dueño del consumo por estación, y el costo del movimiento.
        // `movementCostSnapshot` ya está calculado en este punto (se resuelve
        // antes, para los cost layers), así que la fila nace con su costo en vez
        // de necesitar un UPDATE posterior.
        kdsSessionId: params.kds_session_id ?? null,
        unitCost: movementCostSnapshot?.unit_cost ?? null,
        totalCost: movementCostSnapshot?.total_cost ?? null,
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
    const settings = await this.loadMergedSettingsForStore(
      prisma,
      productForTracking.store_id,
    );
    const low_threshold = resolveStockLevelLowStockThreshold(
      settings,
      existing_stock_level,
    );
    if (
      updated_stock.quantity_available <= low_threshold &&
      updated_stock.quantity_available >= 0
    ) {
      if (productForTracking.store_id) {
        this.eventEmitter.emit('stock.low', {
          store_id: productForTracking.store_id,
          location_id: params.location_id,
          product_id: params.product_id,
          product_name: productForTracking.name || 'Producto',
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
    // El `costing_method` persistido en el snapshot debe reflejar el método
    // que efectivamente se aplicó al consumo (FIFO vs CPP), no un literal
    // fijo. Para recepciones (+) siempre aplicamos CPP; para salidas (-) el
    // caller o el resolver ya decidió. Fallback = CPP.
    const snapshotCostingMethod: ResolvedCostingMethod =
      params.costing_method ??
      (params.quantity_change < 0
        ? await this.resolveCostingMethodForStockUpdate(prisma, params, stockLevel)
        : 'weighted_average');
    // unit_cost del snapshot = costo del movimiento individual
    // (no el CPP del stock; ese se usa para valorar el inventario abajo).
    const unitCost =
      Number(movementCostSnapshot?.unit_cost || 0) ||
      Number(stockLevel.cost_per_unit || 0) ||
      Number(variant?.cost_price || 0) ||
      Number(product?.cost_price || 0);
    // total_value (valor del stock post-update) usa el CPP vigente del
    // stock_level — que ya refleja el unit_cost recién persistido si llegó.
    // Fallback al unit_cost del movimiento solo si el CPP es 0.
    const valuationCost = Number(stockLevel.cost_per_unit || 0) || unitCost;
    const stockValue = Number(stockLevel.quantity_on_hand || 0) * valuationCost;
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
        costing_method: snapshotCostingMethod,
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
      // Precedencia: movement_unit_cost (costo real de la recepción) →
      // unit_cost (CPP a persistir) → cost_per_unit existente → 0.
      const unitCost = Number(
        params.movement_unit_cost ?? params.unit_cost ?? stockLevel.cost_per_unit ?? 0,
      );
      return { unit_cost: unitCost, total_cost: unitCost * quantity };
    }

    // Consumo negativo (COGS): delegar al helper que respeta el método
    // configurado (FIFO / weighted_average) en lugar de quemar FIFO
    // hardcodeado. `costing_method` se resuelve aquí mismo si el caller
    // no lo proveyó.
    const costingMethod =
      params.costing_method ??
      (await this.resolveCostingMethodForStockUpdate(prisma, params, stockLevel));

    const totalCost = await this.costingService.consumeCostLayers(
      {
        product_id: params.product_id,
        variant_id: params.variant_id,
        location_id: params.location_id,
        quantity,
        costing_method: costingMethod,
      },
      prisma,
    );

    const unitCost =
      totalCost > 0
        ? totalCost / quantity
        : Number(stockLevel.cost_per_unit ?? 0);
    return { unit_cost: unitCost, total_cost: totalCost };
  }

  /**
   * Resuelve el `costing_method` efectivo para un movimiento de salida
   * usando el precedence ORG → STORE → default `'weighted_average'`.
   *
   * El contexto (organization_id, store_id) puede venir del AsyncLocalStorage
   * vía `RequestContextService`. Si no hay contexto suficiente (e.g. jobs /
   * listeners fuera de una request HTTP), hace fallback leyendo el
   * `stock_level` (`products.store_id` y `inventory_locations.organization_id`).
   * Nunca lanza: cualquier error cae al default.
   */
  private async resolveCostingMethodForStockUpdate(
    prisma: any,
    params: UpdateStockParams,
    stockLevel: any,
  ): Promise<ResolvedCostingMethod> {
    const context = RequestContextService.getContext();
    let organizationId: number | undefined = context?.organization_id ?? undefined;
    let storeId: number | undefined = context?.store_id ?? undefined;

    if (!organizationId || storeId === undefined) {
      try {
        if (!organizationId) {
          const location = await prisma.inventory_locations.findUnique({
            where: { id: params.location_id },
            select: { organization_id: true },
          });
          organizationId = location?.organization_id ?? undefined;
        }
        if (storeId === undefined) {
          const product = await prisma.products.findUnique({
            where: { id: params.product_id },
            select: { store_id: true },
          });
          storeId = product?.store_id ?? undefined;
        }
        if (storeId === undefined && stockLevel) {
          const location = await prisma.inventory_locations.findUnique({
            where: { id: stockLevel.location_id },
            select: { store_id: true },
          });
          storeId = location?.store_id ?? undefined;
        }
      } catch (err) {
        // Ignore — resolveCostingMethod will fall back to default.
      }
    }

    if (!organizationId) {
      return 'weighted_average';
    }

    return this.costingMethodResolver.resolveCostingMethod(
      organizationId,
      storeId ?? undefined,
    );
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
   * Priority: sellable location with highest available stock → first sellable
   * location of the SAME store as fallback.
   *
   * QUI-559: both queries used to be unscoped — the first ranked every
   * `stock_levels` row in the database by availability, so it could resolve a
   * central warehouse, an inactive location, a quarantine bin, or even another
   * store's location; the fallback then took any location of the organization.
   * A sale deducted from wherever it landed, which is how stock ended up
   * consumed from places the POS never displays. Both now share the canonical
   * sellable predicate, and no sellable location is an explicit `INV_LOC_001`
   * instead of an arbitrary pick.
   */
  async getDefaultLocationForProduct(
    product_id: number,
    variant_id?: number,
    /**
     * Optional Prisma transaction client. When provided, the location lookups
     * run inside the caller's $transaction instead of on a separate pool
     * connection. Used by `KitchenFireService.prepareFireContext` when the
     * caller has the payment transaction open (CP-POLLO-ARABE-727 A.7 — avoids
     * the pool leak). All the external callers omit it and use the scoped
     * client.
     */
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new VendixHttpException(ErrorCodes.INV_CONTEXT_001);
    }
    const sellable = sellableLocationsWhere(context.store_id);

    const stockLevel = await (tx ?? this.prisma).stock_levels.findFirst({
      where: {
        product_id,
        product_variant_id: variant_id || null,
        quantity_available: { gt: 0 },
        inventory_locations: sellable,
      },
      orderBy: [{ quantity_available: 'desc' }, { location_id: 'asc' }],
      select: { location_id: true },
    });
    if (stockLevel) return stockLevel.location_id;

    const location = await (tx ?? this.prisma).inventory_locations.findFirst({
      where: sellable,
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    if (!location) throw new VendixHttpException(ErrorCodes.INV_LOC_001);
    return location.id;
  }

  /**
   * Reserva stock para una orden.
   *
   * @param stock_units_consumed (multi-tarifa) Cuando es un número > 0, este
   *   valor se usa como la cantidad real a reservar en `stock_levels` en
   *   lugar de `quantity`. Lo usa OrdersService cuando una tarifa resuelve un
   *   packSize > 1 (price_tiers.units_per_package o el override por producto
   *   product_price_tier_overrides.override_units_per_package): el caller
   *   calcula `quantity * packSize` y lo pasa explícito.
   *
   *   El método no decide la equivalencia caja/unidad — solo respeta el
   *   override numérico. Si es undefined u <= 0, comportamiento legacy
   *   (reservar `quantity`).
   *
   * @param skip_reservation Cuando es `true`, el método se vuelve no-op:
   *   - NO crea fila en `stock_reservations`.
   *   - NO muta `stock_levels` (qty_reserved / qty_available no cambian).
   *   - NO sincroniza `products.stock_quantity`.
   *
   *   Caso de uso (P3.4 — ecommerce auto-fulfillment): cuando una orden de
   *   ecommerce ya tiene una reserva activa en la bodega central y se genera
   *   un transfer automático para despacharla, el `dispatch` del transfer
   *   debe consumir la reserva existente y decrementar `quantity_on_hand`
   *   exactamente UNA vez. Si el transfer creara su propia reserva (default)
   *   se produciría doble decremento sobre `quantity_available`.
   *
   *   El caller que pase `true` es responsable de garantizar que existe una
   *   reserva upstream que cubre la misma cantidad.
   *
   * @param allow_negative_available (QUI-557) Permite que la reserva deje
   *   `quantity_available` por debajo de cero. Por defecto `false`: la reserva
   *   falla con `INV_STOCK_001` antes de escribir un disponible negativo.
   *
   *   Existe porque `validate_availability = false` se usa hoy con DOS
   *   intenciones distintas que el flag no distingue:
   *
   *     a) "ya validé arriba" — checkout, payments, `reactivateOrder` y el
   *        listener de remisiones. Ahí un disponible negativo significa que la
   *        validación previa era incorrecta o perdió una carrera, y el sistema
   *        debe fallar fuerte en vez de corromper la fila.
   *     b) "vender igual" — POS y el pago de una orden, donde sobrevender es
   *        comportamiento de producto deliberado ("non-restrictive UX").
   *
   *   Antes de este parámetro ambas caían en el paso 4, que resta sin mirar, y
   *   el caso (a) escribía disponibles negativos en silencio. Ese negativo
   *   contamina toda lectura posterior de la bodega. Solo el caso (b) pasa
   *   `true`, y lo hace de forma explícita y nombrada.
   */
  async reserveStock(
    product_id: number,
    variant_id: number | undefined,
    location_id: number,
    quantity: number,
    reserved_for_type: ReservationRefType,
    reserved_for_id: number,
    user_id?: number,
    validate_availability = true,
    tx?: any,
    expires_at?: Date | null,
    skip_reservation = false,
    stock_units_consumed?: number,
    allow_negative_available = false,
  ): Promise<void> {
    // P3.4: cuando una reserva upstream ya cubre el stock, evitar doble
    // decremento manteniendo este método como no-op.
    if (skip_reservation) {
      return;
    }

    // Multi-tarifa: cuando el caller pasa una cantidad explícita de stock
    // a consumir (caja con package_consumes_multiple_stock), usamos ese
    // valor; en caso contrario, la cantidad lógica de la línea de venta.
    const effectiveQuantity =
      typeof stock_units_consumed === 'number' && stock_units_consumed > 0
        ? stock_units_consumed
        : quantity;

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
      if (
        validate_availability &&
        stock_level.quantity_available < effectiveQuantity
      ) {
        throw new ConflictException(
          'Insufficient stock available for reservation',
        );
      }

      // 2b. QUI-557 — Piso duro: ninguna reserva escribe un disponible
      // negativo salvo que el caller lo autorice explícitamente. El paso 4
      // resta sin mirar, así que con `validate_availability = false` una
      // reserva sobre una identidad sin existencias dejaba la fila en
      // `quantity_available = -N`. Ese negativo no se queda quieto: toda
      // lectura posterior de esa bodega — incluido el gate de la remisión —
      // hereda el faltante y reporta "sin stock" a órdenes que no tienen nada
      // que ver. Fallar aquí deja el error donde se origina.
      const resulting_available =
        stock_level.quantity_available - effectiveQuantity;
      if (!allow_negative_available && resulting_available < 0) {
        throw new VendixHttpException(
          ErrorCodes.INV_STOCK_001,
          `La reserva de ${effectiveQuantity} unidad(es) dejaría el disponible en ${resulting_available} (producto ${product_id}${
            variant_id ? `, variante ${variant_id}` : ''
          }, bodega ${location_id}).`,
        );
      }

      // 3. Crear reserva
      await prisma.stock_reservations.create({
        data: {
          organization_id: organization_id,
          product_id: product_id,
          product_variant_id: variant_id,
          location_id: location_id,
          quantity: effectiveQuantity,
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
          quantity_reserved: stock_level.quantity_reserved + effectiveQuantity,
          quantity_available: resulting_available,
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
    reserved_for_type: ReservationRefType,
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
   *
   * Reglas según `status`:
   * - `consumed` (default): el stock reservado se considera entregado físicamente.
   *   - `decrementOnHand` no especificado o `true` (default): decrementa
   *     `quantity_on_hand` por el total reservado (caso normal: la entrega
   *     sale de esta ubicación).
   *   - `decrementOnHand: false`: NO toca `quantity_on_hand`. Solo libera
   *     el `quantity_reserved` y recalcula `quantity_available`. Caso de uso
   *     P3.4 (ecommerce auto-fulfillment): cuando un dispatch o transfer
   *     ya decrementó `quantity_on_hand` upstream a través de `updateStock`,
   *     consumir la reserva original sin volver a decrementar evita doble
   *     conteo sobre la bodega central.
   * - `cancelled`: la reserva se aborta sin entrega física. Restaura
   *   `quantity_available` y NO toca `quantity_on_hand`. La opción
   *   `decrementOnHand` se ignora en este branch.
   */
  async releaseReservationsByReference(
    reserved_for_type: ReservationRefType,
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
      // Restaurant suite Fase C: the new movement types reuse the
      // existing transaction types — 'consumption' is a stock-out
      // (audit side) while 'production' is a stock-in. The actual
      // inventory side-effect is decided by the SIGN of quantity_change
      // inside `calculateAndConsumeMovementCost`.
      production: 'stock_in',
      consumption: 'stock_in',
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

    // `quantity` es una MAGNITUD; la dirección la llevan las dos patas de
    // ubicación. Antes se rellenaba `to_location_id` incluso en las salidas y
    // `from_location_id` quedaba null en ambos sentidos, así que la fila no
    // permitía saber si el stock entró o salió: un ajuste que subía de 100 a 120
    // se pintaba "−20" porque la UI tenía que adivinar por el tipo. Un traslado
    // pasa las dos patas explícitas y no cambia de comportamiento.
    const isOutbound = Number(params.quantity_change) < 0;
    const fromLocationId =
      params.from_location_id ?? (isOutbound ? params.location_id : null);
    const toLocationId =
      params.to_location_id ?? (isOutbound ? null : params.location_id);

    await prisma.inventory_movements.create({
      data: {
        organization_id: organization_id,
        product_id: params.product_id,
        product_variant_id: params.variant_id,
        from_location_id: fromLocationId,
        to_location_id: toLocationId,
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
    // La lógica vive en un helper suelto para que los jobs de cron —que mutan
    // `stock_levels` con el cliente global y no pueden inyectar este servicio
    // scoped— usen EXACTAMENTE la misma fórmula.
    await syncDenormalizedProductStock(prisma, product_id, variant_id);
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
   * Obtiene los stock levels de UNA identidad de inventario concreta.
   *
   * LECTURA CANÓNICA (QUI-557). La identidad de una fila de `stock_levels` es
   * la tripleta `(product_id, product_variant_id, location_id)` — así lo
   * declara el `@@unique` del modelo. Por lo tanto `product_variant_id` SIEMPRE
   * se filtra de forma explícita, incluido el caso `null`:
   *
   *   - `variant_id` presente  → filas de esa variante.
   *   - `variant_id` ausente   → filas de la LÍNEA BASE (`product_variant_id IS NULL`).
   *
   * Antes el filtro se omitía cuando `variant_id` era `undefined`
   * (`...(variant_id && {...})`), de modo que una línea base recibía además las
   * filas de todas sus variantes. Combinado con el `.find()` de
   * `StockValidatorService.getStockLevelAtLocation` eso seleccionaba una fila
   * ARBITRARIA (el orden lo decidía el heap de Postgres): la remisión reportaba
   * "sin stock" con existencias intactas, y carrito/checkout —que agregan sin
   * `location_id`— sumaban base + variantes habilitando oversell.
   *
   * El `orderBy` fija además un orden determinista: dos lecturas idénticas
   * devuelven las filas en la misma secuencia.
   *
   * Una variante NO es despachable como producto base ni viceversa, así que
   * mezclar ambas identidades nunca es la lectura correcta.
   */
  async getStockLevels(
    product_id: number,
    variant_id?: number,
  ): Promise<any[]> {
    return await this.prisma.stock_levels.findMany({
      where: {
        product_id: product_id,
        product_variant_id: variant_id ?? null,
      },
      orderBy: { location_id: 'asc' },
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
    const [product, stock_levels] = await Promise.all([
      this.prisma.products.findUnique({
        where: { id: product_id },
        select: { store_id: true },
      }),
      this.prisma.stock_levels.findMany({
        where: {
          product_id: product_id,
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
      }),
    ]);

    const settings = await this.loadMergedSettingsForStore(
      this.prisma,
      product?.store_id,
    );
    return stock_levels.filter((stockLevel) => {
      const threshold = resolveStockLevelLowStockThreshold(
        settings,
        stockLevel,
      );
      return Number(stockLevel.quantity_available ?? 0) <= threshold;
    });
  }

  private async loadMergedSettingsForStore(
    prisma: any,
    storeId: number | null | undefined,
  ): Promise<StoreSettings> {
    if (!storeId || !prisma.store_settings?.findFirst) {
      return mergeStoreSettingsWithDefaults(undefined);
    }

    const row = await prisma.store_settings.findFirst({
      where: { store_id: storeId },
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings);
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

  /**
   * Convierte TODO lo que un producto tiene expresado en su unidad de stock a
   * otra unidad de la misma dimensión, en una sola transacción.
   *
   * Cambiar la unidad no es renombrar una etiqueta: existencias, reservas,
   * puntos de reorden, capas de costo FIFO, lotes y líneas de receta están
   * escritos en esa unidad. Convertir solo `stock_levels` dejaría una receta
   * pidiendo 300 milímetros de lo que antes eran 300 gramos y una valuación
   * FIFO mintiendo por tres órdenes de magnitud.
   *
   * Dos reglas duras:
   * - **El historial no se reescribe.** `inventory_adjustments` e
   *   `inventory_movements` quedan en la unidad que tenían y la conversión se
   *   registra como un movimiento propio. Un ajuste de ayer ocurrió en gramos;
   *   decir lo contrario sería falsificar la auditoría.
   * - **Si el factor no divide exacto, se rechaza entera.** Convertir 250 g a
   *   kilos daría 0,25 y el inventario es `Int`: redondear perdería o
   *   inventaría mercancía. Antes de tocar una fila se validan todas.
   */
  async convertStockUom(params: {
    product_id: number;
    from_uom_id: number;
    to_uom_id: number;
    user_id?: number | null;
    tx?: any;
  }): Promise<{
    factor: number;
    from_code: string;
    to_code: string;
    stock_levels: number;
    cost_layers: number;
    batches: number;
    recipe_items: number;
  }> {
    const run = async (tx: any) => {
      const base = tx._baseClient || tx;
      const units = await base.units_of_measure.findMany({
        where: { id: { in: [params.from_uom_id, params.to_uom_id] } },
        select: {
          id: true,
          code: true,
          name: true,
          dimension: true,
          factor_to_base: true,
          is_stock_eligible: true,
        },
      });
      const from = units.find((u: any) => u.id === params.from_uom_id);
      const to = units.find((u: any) => u.id === params.to_uom_id);
      if (!from || !to) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VALIDATE_001,
          'La unidad de origen o de destino no existe en el catálogo.',
        );
      }
      if (from.dimension !== to.dimension) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VALIDATE_001,
          `No se puede convertir de ${from.code} a ${to.code}: son de dimensiones distintas.`,
        );
      }
      if (!to.is_stock_eligible) {
        throw new VendixHttpException(
          ErrorCodes.PROD_UOM_NOT_STOCK_ELIGIBLE,
          `${to.name} (${to.code}) no puede ser la unidad de stock porque su factor de conversión no es entero.`,
        );
      }

      // qty_destino = qty_origen × factor_origen / factor_destino.
      const factor = Number(from.factor_to_base) / Number(to.factor_to_base);
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VALIDATE_001,
          'El factor de conversión entre esas unidades no es válido.',
        );
      }

      const [levels, layers, batches, recipeLines] = await Promise.all([
        base.stock_levels.findMany({ where: { product_id: params.product_id } }),
        base.inventory_cost_layers.findMany({
          where: { product_id: params.product_id },
        }),
        base.inventory_batches.findMany({
          where: { product_id: params.product_id },
        }),
        base.recipe_items.findMany({
          where: { component_product_id: params.product_id },
        }),
      ]);

      // Validación previa: ninguna cantidad entera puede quedar fraccionaria.
      const assertExact = (value: number, label: string) => {
        const converted = value * factor;
        if (Math.abs(converted - Math.round(converted)) > 1e-9) {
          throw new VendixHttpException(
            ErrorCodes.PROD_VALIDATE_001,
            `No se puede convertir a ${to.code}: ${label} (${value} ${from.code}) quedaría en ${converted} y el inventario solo admite enteros.`,
          );
        }
        return Math.round(converted);
      };

      for (const level of levels) {
        assertExact(level.quantity_on_hand, 'una existencia');
        assertExact(level.quantity_reserved, 'una reserva');
        if (level.reorder_point != null) {
          assertExact(level.reorder_point, 'un punto de reorden');
        }
        if (level.max_stock != null) {
          assertExact(level.max_stock, 'un stock máximo');
        }
      }
      for (const layer of layers) {
        assertExact(layer.quantity_remaining, 'una capa de costo');
      }
      for (const batch of batches) {
        assertExact(batch.quantity, 'un lote');
        assertExact(batch.quantity_used, 'el consumo de un lote');
      }

      // A partir de acá ya no hay rechazos posibles: todo lo entero validó.
      for (const level of levels) {
        await base.stock_levels.update({
          where: { id: level.id },
          data: {
            quantity_on_hand: Math.round(level.quantity_on_hand * factor),
            quantity_reserved: Math.round(level.quantity_reserved * factor),
            quantity_available: Math.round(level.quantity_available * factor),
            reorder_point:
              level.reorder_point != null
                ? Math.round(level.reorder_point * factor)
                : null,
            max_stock:
              level.max_stock != null
                ? Math.round(level.max_stock * factor)
                : null,
            // El costo por unidad va al revés: si hay más unidades, cada una
            // cuesta proporcionalmente menos. El valor total del inventario no
            // cambia — convertir no compra ni vende nada.
            cost_per_unit:
              level.cost_per_unit != null
                ? Number(level.cost_per_unit) / factor
                : null,
            updated_at: new Date(),
          },
        });
      }

      for (const layer of layers) {
        await base.inventory_cost_layers.update({
          where: { id: layer.id },
          data: {
            quantity_remaining: Math.round(layer.quantity_remaining * factor),
            unit_cost: Number(layer.unit_cost) / factor,
          },
        });
      }

      for (const batch of batches) {
        await base.inventory_batches.update({
          where: { id: batch.id },
          data: {
            quantity: Math.round(batch.quantity * factor),
            quantity_used: Math.round(batch.quantity_used * factor),
            updated_at: new Date(),
          },
        });
      }

      // Las recetas piden cantidades decimales, así que acá no hay regla de
      // exactitud: 2 unidades pasan a 2000 mm y 0,5 kg a 500 g sin pérdida.
      for (const line of recipeLines) {
        await base.recipe_items.update({
          where: { id: line.id },
          data: {
            quantity: Number(line.quantity) * factor,
            waste_absolute: Number(line.waste_absolute ?? 0) * factor,
          },
        });
      }

      // La conversión queda registrada como movimiento propio. El historial
      // anterior NO se toca: cada ajuste ocurrió en la unidad de su momento.
      const product = await base.products.findFirst({
        where: { id: params.product_id },
        select: { id: true, store_id: true, stores: { select: { organization_id: true } } },
      });
      const organizationId = product?.stores?.organization_id;
      if (organizationId && levels.length > 0) {
        for (const level of levels) {
          // Una ubicación en cero no cambió de nada a nada: registrar un
          // movimiento de 0 solo ensucia la auditoría.
          if (level.quantity_on_hand === 0) continue;
          await base.inventory_movements.create({
            data: {
              organization_id: organizationId,
              product_id: params.product_id,
              product_variant_id: level.product_variant_id,
              from_location_id: level.location_id,
              to_location_id: level.location_id,
              quantity: Math.abs(
                Math.round(level.quantity_on_hand * factor) -
                  level.quantity_on_hand,
              ),
              movement_type: 'adjustment',
              source_module: 'products',
              reason: `Cambio de unidad de stock: ${from.code} → ${to.code} (×${factor})`,
              notes: `Cambio de unidad de stock: ${from.code} → ${to.code} (×${factor})`,
              user_id: params.user_id ?? null,
              created_at: new Date(),
            },
          });
        }
      }

      await this.syncProductStock(base, params.product_id);

      return {
        factor,
        from_code: from.code,
        to_code: to.code,
        stock_levels: levels.length,
        cost_layers: layers.length,
        batches: batches.length,
        recipe_items: recipeLines.length,
      };
    };

    return params.tx
      ? run(params.tx)
      : this.prisma.$transaction((tx) => run(tx), { timeout: 30000 });
  }
}
