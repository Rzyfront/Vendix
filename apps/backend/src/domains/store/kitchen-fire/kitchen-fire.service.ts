import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RecipesService, BomExplosionLine } from '../recipes/recipes.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { FireOrderItemsDto, KitchenTicketQueryDto } from './dto';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';

/**
 * Single source of truth for the kitchen-ticket payload shape returned to
 * the KDS / POS. Exposes the parent order code (`order.order_number`) plus
 * the per-item product summary. Used by all four ticket read paths so the
 * contract stays consistent (`daily_number` lives on the ticket row).
 */
const KITCHEN_TICKET_INCLUDE = {
  order: { select: { order_number: true } },
  items: {
    orderBy: { id: 'asc' },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          stock_unit: true,
          preparation_time_minutes: true,
          // Restaurant Suite — KDS recipe-readiness: nest the recipe so every
          // ticket read path (snapshot + all `ticket.*` SSE events use this
          // single include) carries whether the dish has an ACTIVE recipe.
          // `recipe` is a TO-ONE optional relation on `products`
          // (`recipes.product_id` is `@unique`), so we select its `id` +
          // `is_active` and let the KDS card derive
          // `has_active_recipe = product.recipe?.is_active === true` in O(1)
          // without an extra per-card fetch. Mirrors the `startPreparation`
          // guard (`recipes.findFirst({ product_id, is_active: true })`).
          recipe: {
            select: { id: true, is_active: true },
          },
        },
      },
    },
  },
} satisfies Prisma.kitchen_ticketsInclude;

/**
 * Result of {@link KitchenFireService.fireOrderItems}. Returned to the
 * controller and (eventually) the POS UI to confirm the fire was
 * accepted and which items were actually consumed.
 */
export interface FireOrderItemsResult {
  kitchen_ticket_id: number;
  order_id: number;
  fired_item_ids: number[];
  skipped_item_ids: number[];
  cogs_total: number;
  consumed_line_count: number;
}

/**
 * Plan KDS fire-flows (B2): the pre-exploded context the caller has already
 * resolved OUTSIDE the transaction (recipes, BOM, default locations,
 * business date, partition into prepared/recipe-less). The fire-in-tx
 * core receives this as input so the same atomic body can be reused from
 * the auto-fire paths (POS payment / table close / split) without
 * re-running the pre-explosion. The caller is responsible for
 * scoping the catalog reads to the right tenant.
 */
export interface PreExplodedFireContext {
  order: {
    id: number;
    order_number: string;
  };
  firedItemIds: number[];
  skippedItemIds: number[];
  preparedItems: Array<{
    orderItem: { id: number; product_id: number | null; product_name: string; quantity: any };
    recipeId: number;
    bomLines: BomExplosionLine[];
  }>;
  recipeLessItems: Array<{ id: number; product_id: number | null; product_name: string; quantity: any }>;
  locationByProduct: Map<number, number>;
  businessDate: string;
  user_id?: number;
}

/**
 * Shape of the events we push to the KDS stream (`kitchen:{store_id}`).
 * Kept loose (`string`) so the same envelope carries snapshot, lifecycle,
 * and ping messages without TS narrowing headaches.
 */
export interface KdsSseEvent {
  type:
    | 'snapshot'
    | 'ticket.created'
    | 'ticket.started'
    | 'ticket.ready'
    | 'ticket.delivered'
    | 'ticket.cancelled'
    | 'ticket.reverted'
    | 'ping';
  ticket?: any;
  tickets?: any[];
  ts?: number;
  meta?: Record<string, any>;
}

/**
 * KitchenFireService
 *
 * Fase D of the Restaurant Suite — the seam that moves inventory consume
 * and COGS recognition from "at payment" to "at fire" (the moment the
 * kitchen receives the order). The retail flow stays untouched: only
 * items flagged as `prepared` with an active recipe are exploded.
 *
 * For each fire-able order_item we:
 *  1. Resolve the active recipe for the product and call
 *     `RecipesService.explodeBom(recipeId)` to flatten the BOM (resolves
 *     sub-recipes recursively, applying merma + yield at every level).
 *  2. For each leaf line, call `StockLevelManager.updateStock` with
 *     `movement_type='consumption'` and a negative `quantity_change` so
 *     the existing FIFO machinery in `calculateAndConsumeMovementCost`
 *     consumes the appropriate cost layers and returns a per-line
 *     `cost_snapshot.total_cost`.
 *  3. Sum those per-line costs to derive the total COGS for the fire.
 *  4. Mark `order_items.inventory_consumed_at_fire=true` on the fired
 *     items (idempotency flag).
 *  5. Create one `kitchen_tickets` row + one `kitchen_ticket_items` row
 *     per fired order_item (prepares the KDS stream for Fase F).
 *  6. Emit `kitchen.fired` with the snapshot — `AccountingEventsListener`
 *     delegates to `AutoEntryService.onKitchenFired` for the balanced
 *     DR 6135 / CR 1435 entry.
 *
 * Atomicity: all of the above runs inside a single Prisma `$transaction`.
 * If any step fails the whole fire rolls back. The `kitchen.fired` event
 * is emitted AFTER the transaction commits so accounting failures never
 * re-trigger stock changes.
 *
 * Skipped items (non-prepared, no recipe, already-consumed) are returned
 * in `skipped_item_ids` for caller visibility. If EVERY item is skipped
 * the call is rejected with `KITCHEN_FIRE_ALL_ALREADY_CONSUMED`.
 */
@Injectable()
export class KitchenFireService {
  private readonly logger = new Logger(KitchenFireService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly recipesService: RecipesService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly sseService: NotificationsSseService,
  ) {}

  /** Fecha de negocio 'YYYY-MM-DD' en tz de la tienda, desplazada por la hora de corte (default 3 AM → un ticket a la 1 AM cuenta para el día anterior). Configurable vía store_settings.settings.operations.ticket_closing_hour (con fallback legado a restaurant_ops.business_day_cutoff_hour). */
  private async getBusinessDate(store_id: number): Promise<string> {
    const row = await this.prisma.store_settings.findUnique({
      where: { store_id }, select: { settings: true },
    });
    const settings = (row?.settings ?? {}) as any;
    const timezone = settings?.general?.timezone || 'America/Bogota';
    const cutoffHour = Number(settings?.operations?.ticket_closing_hour ?? settings?.restaurant_ops?.business_day_cutoff_hour ?? 3) || 0;
    const shifted = new Date(Date.now() - cutoffHour * 3_600_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(shifted);
  }

  // ---------------------------------------------------------------- fire
  async fireOrderItems(
    dto: FireOrderItemsDto,
  ): Promise<FireOrderItemsResult> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const organization_id = context?.organization_id;
    const user_id = context?.user_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Plan KDS fire-flows (B8): gate the manual fire endpoint to
    // `restaurant` stores. Non-restaurant stores don't have a kitchen;
    // allowing fire would create kitchen_tickets rows for them and
    // (downstream) surprise the kitchen module. The auto-fire path in
    // PaymentsService is gated the same way.
    const storeIndustries = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: { industries: true },
    });
    if (!storeIsRestaurant(storeIndustries?.industries)) {
      throw new VendixHttpException(ErrorCodes.RESTAURANT_NOT_ENABLED);
    }

    // 1. Load the order header + the requested items, scope-safe.
    const order = await this.prisma.orders.findFirst({
      where: { id: dto.order_id, store_id },
      select: {
        id: true,
        store_id: true,
        order_number: true,
        order_items: {
          where: { id: { in: dto.order_item_ids } },
          include: {
            products: {
              select: {
                id: true,
                name: true,
                product_type: true,
                track_inventory: true,
                store_id: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_ORDER_NOT_FOUND);
    }
    if (!order.order_items || order.order_items.length === 0) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_ITEM_NOT_FOUND);
    }

    // 2. Partition items into fireable vs skipped.
    const firedItemIds: number[] = [];
    const skippedItemIds: number[] = [];
    for (const item of order.order_items) {
      if (item.inventory_consumed_at_fire) {
        skippedItemIds.push(item.id);
        continue;
      }
      if (
        !item.product_id ||
        !item.products ||
        item.products.product_type !== 'prepared'
      ) {
        // Not a `prepared` — no recipe to explode. Skip silently; the
        // payment path will still consume it for the retail flow.
        skippedItemIds.push(item.id);
        continue;
      }
      firedItemIds.push(item.id);
    }

    if (firedItemIds.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_FIRE_ALL_ALREADY_CONSUMED,
      );
    }

    // 3. Pre-load all recipes needed for the fired items (to avoid
    //    repeated lookups inside the transaction).
    //
    // Restaurant Suite — Fase K Gap 3: a `prepared` product with NO
    // active recipe is still fireable — the kitchen can cook it by
    // hand without deducting ingredient stock. The hard guard moves
    // to `startPreparation` (it refuses to advance a ticket that
    // contains a recipe-less item). At fire time we partition into:
    //   - `preparedItems`: items with an active recipe (BOM explodes,
    //     stock is consumed, COGS recognized).
    //   - `recipeLessItems`: items with NO active recipe (no BOM, no
    //     stock movement, cogsTotal stays at 0 for these rows).
    // Both groups still create a `kitchen_ticket_item` and flip
    // `inventory_consumed_at_fire=true` (so the payment path skips
    // them).
    type PreparedItemContext = {
      orderItem: (typeof order.order_items)[number];
      recipeId: number;
      bomLines: BomExplosionLine[];
    };
    const preparedItems: PreparedItemContext[] = [];
    const recipeLessItems: Array<(typeof order.order_items)[number]> = [];
    for (const itemId of firedItemIds) {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      const recipe = await this.prisma.recipes.findFirst({
        where: { product_id: item.product_id!, is_active: true },
        select: { id: true, product_id: true, is_active: true },
      });
      if (!recipe) {
        // No recipe at all → cooked by hand, no inventory consume.
        recipeLessItems.push(item);
        continue;
      }
      if (!recipe.is_active) {
        // Inactive recipe → treat like no recipe (no consume).
        recipeLessItems.push(item);
        continue;
      }
      const bomLines = await this.recipesService.explodeBom(recipe.id, {
        [recipe.id]: 1,
      });
      preparedItems.push({ orderItem: item, recipeId: recipe.id, bomLines });
    }

    // 3b. Pre-resolve a default location_id per leaf product. Resolved
    //     OUTSIDE the transaction because getDefaultLocationForProduct
      //     uses the outer scoped client; the resulting id is just a
      //     number that updateStock will use inside the tx.
    const locationByProduct = new Map<number, number>();
    const allLeafProductIds = new Set<number>();
    for (const ctx of preparedItems) {
      for (const line of ctx.bomLines) {
        allLeafProductIds.add(line.component_product_id);
      }
    }
    for (const pid of allLeafProductIds) {
      const loc = await this.stockLevelManager.getDefaultLocationForProduct(
        pid,
      );
      locationByProduct.set(pid, loc);
    }

    // 3c. Resolve the store business date (tz + cutoff-aware) BEFORE the
    //     transaction; the advisory lock + daily counter run inside.
    const businessDate = await this.getBusinessDate(store_id);

    // 4. ATOMIC TRANSACTION — for each item: per-leaf stock consumption +
    //    flag flip. Then create the kitchen_ticket + items.
    //
    // Plan KDS fire-flows (B2): the tx body lives in `fireOrderItemsInTx` so
    // the auto-fire paths (POS payment, table close, split) can run the SAME
    // atomic body inside THEIR OWN $transaction (which also writes the order /
    // payment / sub-orders). The caller provides a pre-exploded context
    // (recipes, BOM, default locations, business date) so this method
    // executes only the tx-bound work; it never opens a new $transaction.
    const preComputed: PreExplodedFireContext = {
      order: { id: order.id, order_number: order.order_number },
      firedItemIds,
      skippedItemIds,
      preparedItems,
      recipeLessItems,
      locationByProduct,
      businessDate,
      user_id,
    };
    const result = await this.prisma.$transaction(async (tx) =>
      this.fireOrderItemsInTx(tx, store_id, preComputed),
    );

    // 5. Emit `kitchen.fired` AFTER the transaction commits. A failure
    //    here MUST NOT roll back the fire.
    try {
      this.eventEmitter.emit('kitchen.fired', {
        kitchen_ticket_id: result.ticketId,
        order_id: order.id,
        organization_id,
        store_id,
        total_cost: result.cogsTotal,
        consumed_line_count: result.consumedLineCount,
        user_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit kitchen.fired for ticket #${result.ticketId}: ${
          (err as Error).message
        }`,
        (err as Error).stack,
      );
    }

    // 5b. Push the new ticket onto the KDS SSE stream. Best-effort — a
    //     broken connection must NOT roll back the fire (we just logged
    //     the failure inside pushKitchenEvent).
    try {
      const fullTicket = await this.prisma.kitchen_tickets.findFirst({
        where: { id: result.ticketId, store_id },
        include: KITCHEN_TICKET_INCLUDE,
      });
      if (fullTicket) {
        this.pushKitchenEvent(store_id, {
          type: 'ticket.created',
          ticket: fullTicket,
          ts: Date.now(),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to build SSE payload for ticket #${result.ticketId}: ${
          (err as Error).message
        }`,
      );
    }

    return {
      kitchen_ticket_id: result.ticketId,
      order_id: order.id,
      fired_item_ids: result.firedItemSnapshots.map((s) => s.orderItemId),
      skipped_item_ids: skippedItemIds,
      cogs_total: Number(result.cogsTotal.toFixed(4)),
      consumed_line_count: result.consumedLineCount,
    };
  }

  // ------------------------------------------------------- fire-in-tx core
  /**
   * Plan KDS fire-flows (B2): the transaction-bound core of the fire flow.
   * Receives an EXTERNAL `tx` (the caller's open $transaction) and a
   * pre-exploded context (recipes, BOM, default locations, business date).
   *
   * Why a separate method:
   *  - The public `fireOrderItems` runs its own $transaction because the
   *    manual fire is a standalone operation.
   *  - The auto-fire paths (POS payment, table close, split) already run a
   *    larger $transaction that writes the order / payment / sub-orders.
   *    Re-running the fire inside its own $transaction would either:
   *      (a) create a savepoint boundary and lose atomicity, or
   *      (b) require duplicating the entire payment / split flow.
   *    Passing the caller's `tx` in keeps the WHOLE flow atomic: if any
   *    step in the larger transaction fails, the fire rolls back too.
   *
   * Atomicity contract — must be respected by callers:
   *  - All `tx.*` writes (stock consume, flag flip, ticket create) run on
   *    the passed-in `tx`. No nested $transaction.
   *  - The `pg_advisory_xact_lock` + daily counter run inside this same
   *    `tx` so concurrent fires serialize on the same daily_number.
   *  - Event emission (`kitchen.fired`) and SSE push happen AFTER the
   *    caller's $transaction commits, never from inside this method.
   *
   * Pre-condition (caller responsibility): the preComputed must already be
   * partitioned into `preparedItems` and `recipeLessItems` against the
   * SAME order whose items carry `skip_kds=false` (or that the caller
   * already filtered those out). Items with `skip_kds=true` must NOT be
   * included in either list.
   *
   * Returns the same shape `fireOrderItems` always returned (ticketId +
   * firedItemSnapshots + cogsTotal + consumedLineCount) so the wrapper
   * can build the public response without branching.
   */
  async fireOrderItemsInTx(
    tx: Prisma.TransactionClient,
    store_id: number,
    preComputed: PreExplodedFireContext,
  ): Promise<{
    ticketId: number;
    firedItemSnapshots: Array<{
      orderItemId: number;
      productId: number;
      productName: string;
      quantity: number;
    }>;
    cogsTotal: number;
    consumedLineCount: number;
  }> {
    const { order, preparedItems, recipeLessItems, locationByProduct, businessDate, user_id } =
      preComputed;

    const firedItemSnapshots: Array<{
      orderItemId: number;
      productId: number;
      productName: string;
      quantity: number;
    }> = [];

    let cogsTotal = 0;
    let consumedLineCount = 0;

    for (const ctxItem of preparedItems) {
      const { orderItem, bomLines } = ctxItem;
      const orderQty = Number(orderItem.quantity || 0);
      if (!Number.isFinite(orderQty) || orderQty <= 0) {
        // Defensive — should never happen at this point.
        continue;
      }

      // Per-leaf consumption: stock × orderQty × bomMultiplier.
      for (const line of bomLines) {
        const consumedQty = Math.round(line.quantity * orderQty);
        if (!Number.isFinite(consumedQty) || consumedQty <= 0) {
          // Defensive: this should never happen if the recipe items have
          // valid quantities. Warn loudly so the data-integrity issue is
          // visible in ops rather than silently dropping the line.
          this.logger.warn(
            `Skipping zero/invalid BOM line in recipe for order item ${orderItem.id}: component=${line.component_product_id} qty=${line.quantity}`,
          );
          continue;
        }

        const locationId = locationByProduct.get(
          line.component_product_id,
        );
        if (!locationId) continue;

        const result = await this.stockLevelManager.updateStock(
          {
            product_id: line.component_product_id,
            location_id: locationId,
            quantity_change: -Math.abs(consumedQty),
            movement_type: 'consumption',
            reason: `Fire-to-kitchen (order #${order.id} – item #${orderItem.id})`,
            source_module: 'kitchen_fire',
            user_id,
            order_item_id: orderItem.id,
            create_movement: true,
            validate_availability: false,
          },
          tx,
        );

        if (result?.cost_snapshot) {
          cogsTotal += Number(result.cost_snapshot.total_cost || 0);
          consumedLineCount += 1;
        }
      }

      // Flip the idempotency flag.
      await tx.order_items.update({
        where: { id: orderItem.id },
        data: { inventory_consumed_at_fire: true },
      });

      firedItemSnapshots.push({
        orderItemId: orderItem.id,
        productId: orderItem.product_id!,
        productName: orderItem.product_name,
        quantity: orderQty,
      });
    }

    // Recipe-less items: same ticket, no stock movement, no COGS.
    // We still flip `inventory_consumed_at_fire=true` so the payment
    // path skips them and the anti-double-discount invariant holds
    // (the kitchen will track the cook manually, the POS won't
    // double-deduct the product's own stock).
    for (const item of recipeLessItems) {
      const orderQty = Number(item.quantity || 0);
      if (!Number.isFinite(orderQty) || orderQty <= 0) continue;
      await tx.order_items.update({
        where: { id: item.id },
        data: { inventory_consumed_at_fire: true },
      });
      firedItemSnapshots.push({
        orderItemId: item.id,
        productId: item.product_id!,
        productName: item.product_name,
        quantity: orderQty,
      });
    }

    // Serialize the daily correlative per (store, business_date) with a
    // transaction-scoped advisory lock so concurrent fires can't collide
    // on the same daily_number. The lock auto-releases at commit/rollback.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${store_id}::int, hashtext(${businessDate})::int)`;
    const sameDayCount = await tx.kitchen_tickets.count({
      where: {
        store_id,
        business_date: new Date(`${businessDate}T00:00:00.000Z`),
      },
    });
    const dailyNumber = sameDayCount + 1;

    // Create the kitchen_ticket + items (one ticket per fire call, one
    // item per fired order_item). Status defaults to 'pending'; Fase F
    // owns the KDS SSE controller that mutates these later.
    const ticket = await tx.kitchen_tickets.create({
      data: {
        store_id,
        order_id: order.id,
        status: 'pending',
        daily_number: dailyNumber,
        business_date: new Date(`${businessDate}T00:00:00.000Z`),
        fired_at: new Date(),
        items: {
          create: firedItemSnapshots.map((snap) => ({
            order_item_id: snap.orderItemId,
            product_id: snap.productId,
            quantity: snap.quantity,
            status: 'pending',
          })),
        },
      },
      include: { items: true },
    });

    return {
      ticketId: ticket.id,
      firedItemSnapshots,
      cogsTotal,
      consumedLineCount,
    };
  }

  // ----------------------------------------------------- prepareFireContext
  /**
   * Plan KDS fire-flows (B2): build the pre-exploded context the auto-fire
   * paths need to call `fireOrderItemsInTx` from inside THEIR $transaction.
   *
   * The auto-fire callers (POS payment, table close, split) have already
   * persisted the `order_items` and have a candidate list of
   * `order_item_ids` they want to fire (typically the `prepared` lines with
   * `skip_kds=false`). This method:
   *   1. Loads the order header + the requested items (scope-safe).
   *   2. Partitions into `firedItemIds` / `skippedItemIds` (same rules as
   *      the public `fireOrderItems`: skip already-consumed, non-prepared,
   *      and recipe-less-as-no-recipe — but the caller can opt to include
   *      recipe-less items by leaving them in the candidate list).
   *   3. Resolves recipes + explodes BOM for each prepared item.
   *   4. Pre-loads default `location_id` per leaf product (outside the
   *      final $transaction because the resolver uses the scoped client).
   *   5. Resolves the store business date (tz + cutoff-aware).
   *
   * Returns `null` when there is nothing to fire (empty partition) so the
   * caller can short-circuit without extra branches.
   *
   * Caller contract:
   *   - The resulting `preComputed` must be passed VERBATIM into
   *     `fireOrderItemsInTx` from within the caller's $transaction.
   *   - The caller's $transaction must commit BEFORE the caller emits
   *     `kitchen.fired` (the helper does not emit; see
   *     `emitKitchenFiredAfterCommit`).
   *   - If the caller is in a non-restaurant industry, the helper still
   *     works (returns null if no recipes) but the caller should
   *     short-circuit with `storeIsRestaurant` for clarity.
   */
  async prepareFireContext(
    orderId: number,
    candidateOrderItemIds: number[],
    /**
     * Optional Prisma transaction client. When provided, the catalog
     * reads (recipes, BOM, default locations) run inside the caller's
     * $transaction. This is REQUIRED when the caller has just
     * persisted the `order_items` in the same transaction (e.g. the
     * auto-fire path in PaymentsService.processPosPayment) — otherwise
     the read would happen on a separate connection that cannot see
     the just-inserted rows. When omitted, the scoped client is used
     (the public fireOrderItems path).
     */
    tx?: Prisma.TransactionClient,
  ): Promise<PreExplodedFireContext | null> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const client = (tx ?? this.prisma) as any;
    const order = await client.orders.findFirst({
      where: { id: orderId, store_id },
      select: {
        id: true,
        store_id: true,
        order_number: true,
        order_items: {
          where: { id: { in: candidateOrderItemIds } },
          include: {
            products: {
              select: {
                id: true,
                name: true,
                product_type: true,
                track_inventory: true,
                store_id: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_ORDER_NOT_FOUND);
    }
    if (!order.order_items || order.order_items.length === 0) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_ITEM_NOT_FOUND);
    }

    // Partition
    const firedItemIds: number[] = [];
    const skippedItemIds: number[] = [];
    for (const item of order.order_items) {
      if (item.inventory_consumed_at_fire) {
        skippedItemIds.push(item.id);
        continue;
      }
      if (
        !item.product_id ||
        !item.products ||
        item.products.product_type !== 'prepared'
      ) {
        // Not a `prepared` — no recipe to explode. The payment path will
        // still consume it (retail / non-prepared flow). The auto-fire
        // path ignores it.
        skippedItemIds.push(item.id);
        continue;
      }
      firedItemIds.push(item.id);
    }
    if (firedItemIds.length === 0) {
      return null;
    }

    // Resolve recipes + BOM for fired items
    type PreparedItemContext = {
      orderItem: (typeof order.order_items)[number];
      recipeId: number;
      bomLines: BomExplosionLine[];
    };
    const preparedItems: PreparedItemContext[] = [];
    const recipeLessItems: Array<(typeof order.order_items)[number]> = [];
    for (const itemId of firedItemIds) {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      const recipe = await this.prisma.recipes.findFirst({
        where: { product_id: item.product_id!, is_active: true },
        select: { id: true, product_id: true, is_active: true },
      });
      if (!recipe || !recipe.is_active) {
        recipeLessItems.push(item);
        continue;
      }
      const bomLines = await this.recipesService.explodeBom(recipe.id, {
        [recipe.id]: 1,
      });
      preparedItems.push({ orderItem: item, recipeId: recipe.id, bomLines });
    }

    // Pre-resolve default location per leaf product
    const locationByProduct = new Map<number, number>();
    const allLeafProductIds = new Set<number>();
    for (const ctx of preparedItems) {
      for (const line of ctx.bomLines) {
        allLeafProductIds.add(line.component_product_id);
      }
    }
    for (const pid of allLeafProductIds) {
      const loc = await this.stockLevelManager.getDefaultLocationForProduct(
        pid,
      );
      locationByProduct.set(pid, loc);
    }

    const businessDate = await this.getBusinessDate(store_id);

    return {
      order: { id: order.id, order_number: order.order_number },
      firedItemIds,
      skippedItemIds,
      preparedItems,
      recipeLessItems,
      locationByProduct,
      businessDate,
      user_id,
    };
  }

  // ------------------------------------------------ emitKitchenFiredAfterCommit
  /**
   * Plan KDS fire-flows (B2 / B9): emit `kitchen.fired` AND push the KDS SSE
   * snapshot AFTER the caller's $transaction has committed. The caller
   * (POS payment, table close, split) MUST call this from outside the
   * transaction; if the transaction later rolls back, the event was
   * already on the wire (best-effort, matches the public `fireOrderItems`
   * behavior).
   *
   * Returns the same `FireOrderItemsResult` shape the public endpoint
   * returns so the auto-fire callers can attach it to their response.
   */
  async emitKitchenFiredAfterCommit(
    store_id: number,
    organization_id: number | undefined,
    result: {
      ticketId: number;
      firedItemSnapshots: Array<{
        orderItemId: number;
        productId: number;
        productName: string;
        quantity: number;
      }>;
      cogsTotal: number;
      consumedLineCount: number;
    },
    orderId: number,
  ): Promise<FireOrderItemsResult> {
    const fired_item_ids = result.firedItemSnapshots.map(
      (s) => s.orderItemId,
    );
    // Plan KDS fire-flows — COGS integrity fix: the auto-fire callers (POS
    // payment B5/B6, split B7) build this event AFTER their own commit and
    // pass organization_id=undefined. Without a valid org the accounting
    // listener cannot resolve the org-scoped COGS mapping/accounting entity,
    // so the `kitchen.fired` journal entry (DR 6135 / CR 1435) is silently
    // dropped — inventory leaves the books but COGS is never recognized.
    // Derive the org from the request context (the same source the manual
    // fire path uses inline) so auto-fired sales post their COGS too.
    const effective_organization_id =
      organization_id ?? RequestContextService.getContext()?.organization_id;
    try {
      this.eventEmitter.emit('kitchen.fired', {
        kitchen_ticket_id: result.ticketId,
        order_id: orderId,
        organization_id: effective_organization_id,
        store_id,
        total_cost: result.cogsTotal,
        consumed_line_count: result.consumedLineCount,
        user_id: RequestContextService.getContext()?.user_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit kitchen.fired for ticket #${result.ticketId}: ${
          (err as Error).message
        }`,
        (err as Error).stack,
      );
    }
    try {
      const fullTicket = await this.prisma.kitchen_tickets.findFirst({
        where: { id: result.ticketId, store_id },
        include: KITCHEN_TICKET_INCLUDE,
      });
      if (fullTicket) {
        this.pushKitchenEvent(store_id, {
          type: 'ticket.created',
          ticket: fullTicket,
          ts: Date.now(),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to build SSE payload for ticket #${result.ticketId}: ${
          (err as Error).message
        }`,
      );
    }
    return {
      kitchen_ticket_id: result.ticketId,
      order_id: orderId,
      fired_item_ids,
      skipped_item_ids: [],
      cogs_total: Number(result.cogsTotal.toFixed(4)),
      consumed_line_count: result.consumedLineCount,
    };
  }

  // ---------------------------------------------------------------- helpers
  /**
   * Push a KDS event to the per-store SSE subject.
   * Failures are logged but never bubble up — SSE is best-effort and a
   * broken connection must not break the fire / mutation flow.
   */
  private pushKitchenEvent(
    store_id: number,
    event: KdsSseEvent,
  ): void {
    try {
      this.sseService.push(store_id, event as any);
    } catch (err) {
      this.logger.warn(
        `Failed to push KDS event to store ${store_id}: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Resolve a ticket by id, scoped to the current store. Used by every
   * mutation below. Throws KITCHEN_TICKET_NOT_FOUND if the id doesn't
   * belong to the current store (also serves as a tenant guard).
   */
  private async getTicketForStore(ticketId: number) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const ticket = await this.prisma.kitchen_tickets.findFirst({
      where: { id: ticketId, store_id },
      include: KITCHEN_TICKET_INCLUDE,
    });
    if (!ticket) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_TICKET_NOT_FOUND);
    }
    return { ticket, store_id };
  }

  // ---------------------------------------------------------------- mutations
  /**
   * pending → in_preparation. Cascades item status, used by the KDS
   * "Start" button. Idempotent if already in_preparation.
   *
   * Restaurant Suite — Fase K audit jun-2026: distinguishes the
   * `already_in_preparation` (409 idempotent-ish) and the terminal
   * `cancelled`/`delivered` cases with explicit error codes so the KDS
   * board / table-session panel can show specific Spanish messages
   * instead of the generic "Transición de estado no permitida".
   */
  async startPreparation(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_CANCELLED,
        undefined,
        {
          from: ticket.status,
          to: 'in_preparation',
          hint: 'Este plato fue cancelado en cocina y no puede iniciar preparación.',
        },
      );
    }
    if (ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_DELIVERED,
        undefined,
        {
          from: ticket.status,
          to: 'in_preparation',
          hint: 'Este plato ya fue entregado y no puede iniciar preparación.',
        },
      );
    }
    if (ticket.status === 'in_preparation') {
      // Idempotent — already in this state.
      return ticket;
    }
    if (ticket.status === 'ready') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_READY,
        undefined,
        {
          from: ticket.status,
          to: 'in_preparation',
          hint: 'Este plato ya está listo; márcalo como entregado en lugar de iniciarlo.',
        },
      );
    }

    // Restaurant Suite — Fase K Gap 3: the ticket may contain
    // `prepared` items with no active recipe (allowed to fire, see
    // `fireOrderItems`). The operator can still mark them as
    // delivered/cancelled directly, but moving the ticket into
    // `in_preparation` is blocked because the kitchen would have
    // nothing to deduct stock from. We check every product on the
    // ticket against the recipes table.
    const recipeLessItemIds: number[] = [];
    for (const item of ticket.items ?? []) {
      if (!item.product_id) continue;
      const recipe = await this.prisma.recipes.findFirst({
        where: { product_id: item.product_id, is_active: true },
        select: { id: true },
      });
      if (!recipe) {
        recipeLessItemIds.push(item.id);
      }
    }
    if (recipeLessItemIds.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_NO_RECIPE,
        undefined,
        {
          ticket_id: ticketId,
          recipe_less_item_ids: recipeLessItemIds,
          hint: 'Adjunta una receta activa al plato antes de iniciar la preparación, o cocínalo manualmente y márcalo como entregado.',
        },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.kitchen_tickets.update({
        where: { id: ticketId },
        data: {
          status: 'in_preparation',
          updated_at: new Date(),
        },
      });
      await tx.kitchen_ticket_items.updateMany({
        where: {
          kitchen_ticket_id: ticketId,
          status: 'pending',
        },
        data: { status: 'in_preparation', updated_at: new Date() },
      });
      return t;
    });

    const full = await this.getTicketForStore(ticketId);
    this.pushKitchenEvent(store_id, {
      type: 'ticket.started',
      ticket: full.ticket,
      ts: Date.now(),
    });
    return full.ticket;
  }

  /**
   * in_preparation | pending → ready. Sets ready_at timestamp.
   * Idempotent if already ready.
   *
   * Restaurant Suite — Fase K audit jun-2026: distinguishes the
   * `already_ready` (409 idempotent-ish) and the terminal
   * `cancelled`/`delivered` cases with explicit error codes.
   */
  async markReady(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_CANCELLED,
        undefined,
        {
          from: ticket.status,
          to: 'ready',
          hint: 'Este plato fue cancelado en cocina y no puede marcarse como listo.',
        },
      );
    }
    if (ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_DELIVERED,
        undefined,
        {
          from: ticket.status,
          to: 'ready',
          hint: 'Este plato ya fue entregado y no puede marcarse como listo.',
        },
      );
    }
    if (ticket.status === 'ready') {
      return ticket;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.kitchen_tickets.update({
        where: { id: ticketId },
        data: {
          status: 'ready',
          ready_at: new Date(),
          updated_at: new Date(),
        },
      });
      await tx.kitchen_ticket_items.updateMany({
        where: {
          kitchen_ticket_id: ticketId,
          status: { in: ['pending', 'in_preparation'] },
        },
        data: { status: 'ready', updated_at: new Date() },
      });
      return t;
    });

    const full = await this.getTicketForStore(ticketId);
    this.pushKitchenEvent(store_id, {
      type: 'ticket.ready',
      ticket: full.ticket,
      ts: Date.now(),
    });
    return full.ticket;
  }

  /**
   * ready | in_preparation → delivered. Marks the order-side flow that the
   * kitchen handoff is complete. Items are NOT marked
   * `inventory_consumed_at_fire` here (that flag is flipped in
   * fireOrderItems).
   *
   * Restaurant Suite — Fase K audit jun-2026: emits SPECIFIC error codes
   * for the common UX bug "Marcar entregado cuando el plato está
   * pendiente". The previous code threw the generic
   * KITCHEN_TICKET_INVALID_STATE, which surfaced as the dev-message
   * "Transición de estado del ticket no permitida" — too generic for the
   * table-session operator. Now:
   *   - pending → delivered       → KITCHEN_TICKET_NOT_READY (specific)
   *   - cancelled → delivered     → KITCHEN_TICKET_ALREADY_CANCELLED
   *   - delivered → delivered     → KITCHEN_TICKET_ALREADY_DELIVERED
   *   - in_preparation → delivered OK (auto-bumps ready via markReady)
   *   - ready → delivered         OK
   *
   * The `in_preparation → delivered` shortcut is intentionally preserved:
   * it atomically marks the ticket ready (with ready_at) THEN delivered,
   * so the operator doesn't need two clicks when the kitchen says
   * "listo y entregado" at the same instant.
   */
  async markDelivered(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_CANCELLED,
        undefined,
        {
          from: ticket.status,
          to: 'delivered',
          hint: 'Este plato fue cancelado en cocina y no puede entregarse.',
        },
      );
    }
    if (ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_DELIVERED,
        undefined,
        {
          from: ticket.status,
          to: 'delivered',
          hint: 'Este plato ya fue marcado como entregado.',
        },
      );
    }
    if (ticket.status === 'pending') {
      // The operator-visible "Marcar entregado" button should NEVER be
      // enabled for pending items. If it fires (race, stale UI, devtools)
      // we surface a specific message that points at the KDS board.
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_NOT_READY,
        undefined,
        {
          from: ticket.status,
          to: 'delivered',
          hint:
            'No se puede marcar como entregado: el plato aún está pendiente en cocina. ' +
            'Espera a que el KDS lo marque como listo.',
        },
      );
    }
    // ticket.status is `ready` or `in_preparation` — both valid.
    // If still in_preparation, bump to ready first (sets ready_at).
    if (ticket.status === 'in_preparation') {
      await this.prisma.kitchen_tickets.update({
        where: { id: ticketId },
        data: { status: 'ready', ready_at: new Date(), updated_at: new Date() },
      });
      await this.prisma.kitchen_ticket_items.updateMany({
        where: {
          kitchen_ticket_id: ticketId,
          status: { in: ['pending', 'in_preparation'] },
        },
        data: { status: 'ready', updated_at: new Date() },
      });
    }

    const updated = await this.prisma.kitchen_tickets.update({
      where: { id: ticketId },
      data: { status: 'delivered', updated_at: new Date() },
    });
    await this.prisma.kitchen_ticket_items.updateMany({
      where: { kitchen_ticket_id: ticketId, status: { not: 'delivered' } },
      data: { status: 'delivered', updated_at: new Date() },
    });

    const full = await this.getTicketForStore(ticketId);
    this.pushKitchenEvent(store_id, {
      type: 'ticket.delivered',
      ticket: full.ticket,
      ts: Date.now(),
    });

    // Restaurant lifecycle bridge: once EVERY kitchen ticket of this order is
    // in a terminal state (delivered/cancelled) and at least one was actually
    // delivered, the kitchen handoff is complete. We emit an event (AFTER the
    // ticket mutations have committed above) so the orders domain can move the
    // order `processing -> delivered`. We use the event pattern instead of
    // injecting OrderFlowService here to avoid a cross-module dependency cycle
    // (KitchenFireModule would otherwise have to import the orders/order-flow
    // graph). The listener re-establishes the store tenant context via
    // StoreContextRunner before calling OrderFlowService.updateOrderState.
    try {
      const orderId = (full.ticket as any)?.order_id ?? ticket.order_id;
      if (orderId != null) {
        const orderTickets = await this.prisma.kitchen_tickets.findMany({
          where: { order_id: orderId, store_id },
          select: { status: true },
        });
        const allTerminal = orderTickets.every(
          (t) => t.status === 'delivered' || t.status === 'cancelled',
        );
        const anyDelivered = orderTickets.some(
          (t) => t.status === 'delivered',
        );
        if (orderTickets.length > 0 && allTerminal && anyDelivered) {
          this.eventEmitter.emit('kitchen.order_all_delivered', {
            orderId,
            storeId: store_id,
          });
        }
      }
    } catch (e) {
      // Best-effort: never block the ticket delivery on the order-side bridge.
      this.logger.warn(
        `Failed to evaluate order-all-delivered bridge for ticket #${ticketId}: ${
          (e as Error).message
        }`,
      );
    }

    return full.ticket;
  }

  /**
   * pending | in_preparation | ready → cancelled. Irreversible from the
   * KDS (the order-side flow would have to re-fire to bring it back).
   *
   * Restaurant Suite — Fase K audit jun-2026: emits SPECIFIC error
   * codes for the terminal cases (`already_cancelled` /
   * `already_delivered`) so the KDS toasts are actionable instead of
   * the generic dev-message.
   */
  async cancelTicket(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_CANCELLED,
        undefined,
        {
          from: ticket.status,
          to: 'cancelled',
          hint: 'Este plato ya fue cancelado en cocina.',
        },
      );
    }
    if (ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_ALREADY_DELIVERED,
        undefined,
        {
          from: ticket.status,
          to: 'cancelled',
          hint:
            'Este plato ya fue entregado y no puede cancelarse en cocina. ' +
            'Gestiona la cancelación desde la orden.',
        },
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const t = await tx.kitchen_tickets.update({
        where: { id: ticketId },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      await tx.kitchen_ticket_items.updateMany({
        where: { kitchen_ticket_id: ticketId, status: { not: 'delivered' } },
        data: { status: 'cancelled', updated_at: new Date() },
      });
      return t;
    });

    const full = await this.getTicketForStore(ticketId);
    this.pushKitchenEvent(store_id, {
      type: 'ticket.cancelled',
      ticket: full.ticket,
      ts: Date.now(),
    });
    return full.ticket;
  }

  /**
   * Reversa "un paso atrás" del estado de un ticket (botón del modal de
   * detalle del KDS). El mapa de retroceso es:
   *   pending        → (sin estado previo) → error KITCHEN_TICKET_CANNOT_REVERT
   *   in_preparation → pending
   *   ready          → in_preparation
   *   delivered      → ready
   *   cancelled      → ready
   *
   * Inventario: NO se toca. Los insumos se consumen en el fire (no en las
   * transiciones del ticket), así que reactivar un ticket NUNCA re-consume ni
   * devuelve stock. La reversa es puramente de estado (ticket + sus items).
   *
   * Bloqueo SÍNCRONO antes de mutar: cuando el ticket es terminal
   * (delivered/cancelled) y tiene orden asociada, revertirlo implica reabrir
   * la orden (delivered -> processing) vía el evento
   * `kitchen.order_delivery_reverted`. Pero ese puente es async/best-effort y
   * NO puede revertir una orden ya `finished`/`refunded`. Por eso validamos
   * el estado de la orden ANTES de mutar el ticket: si la orden no es
   * revertible, lanzamos y no dejamos el ticket en un estado inconsistente
   * (revertido mientras la orden quedó finalizada).
   */
  async revertTicket(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    // Mapa de retroceso un-paso. `pending` no tiene estado previo.
    const REVERT_MAP: Record<string, string | null> = {
      pending: null,
      in_preparation: 'pending',
      ready: 'in_preparation',
      delivered: 'ready',
      cancelled: 'ready',
    };
    const target = REVERT_MAP[ticket.status];

    if (target == null) {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_CANNOT_REVERT,
        undefined,
        { from: ticket.status },
      );
    }

    const wasTerminal =
      ticket.status === 'delivered' || ticket.status === 'cancelled';
    const orderId = ticket.order_id;

    // Bloqueo síncrono: si revertir el ticket reabre la orden, valida PRIMERO
    // que la orden admita la reversa. No mutamos nada si no la admite.
    if (wasTerminal && orderId != null) {
      const order = await this.prisma.orders.findFirst({
        where: { id: orderId },
        select: { state: true },
      });
      const orderState = order?.state;
      if (orderState === 'finished' || orderState === 'refunded') {
        throw new VendixHttpException(
          ErrorCodes.KITCHEN_TICKET_REVERT_ORDER_FINISHED,
          undefined,
          { orderState },
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.kitchen_tickets.update({
        where: { id: ticketId },
        data: { status: target as any, updated_at: new Date() },
      });
      await tx.kitchen_ticket_items.updateMany({
        where: { kitchen_ticket_id: ticketId },
        data: { status: target as any, updated_at: new Date() },
      });
    });

    const full = await this.getTicketForStore(ticketId);
    this.pushKitchenEvent(store_id, {
      type: 'ticket.reverted',
      ticket: full.ticket,
      ts: Date.now(),
      meta: { from: ticket.status, to: target },
    });

    // Si el ticket era terminal y tiene orden, emite el puente de reversa de
    // entrega (delivered -> processing) DESPUÉS del commit. El listener es
    // idempotente: no-op si la orden no está en `delivered`.
    if (wasTerminal && orderId != null) {
      this.eventEmitter.emit('kitchen.order_delivery_reverted', {
        orderId,
        storeId: store_id,
      });
    }

    return full.ticket;
  }

  // ---------------------------------------------------------------- snapshot
  /**
   * Snapshot of all tickets relevant to the KDS board. Returns the CURRENT
   * business day's tickets — the board "resets" at the store's
   * ticket_closing_hour (see getBusinessDate). Every ticket fired during the
   * active business day is shown regardless of state; nothing from a previous
   * business day leaks in once the cutoff hour passes.
   *
   * Used by both the explicit REST endpoint and the SSE warm-up.
   */
  async getActiveTicketsSnapshot(
    // Retained for SSE contract compat (the controller still passes it
    // positionally), but the board now resets by business day, not by window.
    _windowMinutes: number = 120,
  ): Promise<{ data: any[]; total: number; server_ts: number }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const now = new Date();
    const businessDate = await this.getBusinessDate(store_id);

    const data = await this.prisma.kitchen_tickets.findMany({
      where: {
        store_id,
        business_date: new Date(`${businessDate}T00:00:00.000Z`),
      },
      orderBy: { fired_at: 'asc' },
      include: KITCHEN_TICKET_INCLUDE,
    });

    return { data, total: data.length, server_ts: now.getTime() };
  }

  // ---------------------------------------------------------------- list tickets
  async findTickets(query: KitchenTicketQueryDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

    const where: Prisma.kitchen_ticketsWhereInput = {
      store_id,
      ...(query.status && { status: query.status }),
      ...(query.order_id && { order_id: query.order_id }),
    };

    const [data, total] = await Promise.all([
      this.prisma.kitchen_tickets.findMany({
        where,
        take: limit,
        orderBy: { fired_at: 'desc' },
        include: KITCHEN_TICKET_INCLUDE,
      }),
      this.prisma.kitchen_tickets.count({ where }),
    ]);

    return { data, total };
  }
}
