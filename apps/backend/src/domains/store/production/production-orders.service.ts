import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { OrderStockCommitService } from '../inventory/shared/services/order-stock-commit.service';
import { RecipesService } from '../recipes/recipes.service';
import { S3Service } from '@common/services/s3.service';
import {
  createBatchAwareExploders,
  expandProduction,
  type ProductionLineInput,
} from '../kitchen-fire/addon-consumption';
import {
  StockValidatorService,
  StockDemandLine,
  type InsufficientStockItem,
} from '../inventory/shared/services/stock-validator.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import {
  VendixHttpException,
  ErrorCodes,
} from '../../../common/errors';
import {
  resolveStoreTimezone,
  localCivil,
  zonedWallClockToUtc,
} from '../../../common/utils/store-timezone.util';
import {
  CreateProductionOrderDto,
  UpdateProductionOrderDto,
  CompleteProductionOrderDto,
  ProductionOrderQueryDto,
} from './dto';

/**
 * Consumo efectivo de un componente durante un `complete()`.
 * Lo expone el hook `onProduced` y el payload del evento `production.completed`.
 */
export interface ProductionConsumption {
  component_product_id: number;
  consumed_qty: number;
  cost_snapshot: {
    unit_cost: number;
    total_cost: number;
    stock_value: number;
  } | null;
}

/** Datos que `complete()` entrega al hook `onProduced` dentro de la transacción. */
export interface ProductionCompletionInfo {
  order: { id: number; product_id: number; produced_qty: unknown; planned_qty: unknown };
  producedQty: number;
  producedUnitCost: number;
  totalCost: number;
  consumptions: ProductionConsumption[];
}

/**
 * Opciones OPCIONALES de `complete()`. Sin ellas el comportamiento es el del
 * restaurante (tandas enteras, `source_module='production'`, estado
 * `completed`). Las usa el módulo de manufactura.
 */
export interface CompleteProductionOptions {
  /** Permite cantidades que no sean múltiplo exacto del rendimiento. */
  allowPartialBatch?: boolean;
  /** `source_module` de los movimientos de inventario (default `production`). */
  sourceModule?: string;
  /** Bodega de la que se consumen los insumos (default: la del insumo). */
  inputLocationId?: number;
  /** Bodega a la que entra el terminado (default: la del producto). */
  outputLocationId?: number;
  /** Método de costeo de las salidas (default: el resuelto por la tienda). */
  costingMethod?: 'fifo' | 'weighted_average';
  /**
   * Hook dentro de la transacción, tras mover el stock. Puede devolver datos
   * extra para la orden (p. ej. `status`, `produced_qty` acumulado, `actual_cost`).
   */
  onProduced?: (
    tx: Prisma.TransactionClient,
    info: ProductionCompletionInfo,
  ) => Promise<Prisma.production_ordersUncheckedUpdateInput | void>;
}

/**
 * ProductionOrdersService
 *
 * Fase C of the Restaurant Suite — sub-recipe production (batch stock).
 *
 * At `complete()` we run a SINGLE Prisma transaction that:
 *  1) For every `recipe_items` line, consume the ingredient via
 *     `StockLevelManager.updateStock` with:
 *       - `movement_type = 'consumption'`
 *       - `quantity_change < 0`  (signo negativo → consume FIFO layers)
 *       - The sign branch in `calculateAndConsumeMovementCost` already
 *         handles FIFO for these new movement types.
 *     Per-line `waste_percent` and the recipe-level `waste_percent` are
 *     applied multiplicatively to inflate the consumed quantity.
 *  2) Sum the `cost_snapshot.total_cost` returned by every consumption to
 *     derive `unit_cost = Σ / produced_qty` of the finished good.
 *  3) Credit finished-goods stock with `updateStock`:
 *       - `movement_type = 'production'`
 *       - `quantity_change > 0` (signo positivo → crea cost layer CPP)
 *       - `unit_cost` = the value computed in step 2.
 *  4) Persist `produced_qty` + `produced_at` on the order and emit a
 *     `production.completed` event that the AccountingEventsListener picks
 *     up to post a balanced auto-entry (DR 1435 / CR 1435 by default — see
 *     `account-mapping.service` for the production_completed keys).
 *
 * Atomicity is non-negotiable: if any of the stock updates fails, the
 * transaction rolls back and no order status change is persisted.
 */
@Injectable()
export class ProductionOrdersService {
  private readonly logger = new Logger(ProductionOrdersService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly stockLevelManager: StockLevelManager,
    // No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md,
    // step 6) — tracked ingredients are validated BEFORE being consumed.
    private readonly stockValidatorService: StockValidatorService,
    private readonly eventEmitter: EventEmitter2,
    // QUI-995: only used by orders linked to a sale (add-ons, reservation,
    // detail). Manual and Planta orders never touch them.
    private readonly recipes?: RecipesService,
    private readonly orderStockCommit?: OrderStockCommitService,
    private readonly s3Service?: S3Service,
  ) {}

  /**
   * Consumed quantity for a single `recipe_items` line, scaled to the produced
   * quantity and net of line + recipe waste. Extracted so the no-overselling
   * pre-check (before the tx) and the real consumption (inside the tx) compute
   * the EXACT same number — they can never diverge on what is about to be
   * deducted.
   *
   * Recipe lines are expressed per recipe batch (`recipe.yield_quantity`), so
   * the scale factor is `producedQty / yield_quantity`. A missing/invalid/<=0
   * yield falls back to 1. Absolute waste is per batch and scales with the
   * factor. Rounding happens only once, at the very end.
   */
  private computeConsumedQty(
    item: {
      quantity: any;
      waste_percent?: any;
      waste_mode?: string | null;
      waste_absolute?: any;
    },
    recipeWastePct: number,
    producedQty: number,
    yieldQuantity?: any,
  ): number {
    const baseQty = Number(item.quantity);
    if (!Number.isFinite(baseQty) || baseQty <= 0) return 0;

    const yieldQty = Number(yieldQuantity);
    const safeYield = Number.isFinite(yieldQty) && yieldQty > 0 ? yieldQty : 1;
    const factor = producedQty / safeYield;

    const lineWastePct = Number(item.waste_percent || 0);
    const wasteMode = (item as any).waste_mode ?? 'percent';
    if (wasteMode === 'absolute') {
      const wasteAbs = Number((item as any).waste_absolute ?? 0);
      const safeWasteAbs = Number.isFinite(wasteAbs) ? wasteAbs : 0;
      const withLine = baseQty + safeWasteAbs;
      return Math.round(withLine * factor * (1 + recipeWastePct / 100));
    }
    const multiplier = (1 + lineWastePct / 100) * (1 + recipeWastePct / 100);
    return Math.round(baseQty * factor * multiplier);
  }

  /**
   * Cantidad requerida por componente para producir `qty` unidades, con merma
   * y escalado por rendimiento. Es EXACTAMENTE lo que `complete()` descuenta
   * (misma función), así manufactura calcula faltantes y líneas sin duplicar.
   */
  computeComponentRequirements(
    recipe: {
      waste_percent?: unknown;
      yield_quantity?: unknown;
      items: Array<{
        component_product_id: number;
        quantity: any;
        waste_percent?: any;
        waste_mode?: string | null;
        waste_absolute?: any;
      }>;
    },
    qty: number,
  ): Array<{ component_product_id: number; quantity: number }> {
    const recipeWastePct = Number(recipe.waste_percent || 0);
    return recipe.items.map((item) => ({
      component_product_id: item.component_product_id,
      quantity: this.computeConsumedQty(
        item,
        recipeWastePct,
        qty,
        recipe.yield_quantity,
      ),
    }));
  }

  /**
   * Production always runs whole recipe batches: a recipe that yields 10 can
   * produce 10, 20, 30… but never 3 or 25. This keeps the consumption factor
   * (`qty / yield_quantity`) a positive integer, so no ingredient line can be
   * rounded down to zero by a partial batch. A missing/invalid yield is
   * treated as 1 (any positive integer quantity is accepted).
   */
  private assertWholeBatches(
    qty: number,
    yieldQuantity: unknown,
    yieldUnit?: string | null,
  ): void {
    const yieldQty = Number(yieldQuantity);
    if (!Number.isFinite(yieldQty) || yieldQty <= 0) return;
    const batches = qty / yieldQty;
    const wholeBatches = Math.round(batches);
    if (wholeBatches >= 1 && Math.abs(batches - wholeBatches) < 1e-9) return;
    const unit = yieldUnit ? ` ${yieldUnit}` : '';
    throw new VendixHttpException(
      ErrorCodes.PRODUCTION_QTY_NOT_YIELD_MULTIPLE,
      `La receta rinde ${yieldQty}${unit} por tanda: la cantidad debe ser un múltiplo exacto (${yieldQty}, ${yieldQty * 2}, ${yieldQty * 3}…)`,
      { quantity: qty, yield_quantity: yieldQty },
    );
  }

  // ------------------------------------------------------------------ create
  async create(dto: CreateProductionOrderDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const [product, recipe] = await Promise.all([
      this.prisma.products.findFirst({
        where: { id: dto.product_id, store_id },
        select: {
          id: true,
          name: true,
          product_type: true,
          is_batch_produced: true,
          store_id: true,
        },
      }),
      this.prisma.recipes.findFirst({
        where: { id: dto.recipe_id, store_id },
        select: {
          id: true,
          product_id: true,
          is_active: true,
          yield_quantity: true,
          yield_unit: true,
        },
      }),
    ]);

    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }
    // Un insumo producido en lote es product_type='physical' (nunca 'prepared');
    // por eso la elegibilidad se basa SOLO en is_batch_produced.
    if (!product.is_batch_produced) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_ORDER_NOT_BATCH,
      );
    }
    if (!recipe) {
      throw new VendixHttpException(ErrorCodes.RECIPE_NOT_FOUND);
    }
    if (recipe.product_id !== product.id) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_RECIPE_MISMATCH,
      );
    }
    if (!recipe.is_active) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_RECIPE_INACTIVE,
      );
    }

    this.assertWholeBatches(
      Number(dto.planned_qty),
      recipe.yield_quantity,
      recipe.yield_unit,
    );

    const created = await this.prisma.production_orders.create({
      data: {
        store_id,
        product_id: dto.product_id,
        recipe_id: dto.recipe_id,
        planned_qty: new Prisma.Decimal(dto.planned_qty),
        status: 'draft',
      },
    });

    if (dto.notes) {
      // Persist notes via the dedicated update endpoint to keep the create
      // body lean. No-op here; the controller can call update() if needed.
    }

    return created;
  }

  // -------------------------------------------------------------------- find
  async findAll(query: ProductionOrderQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const {
      page = 1,
      limit = 25,
      search,
      status,
      product_id,
      recipe_id,
      order_id,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query ?? {};

    const skip = (page - 1) * limit;

    const where: Prisma.production_ordersWhereInput = {
      ...(status && { status }),
      ...(product_id && { product_id }),
      ...(recipe_id && { recipe_id }),
      ...(order_id && { order_id }),
      ...(search && {
        product: {
          name: { contains: search, mode: 'insensitive' },
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.production_orders.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order === 'asc' ? 'asc' : 'desc' },
        include: {
          product: {
            select: { id: true, name: true, sku: true, stock_unit: true },
          },
          recipe: {
            select: {
              id: true,
              yield_quantity: true,
              yield_unit: true,
              waste_percent: true,
            },
          },
          sale_order: { select: { order_number: true } },
        },
      }),
      this.prisma.production_orders.count({ where }),
    ]);

    return {
      data: data.map(({ sale_order, ...row }) => ({
        ...row,
        sale_order_number: sale_order?.order_number ?? null,
      })),
      total,
    };
  }

  async findOne(id: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const order = await this.prisma.production_orders.findFirst({
      where: { id, store_id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            stock_unit: true,
            is_batch_produced: true,
          },
        },
        recipe: {
          select: {
            id: true,
            yield_quantity: true,
            yield_unit: true,
            waste_percent: true,
            preparation_notes: true,
            items: {
              include: {
                component_product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    stock_unit: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(ErrorCodes.PRODUCTION_ORDER_NOT_FOUND);
    }

    return order;
  }

  // ------------------------------------------------------------------- start
  async start(id: number) {
    const order = await this.findOne(id);
    if (order.status !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_ORDER_INVALID_STATE,
        undefined,
        {
          from: order.status,
          to: 'in_progress',
        },
      );
    }
    return this.prisma.production_orders.update({
      where: { id },
      data: { status: 'in_progress', updated_at: new Date() },
    });
  }

  // ----------------------------------------------------------------- complete
  async complete(
    id: number,
    dto: CompleteProductionOrderDto,
    options?: CompleteProductionOptions,
  ) {
    const order = await this.findOne(id);
    // docs/plans/no-overselling-stock-guard-plan.md step 9 — the order's own
    // `store_id` (not just the request context) so the resolved policy is
    // always tied to the store that owns the recipe/stock being consumed.
    const store_id = (order as { store_id: number }).store_id;
    if (order.status === 'completed' || order.status === 'cancelled') {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_ORDER_INVALID_STATE,
        undefined,
        {
          from: order.status,
          to: 'completed',
        },
      );
    }

    // Stock columns (stock_levels.quantity_on_hand,
    // inventory_cost_layers.quantity_remaining) are Int. The produced quantity
    // can arrive fractional from the DTO (e.g. yield/waste-derived), so we
    // round to the integer minimum stock unit here — before it reaches
    // updateStock(movement_type='production') and before deriving
    // producedUnitCost = totalConsumedCost / producedQty — so the unit cost
    // uses the same integer quantity that is written to stock.
    const producedQty = Math.round(Number(dto.produced_qty));
    if (!Number.isFinite(producedQty) || producedQty <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_INVALID_QTY,
      );
    }

    const recipe = order.recipe;
    if (!recipe || !recipe.items || recipe.items.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_RECIPE_EMPTY,
      );
    }
    // QUI-995: a sale-linked order produces what was sold, not whole batches.
    const linkedOrderId = (order as { order_id?: number | null }).order_id ?? null;
    if (!options?.allowPartialBatch && linkedOrderId == null) {
      this.assertWholeBatches(
        producedQty,
        recipe.yield_quantity,
        recipe.yield_unit,
      );
    }
    const sourceModule = options?.sourceModule ?? 'production';

    // Resolve the location for the produced good. Uses the same default
    // resolver as the rest of the inventory flow so we don't surprise
    // operators with arbitrary location selection.
    const location_id =
      options?.outputLocationId ??
      (await this.stockLevelManager.getDefaultLocationForProduct(
        order.product_id,
      ));

    // No-overselling guard (docs/plans/no-overselling-stock-guard-plan.md,
    // step 6) — validate every tracked ingredient BEFORE opening the
    // transaction. `computeConsumedQty` is the SAME function the tx below
    // uses to actually deduct, so this check can never diverge from what
    // gets consumed. Untracked ingredients are skipped by the validator
    // itself (unlimited by definition).
    const recipeWastePctForCheck = Number(recipe.waste_percent || 0);
    const ingredientDemands: StockDemandLine[] = [];
    for (const item of recipe.items) {
      const consumedQty = this.computeConsumedQty(
        item,
        recipeWastePctForCheck,
        producedQty,
        recipe.yield_quantity,
      );
      if (consumedQty <= 0) continue;
      ingredientDemands.push({
        product_id: item.component_product_id,
        quantity: consumedQty,
        product_name: item.component_product?.name,
        used_by: order.product.name,
      });
    }
    // docs/plans/no-overselling-stock-guard-plan.md step 9 — the store's
    // "Permitir sobre-uso de insumos" switch. Default `true` (missing/null):
    // a shortage only WARNS (`stock_warnings`) instead of blocking, and the
    // consumption below is told to write NEGATIVE stock instead of the
    // atomic floor throwing on the exact shortage this switch accepted.
    const inventoryPolicy = await this.stockValidatorService.resolveInventoryPolicy(
      store_id,
    );
    let stockWarnings: InsufficientStockItem[] = [];
    if (ingredientDemands.length > 0) {
      stockWarnings = await this.stockValidatorService.assertIngredientsAvailable(
        ingredientDemands,
        { allowIngredientOveruse: inventoryPolicy.allowIngredientOveruse },
      );
    }

    // Snapshot for the auto-entry event. We collect per-consumption costs
    // and the final derived unit_cost, then emit AFTER the transaction
    // commits (auto-entry failures must not roll back the production).
    let totalConsumedCost = 0;
    let consumedLineCount = 0;
    const consumptions: ProductionConsumption[] = [];

    // 1. ATOMIC TRANSACTION — consume each recipe item + produce the batch
    const updated = await this.prisma.$transaction(async (tx) => {
      // 0. Atomic state guard (QUI-995): the conditional UPDATE serializes two
      // screens completing the same order. The loser re-evaluates the WHERE
      // after the winner commits (status / produced_qty changed), gets count 0
      // and rolls back before moving any stock.
      const claimed = await tx.production_orders.updateMany({
        where: {
          id: order.id,
          status: order.status,
          produced_qty: order.produced_qty ?? null,
        },
        data: { updated_at: new Date() },
      });
      if (claimed.count !== 1) {
        throw new VendixHttpException(
          ErrorCodes.PRODUCTION_ORDER_CONCURRENT_UPDATE,
        );
      }

      // 1a. Consume each ingredient (sub-recipes are NOT exploded in Fase C;
      // they are consumed as their own batch stock via the same machinery).
      for (const item of recipe.items) {
        const recipeWastePct = Number(recipe.waste_percent || 0);
        const consumedQty = this.computeConsumedQty(
          item,
          recipeWastePct,
          producedQty,
          recipe.yield_quantity,
        );
        if (consumedQty <= 0) continue;

        // El insumo se consume de SU propia bodega, no de la del producto
        // terminado. Con una sola ubicación para todo, un insumo que vive en la
        // bodega central se descontaba de la bodega del terminado: ahí no hay
        // existencias, `getOrCreateStockLevel` creaba la fila en 0 y el
        // `Math.max(0, …)` de `updateStock` se comía el descuento — el insumo
        // nunca bajaba y el terminado sí se acreditaba. Inventario inflado en
        // silencio, sin una fila que lo explicara.
        const componentLocationId =
          options?.inputLocationId ??
          (await this.stockLevelManager.getDefaultLocationForProduct(
            item.component_product_id,
          ));

        const result = await this.stockLevelManager.updateStock(
          {
            product_id: item.component_product_id,
            location_id: componentLocationId,
            quantity_change: -Math.abs(consumedQty),
            movement_type: 'consumption',
            reason: `Producción #${order.id} – ${order.product.name}`,
            source_module: sourceModule,
            user_id: undefined,
            create_movement: true,
            ...(options?.costingMethod && {
              costing_method: options.costingMethod,
            }),
            // No-overselling guard (plan step 6/9) — the pre-tx check above
            // already blocked an insufficient tracked ingredient WHEN
            // overuse is OFF; `validate_availability` is the defense-in-depth
            // net against a concurrent consumer taking the same stock between
            // that check and this write. No-op for untracked ingredients
            // (`updateStock` skips them entirely). When the store's
            // "Permitir sobre-uso de insumos" switch is ON, the guard above
            // only WARNS, so this atomic floor must be OFF too and the write
            // is told to go negative instead of clamping to 0.
            validate_availability: !inventoryPolicy.allowIngredientOveruse,
            allow_negative: inventoryPolicy.allowIngredientOveruse,
          },
          tx,
        );

        if (result?.cost_snapshot) {
          totalConsumedCost += Number(result.cost_snapshot.total_cost || 0);
          consumedLineCount += 1;
        }
        consumptions.push({
          component_product_id: item.component_product_id,
          consumed_qty: consumedQty,
          cost_snapshot: result?.cost_snapshot ?? null,
        });
      }

      // 1a'. Sale-linked order: the add-ons of its lines are consumed here, once
      // (each line claims `addons_consumed_at`, the same marker the kitchen fire
      // and the scheduled start use). Their cost joins the order cost, so the
      // `production.completed` entry is a single one.
      if (linkedOrderId != null) {
        const addons = await this.consumeLinkedAddons(tx, {
          store_id,
          order_id: linkedOrderId,
          product_id: order.product_id,
          production_order_id: order.id,
          sourceModule,
          allowOveruse: inventoryPolicy.allowIngredientOveruse,
        });
        totalConsumedCost += addons.cost;
        consumedLineCount += addons.lines;
      }

      // 1b. Credit finished-goods stock with the derived unit_cost
      const producedUnitCost =
        totalConsumedCost > 0
          ? Number((totalConsumedCost / producedQty).toFixed(4))
          : 0;

      await this.stockLevelManager.updateStock(
        {
          product_id: order.product_id,
          location_id,
          quantity_change: Math.abs(producedQty),
          movement_type: 'production',
          reason: `Producción #${order.id} – ${order.product.name}`,
          source_module: sourceModule,
          user_id: undefined,
          create_movement: true,
          unit_cost: producedUnitCost > 0 ? producedUnitCost : undefined,
        },
        tx,
      );

      // 1b'. Hook opcional (manufactura): líneas, lote, estado parcial…
      const hookData = options?.onProduced
        ? await options.onProduced(tx, {
            order: order as ProductionCompletionInfo['order'],
            producedQty,
            producedUnitCost,
            totalCost: totalConsumedCost,
            consumptions,
          })
        : undefined;

      // 1c. Persist the order final state
      const final = await tx.production_orders.update({
        where: { id: order.id },
        data: {
          status: 'completed',
          produced_qty: new Prisma.Decimal(producedQty),
          produced_at: new Date(),
          updated_at: new Date(),
          ...(hookData ?? {}),
        },
        include: {
          product: {
            select: { id: true, name: true, sku: true, stock_unit: true },
          },
          recipe: {
            select: {
              id: true,
              yield_quantity: true,
              yield_unit: true,
              waste_percent: true,
            },
          },
        },
      });

      // 1d. Sale-linked order: reserve (or, if the sale is already delivered,
      // sell) what was produced.
      if (linkedOrderId != null) {
        await this.settleProducedForSale(tx, {
          store_id,
          order_id: linkedOrderId,
          product_id: order.product_id,
          location_id,
          produced_qty: producedQty,
          planned_qty: Number(order.planned_qty),
          production_order_id: order.id,
        });
      }

      return { order: final, producedUnitCost };
    });

    // 2. Emit the production.completed event AFTER the transaction
    // commits. The AccountingEventsListener handles the auto-entry. A
    // failure here MUST NOT roll back the production.
    try {
      const context = RequestContextService.getContext();
      this.eventEmitter.emit('production.completed', {
        production_order_id: updated.order.id,
        organization_id: context?.organization_id,
        store_id: context?.store_id,
        product_id: order.product_id,
        product_name: order.product.name,
        produced_qty: producedQty,
        produced_unit_cost: updated.producedUnitCost,
        total_cost: totalConsumedCost,
        consumed_line_count: consumedLineCount,
        user_id: context?.user_id,
        // Aditivo: solo cuando el llamador (manufactura) pasa opciones.
        ...(options && {
          source_module: sourceModule,
          lines: consumptions,
        }),
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit production.completed for order #${order.id}: ${
          (err as Error).message
        }`,
        (err as Error).stack,
      );
    }

    // docs/plans/no-overselling-stock-guard-plan.md step 9 — additive: only
    // present when overuse was actually accepted, never an empty array.
    return stockWarnings.length > 0
      ? { ...updated.order, stock_warnings: stockWarnings }
      : updated.order;
  }

  // ------------------------------------------------------- sale-linked (QUI-995)
  /**
   * Consumes the add-ons of the sale lines this order serves. Each line claims
   * `addons_consumed_at` first (updateMany where null), so the kitchen fire, the
   * scheduled start and this completion never deduct the same add-on twice.
   */
  private async consumeLinkedAddons(
    tx: Prisma.TransactionClient,
    p: {
      store_id: number;
      order_id: number;
      product_id: number;
      production_order_id: number;
      sourceModule: string;
      allowOveruse: boolean;
    },
  ): Promise<{ cost: number; lines: number }> {
    const lines = await tx.order_items.findMany({
      where: {
        order_id: p.order_id,
        product_id: p.product_id,
        cancelled_at: null,
        fulfillment_destination: 'production',
        orders: { store_id: p.store_id },
      },
      select: {
        id: true,
        product_id: true,
        product_variant_id: true,
        quantity: true,
        addons_consumed_at: true,
        order_item_options: {
          select: {
            scope: true,
            component_type: true,
            component_product_id: true,
            component_variant_id: true,
            quantity: true,
          },
        },
      },
    });
    const inputs: ProductionLineInput[] = [];
    for (const line of lines) {
      if (line.addons_consumed_at != null || line.order_item_options.length === 0) continue;
      const { count } = await tx.order_items.updateMany({
        where: { id: line.id, addons_consumed_at: null },
        data: { addons_consumed_at: new Date() },
      });
      if (count === 0) continue;
      inputs.push({
        id: line.id,
        product_id: line.product_id,
        product_variant_id: line.product_variant_id,
        quantity: Number(line.quantity),
        // null: the base recipe is this order's own consumption, only add-ons here.
        product_type: null,
        inventory_consumed: true,
        addons_consumed: false,
        options: line.order_item_options.map((o) => ({
          ...o,
          quantity: Number(o.quantity),
        })),
      });
    }
    if (inputs.length === 0) return { cost: 0, lines: 0 };

    const resolvers = createBatchAwareExploders({
      recipes: this.recipes!,
      stockValidator: this.stockValidatorService,
      client: tx,
      pool: new Map(),
    });
    const { consumption } = await expandProduction(
      inputs,
      resolvers.findRecipe,
      resolvers.explode,
      resolvers.explodeComponent,
    );
    let cost = 0;
    for (const line of consumption) {
      const location_id = await this.stockLevelManager.getDefaultLocationForProduct(
        line.product_id,
        line.variant_id ?? undefined,
        tx,
      );
      const result = await this.stockLevelManager.updateStock(
        {
          product_id: line.product_id,
          ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          location_id,
          quantity_change: -line.quantity,
          movement_type: 'consumption',
          reason: `Producción #${p.production_order_id} – adiciones (pedido #${p.order_id})`,
          source_module: p.sourceModule,
          create_movement: true,
          validate_availability: !p.allowOveruse,
          allow_negative: p.allowOveruse,
        },
        tx,
      );
      cost += Number(result?.cost_snapshot?.total_cost ?? 0);
    }
    return { cost, lines: consumption.length };
  }

  /**
   * What happens to the produced units once the order completes:
   * - active sale: reserve min(produced, planned) for ('order', sale), without
   *   availability validation (the units were just credited, so `available`
   *   is unchanged and no other sale can take them);
   * - sale already delivered/finished: sell them now through the delivery
   *   commit (marks the lines `inventory_committed`), no reservation;
   * - sale cancelled/refunded: nothing is reserved, the stock stays sellable.
   */
  private async settleProducedForSale(
    tx: Prisma.TransactionClient,
    p: {
      store_id: number;
      order_id: number;
      product_id: number;
      location_id: number;
      produced_qty: number;
      planned_qty: number;
      production_order_id: number;
    },
  ): Promise<void> {
    const sale = await tx.orders.findFirst({
      where: { id: p.order_id, store_id: p.store_id },
      select: { id: true, state: true },
    });
    if (!sale || ['cancelled', 'refunded'].includes(sale.state as string)) return;

    if (['delivered', 'finished'].includes(sale.state as string)) {
      const pending = await tx.order_items.findMany({
        where: {
          order_id: p.order_id,
          product_id: p.product_id,
          cancelled_at: null,
          fulfillment_destination: 'production',
          inventory_committed: false,
        },
        select: { id: true },
      });
      if (pending.length > 0) {
        await this.orderStockCommit!.commitOrderLines(
          p.order_id,
          pending.map((l) => l.id),
          {
            blockOnInsufficient: false,
            tx,
            movementType: 'sale',
            reason: `Producción #${p.production_order_id} completada tras la entrega`,
          },
        );
      }
      return;
    }

    const quantity = Math.min(p.produced_qty, Math.round(p.planned_qty));
    if (quantity <= 0) return;
    await this.stockLevelManager.reserveStock(
      p.product_id,
      undefined,
      p.location_id,
      quantity,
      'order',
      p.order_id,
      RequestContextService.getContext()?.user_id ?? undefined,
      false,
      tx,
    );
  }

  /** Signed main-image URL per product id (S3 keys are signed on read). */
  private async imagesByProduct(ids: number[]): Promise<Map<number, string | null>> {
    const unique = [...new Set(ids)];
    const out = new Map<number, string | null>();
    if (unique.length === 0) return out;
    const rows = await this.prisma.products.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        product_images: {
          select: { image_url: true },
          orderBy: [{ is_main: 'desc' }, { sort_order: 'asc' }],
          take: 1,
        },
      },
    });
    await Promise.all(
      rows.map(async (row) => {
        const key = row.product_images?.[0]?.image_url ?? null;
        if (!key || !this.s3Service) {
          out.set(row.id, null);
          return;
        }
        // A thumbnail is decoration: a signing failure must not fail the detail.
        try {
          out.set(row.id, (await this.s3Service.signUrl(key)) ?? null);
        } catch (error) {
          this.logger.warn(
            `Could not sign image of product #${row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          out.set(row.id, null);
        }
      }),
    );
    return out;
  }

  /**
   * Detail for the shared production-order view (QUI-995): the order plus the
   * base recipe, the sale it serves and, per sale line, notes and add-ons with
   * image and (for preparations) their recipe components.
   */
  async getDetail(id: number) {
    const order = await this.findOne(id);
    const store_id = (order as { store_id: number }).store_id;
    const sale_order_id = (order as { order_id?: number | null }).order_id ?? null;

    const recipeItems = order.recipe?.items ?? [];
    const sale = sale_order_id
      ? await this.prisma.orders.findFirst({
          where: { id: sale_order_id, store_id },
          select: {
            id: true,
            order_number: true,
            state: true,
            customer_alias: true,
            users: { select: { first_name: true, last_name: true } },
            fulfillment_schedule: { select: { scheduled_start: true } },
          },
        })
      : null;
    const lines = sale_order_id
      ? await this.prisma.order_items.findMany({
          where: {
            order_id: sale_order_id,
            product_id: order.product_id,
            cancelled_at: null,
            fulfillment_destination: 'production',
          },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            quantity: true,
            notes: true,
            order_item_options: {
              orderBy: { id: 'asc' },
              select: {
                group_name: true,
                option_name: true,
                note: true,
                component_type: true,
                component_product_id: true,
                component_variant_id: true,
              },
            },
          },
        })
      : [];

    const addonProductIds = lines.flatMap((l) =>
      l.order_item_options.map((o) => o.component_product_id),
    );
    const addonRecipes = addonProductIds.length
      ? await this.prisma.recipes.findMany({
          where: { product_id: { in: addonProductIds }, is_active: true },
          select: {
            product_id: true,
            product_variant_id: true,
            items: {
              orderBy: { id: 'asc' },
              select: {
                quantity: true,
                component_product: { select: { id: true, name: true, stock_unit: true } },
              },
            },
          },
        })
      : [];
    const images = await this.imagesByProduct([
      order.product_id,
      ...recipeItems.map((i) => i.component_product_id),
      ...addonProductIds,
      ...addonRecipes.flatMap((r) => r.items.map((i) => i.component_product.id)),
    ]);
    const component = (item: {
      quantity: unknown;
      component_product: { id: number; name: string; stock_unit?: string | null };
    }) => ({
      product_id: item.component_product.id,
      name: item.component_product.name,
      quantity: Number(item.quantity),
      unit: item.component_product.stock_unit ?? null,
      image_url: images.get(item.component_product.id) ?? null,
    });
    const recipeFor = (product_id: number, variant_id: number | null) => {
      const rows = addonRecipes.filter((r) => r.product_id === product_id);
      return (
        (variant_id != null ? rows.find((r) => r.product_variant_id === variant_id) : undefined) ??
        rows.find((r) => r.product_variant_id == null) ??
        null
      );
    };

    const customer = sale?.users;
    return {
      ...order,
      product: { ...order.product, image_url: images.get(order.product_id) ?? null },
      base_recipe: order.recipe
        ? { id: order.recipe.id, components: recipeItems.map(component) }
        : null,
      sale_order: sale
        ? {
            id: sale.id,
            order_number: sale.order_number,
            state: sale.state,
            customer_name:
              (customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() : '') ||
              sale.customer_alias?.trim() ||
              null,
            due_at: sale.fulfillment_schedule?.scheduled_start ?? order.due_date ?? null,
          }
        : null,
      order_lines: lines.map((line) => ({
        order_item_id: line.id,
        quantity: Number(line.quantity),
        notes: line.notes ?? null,
        addons: line.order_item_options.map((o) => {
          const recipe =
            o.component_type === 'recipe'
              ? recipeFor(o.component_product_id, o.component_variant_id ?? null)
              : null;
          return {
            group_name: o.group_name,
            option_name: o.option_name,
            note: o.note ?? null,
            image_url: images.get(o.component_product_id) ?? null,
            recipe: recipe ? { components: recipe.items.map(component) } : null,
          };
        }),
      })),
    };
  }

  // ------------------------------------------------------------------- cancel
  async cancel(id: number) {
    const order = await this.findOne(id);
    if (order.status === 'cancelled') {
      return order; // idempotent
    }
    if (order.status === 'completed') {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_ORDER_INVALID_STATE,
        undefined,
        {
          from: order.status,
          to: 'cancelled',
          hint: 'Una orden completada no puede cancelarse; use un ajuste de inventario manual.',
        },
      );
    }
    return this.prisma.production_orders.update({
      where: { id },
      data: { status: 'cancelled', updated_at: new Date() },
    });
  }

  // ------------------------------------------------------------------- patch
  async update(id: number, dto: UpdateProductionOrderDto) {
    const order = await this.findOne(id);
    if (order.status === 'completed' || order.status === 'cancelled') {
      throw new VendixHttpException(
        ErrorCodes.PRODUCTION_ORDER_INVALID_STATE,
        undefined,
        {
          from: order.status,
          to: 'edited',
          hint: 'Una orden completada/cancelada no admite edición.',
        },
      );
    }
    return this.prisma.production_orders.update({
      where: { id },
      data: { updated_at: new Date() },
    });
  }

  // ------------------------------------------------------------------- stats
  async getStats() {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    // "Completadas (mes)" and "Producido (mes)" share the store-timezone month
    // window (QUI-997): the completed count used to include every past order.
    const tz = await resolveStoreTimezone(this.prisma, store_id);
    const civil = localCivil(now, tz);
    const startOfMonth = zonedWallClockToUtc(civil.year, civil.month, 1, 0, 0, 0, 0, tz);

    const [
      draftCount,
      inProgressCount,
      completedCount,
      cancelledCount,
      today,
      week,
      month,
    ] = await Promise.all([
      this.prisma.production_orders.count({
        where: { store_id, status: 'draft' },
      }),
      this.prisma.production_orders.count({
        where: { store_id, status: 'in_progress' },
      }),
      this.prisma.production_orders.count({
        where: {
          store_id,
          status: 'completed',
          produced_at: { gte: startOfMonth },
        },
      }),
      this.prisma.production_orders.count({
        where: { store_id, status: 'cancelled' },
      }),
      this.prisma.production_orders.aggregate({
        where: {
          store_id,
          status: 'completed',
          produced_at: { gte: startOfDay },
        },
        _sum: { produced_qty: true },
      }),
      this.prisma.production_orders.aggregate({
        where: {
          store_id,
          status: 'completed',
          produced_at: { gte: startOfWeek },
        },
        _sum: { produced_qty: true },
      }),
      this.prisma.production_orders.aggregate({
        where: {
          store_id,
          status: 'completed',
          produced_at: { gte: startOfMonth },
        },
        _sum: { produced_qty: true },
      }),
    ]);

    return {
      draft: draftCount,
      in_progress: inProgressCount,
      completed: completedCount,
      cancelled: cancelledCount,
      total: draftCount + inProgressCount + completedCount + cancelledCount,
      produced_today: Number(today._sum.produced_qty || 0),
      produced_week: Number(week._sum.produced_qty || 0),
      produced_month: Number(month._sum.produced_qty || 0),
    };
  }
}
