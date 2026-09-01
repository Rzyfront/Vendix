import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RecipesService, BomExplosionLine } from '../recipes/recipes.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { FireOrderItemsDto, KitchenTicketQueryDto, ResendOrderItemsDto } from './dto';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';
import { KdsSessionsService } from '../kds/sessions/kds-sessions.service';

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
      // QUI-655 — las exclusiones viajan CON el ticket para que el KDS pueda
      // mostrar tachado lo que el mesero quito al pedir, sin una segunda llamada.
      exclusions: {
        select: { component_product_id: true, path_recipe_ids: true },
      },
      // QUI-653 — "para llevar" viaja con el ticket porque QUIEN EMPACA es la
      // cocina, no el mesero. El flag vivia en `order_items` y se mostraba en la
      // fila de la mesa, pero el KDS nunca lo veia: el plato se servia en loza y
      // el dato solo existia del lado que no lo ejecuta.
      order_item: { select: { is_takeaway: true } },
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
  /** Ticket primario (estacion de menor id). Lo consumen 6 llamadores externos. */
  kitchen_ticket_id: number;
  /** QUI-651 — un id por estacion involucrada en el envio. */
  kitchen_ticket_ids: number[];
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
    /**
     * C.3 QUI-733 — id de la mesa de la sesión ABIERTA del pedido, si la hay.
     * Se resuelve ANTES de la transacción y se estampa en
     * `kitchen_tickets.table_id` al crear el ticket. Null para pedidos sin
     * mesa (mostrador / delivery) — el ticket no se rompe, solo pierde el dato.
     */
    table_id?: number | null;
  };
  firedItemIds: number[];
  skippedItemIds: number[];
  preparedItems: Array<{
    orderItem: {
      id: number;
      product_id: number | null;
      product_name: string;
      quantity: any;
      // QUI-651 — el contexto ya arrastra el producto; se declara solo lo que
      // el ruteo necesita. `kds_id` null significa "KDS por defecto".
      products?: { kds_id: number | null } | null;
      // CP-POLLO-ARABE-727 A.6 — la variante vendida viaja al ticket de cocina.
      // `product_variant_id` viene de `order_items`; `variant_attributes` /
      // `variant_sku` / `product_variants.name` alimentan el snapshot
      // `variant_label`.
      product_variant_id?: number | null;
      variant_attributes?: string | null;
      variant_sku?: string | null;
      product_variants?: { product_id: number; name: string | null } | null;
    };
    recipeId: number;
    bomLines: BomExplosionLine[];
  }>;
  recipeLessItems: Array<{
    id: number;
    product_id: number | null;
    product_name: string;
    quantity: any;
    // CP-POLLO-ARABE-727 A.6 — mismo arrastre de variante que `preparedItems`.
    products?: { kds_id: number | null; _count?: { product_variants?: number } } | null;
    product_variant_id?: number | null;
    variant_attributes?: string | null;
    variant_sku?: string | null;
    product_variants?: { product_id: number; name: string | null } | null;
  }>;
  locationByProduct: Map<number, number>;
  businessDate: string;
  user_id?: number;
  /**
   * QUI-655 — componentes excluidos por `order_item_id`, tal como los confirmo
   * el modal de cocina. Ausente o vacio equivale a "todos los componentes
   * marcados", que es el comportamiento previo al ticket.
   */
  exclusionsByOrderItem?: Map<number, number[]>;
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
    private readonly kdsSessionsService: KdsSessionsService,
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

    // ------------------------------------------------------------- QUI-655
    // PARTICION DE LINEA POR PREPARACION, antes de cualquier explosion de BOM.
    //
    // Se hace ACA y no mas abajo a proposito: `prepareFireContext` explota la
    // receta multiplicando por la cantidad de la linea, asi que si la particion
    // ocurriera despues habria que rehacer la explosion. Partiendo primero, todo
    // el pipeline aguas abajo (explosion, consumo, COGS, tickets, impresion)
    // sigue viendo lineas HOMOGENEAS y no cambia una sola linea de codigo.
    //
    // Eso es exactamente el argumento por el que se eligio partir sobre
    // `unit_index`: la invariante "una linea = una especificacion de preparacion"
    // se preserva en vez de romperse en cuatro lugares.
    const { orderItemIds: effectiveItemIds, exclusions: remappedExclusions } =
      await this.splitLinesForExclusions(dto);

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
        // C.3 QUI-733 — la sesión de mesa ABIERTA (closed_at IS NULL) del pedido,
        // para estampar `kitchen_tickets.table_id` al fire. `orders` no tiene
        // `table_session_id`: la relación vive al revés (table_sessions.order_id).
        // La más reciente; el índice one_open_per_table (A.3) garantiza una sola.
        table_sessions: {
          where: { closed_at: null },
          orderBy: { opened_at: 'desc' },
          take: 1,
          select: { id: true, table_id: true },
        },
        order_items: {
          where: { id: { in: effectiveItemIds } },
          include: {
            products: {
              select: {
                id: true,
                name: true,
                product_type: true,
                track_inventory: true,
                store_id: true,
                // QUI-651 — estacion destino del plato. NULL => KDS por defecto.
                kds_id: true,
                // CP-POLLO-ARABE-727 A.6 — para detectar "producto con variantes
                // y fire sin variante" (`logger.warn`, única señal del riesgo de
                // inventario descuadrado).
                _count: { select: { product_variants: true } },
              },
            },
            // CP-POLLO-ARABE-727 A.6 — la variante vendida se estampa en el ticket
            // de cocina. Se incluye para derivar `variant_label` (snapshot inmutable
            // del nombre) y validar en fire-time que la variante pertenece al
            // producto (ERR-15, PRODUCT_VARIANT_MISMATCH). A.7 nota que cualquier
            // consulta extra debe ir por `client`; esta va DENTRO del include (un
            // JOIN, no un round-trip adicional), así que no agrega N+1.
            product_variants: {
              select: { id: true, name: true, product_id: true },
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
      // CP-POLLO-ARABE-727 A.6 — ERR-15 en fire-time: la variante que se va a
      // estampar en `kitchen_ticket_items` tiene que pertenecer al producto. Si
      // declara una variante ajena, el ticket mostraría una especificación de
      // otro plato y el inventario quedaría descuadrado — se falla fuerte antes
      // de crear el ticket. (C.4 cubre los write-sites upstream; esta capa el fire.)
      this.assertVariantBelongsToProduct(item);
      // CP-POLLO-ARABE-727 A.6 — única señal del riesgo contable más grave del
      // plan: un plato con variantes llegando al fire SIN variante vendida.
      this.warnMissingVariantIdForProduct(item);
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
    // CP-POS-SVC-PERF-001 / A.2 — cache explodeBom per recipeId locally so
    // multiple cart lines sharing the same recipe cost 1 explosion (not N).
    const bomCache = new Map<number, BomExplosionLine[]>();
    // CP-POLLO-ARABE-727 A.7 — un único `findMany` en vez de un `findFirst` por
    // línea (N+1). Los items que comparten receta cuestan 1 explosión (bomCache).
    const firedProductIds = firedItemIds.map((itemId) => {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      return item.product_id!;
    });
    const activeRecipes =
      firedProductIds.length > 0
        ? await this.prisma.recipes.findMany({
            where: {
              product_id: { in: [...new Set(firedProductIds)] },
              is_active: true,
            },
            select: { id: true, product_id: true, is_active: true },
          })
        : [];
    const recipeByProduct = new Map<
      number,
      { id: number; product_id: number | null; is_active: boolean }
    >(activeRecipes.map((r) => [r.product_id, r]));
    for (const itemId of firedItemIds) {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      const recipe = recipeByProduct.get(item.product_id!);
      if (!recipe || !recipe.is_active) {
        // No active recipe → cooked by hand, no inventory consume.
        recipeLessItems.push(item);
        continue;
      }
      let bomLines = bomCache.get(recipe.id);
      if (!bomLines) {
        bomLines = await this.recipesService.explodeBom(recipe.id, {
          [recipe.id]: 1,
        });
        bomCache.set(recipe.id, bomLines);
      }
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
    // CP-POS-SVC-PERF-001 / A.1 — batch the N+1 location lookups into a
    // single Promise.all pass. Stock-location resolution is independent
    // per product, so parallelising is safe and reduces 30+ sequential
    // RTT to 1 round-trip burst.
    const distinctLeafIds = Array.from(allLeafProductIds);
    const locationResults = await Promise.all(
      distinctLeafIds.map((pid) =>
        this.stockLevelManager
          .getDefaultLocationForProduct(pid)
          .then((loc) => [pid, loc] as const)
          .catch(() => [pid, null] as const),
      ),
    );
    for (const [pid, loc] of locationResults) {
      if (loc !== null) locationByProduct.set(pid, loc);
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
      order: {
        id: order.id,
        order_number: order.order_number,
        table_id: order.table_sessions?.[0]?.table_id ?? null,
      },
      firedItemIds,
      skippedItemIds,
      preparedItems,
      recipeLessItems,
      locationByProduct,
      businessDate,
      user_id,
      // QUI-655 — exclusiones confirmadas en el modal, indexadas por item. Se
      // arman aca (fuera de la transaccion) porque el filtrado del BOM ocurre
      // dentro y no debe pagar el costo de recorrer el DTO por linea.
      exclusionsByOrderItem: new Map(
        remappedExclusions.map((e) => [
          e.order_item_id,
          e.component_product_ids ?? [],
        ]),
      ),
    };
    const result = await this.prisma.$transaction(async (tx) =>
      this.fireOrderItemsInTx(tx, store_id, preComputed),
    );

    // 5. Emit `kitchen.fired` AFTER the transaction commits. A failure
    //    here MUST NOT roll back the fire.
    try {
      this.eventEmitter.emit('kitchen.fired', {
        kitchen_ticket_id: result.ticketId,
        // QUI-651 — el asiento DR 6135 / CR 1435 es UNO por fire y cubre el COGS
        // de todas las estaciones (`total_cost` ya viene sumado), asi que el
        // listener contable no cambia. Se expone la lista para que quien audite
        // el asiento pueda rastrear a que tickets corresponde.
        kitchen_ticket_ids: result.ticketIds,
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

      // QUI-651 — un fire de dos estaciones produce DOS tickets, y cada tablero
      // solo escucha el suyo. Empujar unicamente el primario dejaba a la segunda
      // estacion sin enterarse hasta el siguiente refresco: el pedido existia en
      // su cola y su pantalla no lo mostraba.
      const secondaryTicketIds = result.ticketIds.filter(
        (id) => id !== result.ticketId,
      );
      if (secondaryTicketIds.length > 0) {
        const others = await this.prisma.kitchen_tickets.findMany({
          where: { id: { in: secondaryTicketIds }, store_id },
          include: KITCHEN_TICKET_INCLUDE,
        });
        for (const other of others) {
          this.pushKitchenEvent(store_id, {
            type: 'ticket.created',
            ticket: other,
            ts: Date.now(),
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to build SSE payload for tickets ${result.ticketIds.join(', ')}: ${
          (err as Error).message
        }`,
      );
    }

    return {
      kitchen_ticket_id: result.ticketId,
      // QUI-651 — todos los tickets del envio, uno por estacion involucrada. Se
      // agrega en vez de reemplazar `kitchen_ticket_id` porque 6 consumidores
      // externos leen ese campo; quien necesite las estaciones usa este.
      kitchen_ticket_ids: result.ticketIds,
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
    /** Ticket primario (estacion de menor id). Ver nota en el return. */
    ticketId: number;
    /** Un id por estacion involucrada en el fire (QUI-651). */
    ticketIds: number[];
    firedItemSnapshots: Array<{
      orderItemId: number;
      productId: number;
      productName: string;
      quantity: number;
      // CP-POLLO-ARABE-727 A.6 — la variante vendida viaja al ticket de cocina.
      // `productVariantId` = `order_items.product_variant_id` (nullable);
      // `variantLabel` snapshot inmutable del nombre de la variante.
      productVariantId: number | null;
      variantLabel: string | null;
    }>;
    cogsTotal: number;
    consumedLineCount: number;
  }> {
    const { order, preparedItems, recipeLessItems, locationByProduct, businessDate, user_id } =
      preComputed;
    const exclusionsByOrderItem =
      preComputed.exclusionsByOrderItem ?? new Map<number, number[]>();

    const firedItemSnapshots: Array<{
      orderItemId: number;
      productId: number;
      productName: string;
      quantity: number;
      productVariantId: number | null;
      variantLabel: string | null;
    }> = [];

    let cogsTotal = 0;
    let consumedLineCount = 0;

    // ---------------------------------------------------------------- QUI-651
    // La estación destino se resuelve ANTES de consumir, no al crear el ticket,
    // porque el movimiento de inventario tiene que nacer firmado con la sesión
    // de la estación que lo consumió. Resolverlo después obligaría a un UPDATE
    // posterior sobre `inventory_transactions`.
    //
    // Cascada: `products.kds_id` presente -> esa estación; sin él -> el KDS por
    // defecto de la tienda. Los `skip_kds = true` ya quedaron fuera aguas arriba.
    const defaultKds = await tx.kds.findFirst({
      where: { store_id, is_default: true, is_active: true },
      select: { id: true },
    });
    if (!defaultKds) {
      // Precondición real, no defensiva: la migración backfilleó un default por
      // tienda restaurante y el bootstrap lo autocrea. Si falta, rutear a ciegas
      // mandaría el ticket a un tablero que nadie mira.
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_FIRE_NO_DEFAULT_KDS,
        `La tienda ${store_id} no tiene un KDS por defecto activo`,
      );
    }

    const kdsByProduct = new Map<number, number>();
    for (const ctxItem of preparedItems) {
      kdsByProduct.set(
        ctxItem.orderItem.product_id!,
        ctxItem.orderItem.products?.kds_id ?? defaultKds.id,
      );
    }
    for (const item of recipeLessItems) {
      kdsByProduct.set(
        item.product_id!,
        item.products?.kds_id ?? defaultKds.id,
      );
    }

    // Sesión abierta por estación involucrada. Se resuelve UNA vez por estación
    // y no por línea de BOM: un plato con 15 ingredientes haría 15 consultas
    // idénticas. NULL es un resultado válido y esperado — el fire no se bloquea
    // porque la estación no haya abierto turno.
    const openSessionByKds = new Map<number, number | null>();
    for (const kdsId of new Set(kdsByProduct.values())) {
      const session = await tx.kds_sessions.findFirst({
        where: { kds_id: kdsId, status: 'open' },
        select: { id: true },
      });
      openSessionByKds.set(kdsId, session?.id ?? null);
    }


    for (const ctxItem of preparedItems) {
      const { orderItem, bomLines } = ctxItem;
      const orderQty = Number(orderItem.quantity || 0);
      if (!Number.isFinite(orderQty) || orderQty <= 0) {
        // Defensive — should never happen at this point.
        continue;
      }

      // ------------------------------------------------------------- QUI-655
      // Filtrado de exclusiones ANTES de consumir. Antes se recorrian todas las
      // hojas del BOM sin excepcion, asi que un plato "sin papas" descontaba las
      // papas igual y las cargaba al costo.
      //
      // Se valida server-side que cada componente excluido pertenezca realmente
      // al BOM de ESTE item: el cliente no puede excluir un producto arbitrario,
      // o el consumo dejaria de reflejar la receta.
      //
      // La exclusion de un NODO de sub-receta se expresa excluyendo sus hojas,
      // que es lo que el modal manda tras expandir `path_recipe_ids`; por eso el
      // filtro es por `component_product_id` y no necesita conocer el arbol.
      const excludedIds = new Set(
        (exclusionsByOrderItem.get(orderItem.id) ?? []).filter((componentId) => {
          const belongs = bomLines.some(
            (l) => l.component_product_id === componentId,
          );
          if (!belongs) {
            throw new VendixHttpException(
              ErrorCodes.KITCHEN_FIRE_EXCLUSION_NOT_IN_BOM,
              `El componente #${componentId} no pertenece a la receta del item #${orderItem.id}`,
            );
          }
          return true;
        }),
      );

      const effectiveBomLines = excludedIds.size
        ? bomLines.filter((l) => !excludedIds.has(l.component_product_id))
        : bomLines;

      // Per-leaf consumption: stock × orderQty × bomMultiplier.
      // CP-POS-SVC-PERF-001 / A.3 — per-leaf updateStock calls are
      // independent (each touches its own stock_levels row), so we
      // collect them and run in parallel via Promise.all. Cuts N
      // sequential round-trips to a single burst per order_item while
      // preserving the kds_session_id mapping (per item, not per leaf).
      const itemKdsSessionId =
        openSessionByKds.get(
          kdsByProduct.get(orderItem.product_id!) ?? defaultKds.id,
        ) ?? null;
      const updateStockPromises: Promise<any>[] = [];
      const validLines: Array<{
        line: (typeof effectiveBomLines)[number];
        consumedQty: number;
        locationId: number;
      }> = [];
      for (const line of effectiveBomLines) {
        const consumedQty = Math.round(line.quantity * orderQty);
        if (!Number.isFinite(consumedQty) || consumedQty <= 0) {
          this.logger.warn(
            `Skipping zero/invalid BOM line in recipe for order item ${orderItem.id}: component=${line.component_product_id} qty=${line.quantity}`,
          );
          continue;
        }
        const locationId = locationByProduct.get(line.component_product_id);
        if (!locationId) continue;
        validLines.push({ line, consumedQty, locationId });
      }
      for (const { line, consumedQty, locationId } of validLines) {
        updateStockPromises.push(
          this.stockLevelManager.updateStock(
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
              kds_session_id: itemKdsSessionId,
            },
            tx,
          ),
        );
      }
      const results = await Promise.all(updateStockPromises);
      for (const result of results) {
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
        productVariantId: orderItem.product_variant_id ?? null,
        variantLabel: this.variantLabelFor(orderItem),
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
        productVariantId: item.product_variant_id ?? null,
        variantLabel: this.variantLabelFor(item),
      });
    }

    // ---------------------------------------------------------------- QUI-651
    // RUTEO POR ESTACION. Antes esto creaba UN ticket por fire y todos los items
    // caian en el mismo tablero. Ahora se agrupan por su KDS destino — ya
    // resuelto arriba, porque el consumo de inventario necesitaba la estacion
    // antes de escribirse — y se crea un ticket POR ESTACION involucrada.
    // QUI-655 — nota de texto libre capturada al TOMAR el pedido. Es el camino
    // menos estructurado de los tres y el mas parecido a como funciona un
    // restaurante real con prisa ("poca sal", "bien cocido"): el cocinero la lee
    // en la estacion y desmarca en consecuencia. Se lee de la fuente de verdad
    // (`order_items.notes`) y no del DTO, porque la nota se escribio al pedir y
    // no al confirmar el envio.
    const firedOrderItemIds = firedItemSnapshots.map((s) => s.orderItemId);
    const notesByOrderItem = new Map<number, string>();
    if (firedOrderItemIds.length > 0) {
      const noted = await tx.order_items.findMany({
        where: { id: { in: firedOrderItemIds }, notes: { not: null } },
        select: { id: true, notes: true },
      });
      for (const row of noted) {
        if (row.notes) notesByOrderItem.set(row.id, row.notes);
      }
    }

    const snapshotsByKds = new Map<number, typeof firedItemSnapshots>();
    for (const snap of firedItemSnapshots) {
      const kdsId = kdsByProduct.get(snap.productId) ?? defaultKds.id;
      const bucket = snapshotsByKds.get(kdsId);
      if (bucket) bucket.push(snap);
      else snapshotsByKds.set(kdsId, [snap]);
    }

    const businessDateAsDate = new Date(`${businessDate}T00:00:00.000Z`);
    const ticketIds: number[] = [];

    // Orden estable por kds_id: hace el resultado determinista entre corridas
    // y deja el ticket "primario" (el primero) siempre en la misma estacion.
    for (const kdsId of [...snapshotsByKds.keys()].sort((a, b) => a - b)) {
      const snaps = snapshotsByKds.get(kdsId)!;

      // El correlativo diario es POR ESTACION: cada tablero cuenta desde 1, asi
      // cocina canta #1 y barra canta #1 el mismo dia. El advisory lock foldea
      // la estacion en su segunda clave para que dos fires concurrentes de la
      // MISMA estacion serialicen, y dos de estaciones distintas no se estorben.
      // Se libera solo al commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${store_id}::int, hashtext(${businessDate} || ':' || ${kdsId}::text)::int)`;
      const sameDayCount = await tx.kitchen_tickets.count({
        where: {
          store_id,
          kds_id: kdsId,
          business_date: businessDateAsDate,
        },
      });

      const ticket = await tx.kitchen_tickets.create({
        data: {
          store_id,
          order_id: order.id,
          // C.3 QUI-733 — estampar la mesa del pedido (vía su sesión ABIERTA,
          // resuelta aguas arriba en el preComputed). NULL para pedidos sin mesa
          // (mostrador / delivery); el ticket no se rompe, solo pierde el dato.
          table_id: order.table_id ?? null,
          kds_id: kdsId,
          status: 'pending',
          daily_number: sameDayCount + 1,
          business_date: businessDateAsDate,
          fired_at: new Date(),
          items: {
            create: snaps.map((snap) => ({
              order_item_id: snap.orderItemId,
              product_id: snap.productId,
              quantity: snap.quantity,
              status: 'pending',
              // CP-POLLO-ARABE-727 A.6 — la variante vendida viaja al ticket de
              // cocina. NULL para producto sin variantes (ticket idéntico al de
              // hoy). `variant_label` es un snapshot inmutable: no se re-etiqueta
              // si `product_variants.name` cambia después.
              product_variant_id: snap.productVariantId,
              variant_label: snap.variantLabel,
            })),
          },
        },
        include: { items: true },
      });
      ticketIds.push(ticket.id);

      // ----------------------------------------------------------- QUI-655
      // Persistir LO CONSUMIDO y propagar la nota, ya con los
      // `kitchen_ticket_items` creados y con id.
      //
      // Estos dos registros son lo que el cocinero LEE en la estacion. Sin
      // ellos el plato sale mal: el ticket diria "pollo" sin decir "sin salsa",
      // y el margen de ese plato no se podria explicar despues.
      for (const ktItem of ticket.items) {
        const excluded = exclusionsByOrderItem.get(ktItem.order_item_id) ?? [];
        const note = notesByOrderItem.get(ktItem.order_item_id);

        if (note) {
          // `kitchen_ticket_items.notes` existia en el schema documentando
          // exactamente este caso ("no onions", "allergy: gluten") y el codigo
          // nunca la escribia: columna disenada y desconectada hasta aqui.
          await tx.kitchen_ticket_items.update({
            where: { id: ktItem.id },
            data: { notes: note, updated_at: new Date() },
          });
        }

        if (excluded.length > 0) {
          await tx.kitchen_ticket_item_exclusions.createMany({
            data: excluded.map((componentId) => ({
              kitchen_ticket_item_id: ktItem.id,
              component_product_id: componentId,
              excluded_by_user_id: user_id ?? null,
            })),
            // El unique (kitchen_ticket_item_id, component_product_id) hace que
            // un reintento no duplique la exclusion.
            skipDuplicates: true,
          });
        }
      }
    }

    return {
      // `ticketId` es el ticket PRIMARIO del fire (la estacion de menor id).
      // Se conserva porque el evento `kitchen.fired` y el payload SSE siguen
      // siendo de un ticket, y migrar ese contrato a N tickets es el incremento
      // siguiente de QUI-651. Los consumidores que solo necesitan "un id para
      // notificar" no cambian; quien necesite todas las estaciones usa
      // `ticketIds`.
      ticketId: ticketIds[0],
      ticketIds,
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
  /**
   * Previsualización del envío a cocina — QUI-655.
   *
   * Devuelve, por item elegible, el árbol de su receta con la procedencia de cada
   * línea (`path_recipe_ids`), para que el modal de confirmación pueda mostrar los
   * nodos de sub-receta como agrupadores colapsables y desmarcar un nodo entero
   * ("sin salsa criolla") en vez de obligar al cocinero a desmarcar sus tres hojas
   * y a saber de memoria cuáles venían de la salsa.
   *
   * NO consume nada ni crea tickets: es una lectura. Reutiliza
   * `prepareFireContext`, que ya resuelve receta activa + explosión del BOM +
   * partición prepared/sin-receta, así que la previsualización y el envío real
   * NUNCA pueden discrepar sobre qué se va a consumir.
   *
   * Los `prepared` SIN receta activa se devuelven en la lista con
   * `components: []`: el ticket pide que aparezcan en el modal aunque no haya nada
   * que desglosar, para que el cocinero los vea y los envíe igual.
   */
  // ---------------------------------------------------------------- resend
  /**
   * QUI-762 — reenviar un plato a cocina SIN volver a consumir insumos.
   *
   * Caso de uso: un ticket caduca o se pierde (red, cocinero cerró la ventana,
   * etc.) y la orden sigue vigente. El camino obvio —volver a disparar el fire—
   * no funciona: `fireOrderItems` empuja los items con `inventory_consumed_at_fire`
   * a `skippedItemIds` (líneas 323-327 y 1344-1348 del archivo), así que
   * re-disparar produce un ticket vacío. Y resetear la bandera para re-disparar
   * sería peor: el fire volvería a explotar el BOM y a descontar los insumos por
   * segunda vez.
   *
   * Este método es un gemelo de `fireOrderItemsInTx` que SOLO crea el ticket y sus
   * items. No toca stock, no llama `RecipesService.explodeBom`, no llama
   * `StockLevelManager.updateStock`, no crea `inventory_transactions`, no crea
   * `inventory_movements`, no emite `kitchen.fired` (ese evento es de consumo;
   * el resend no consume). Sí emite `ticket.created` después del commit para que
   * el KDS reciba el SSE.
   *
   * Interacción con QUI-760 (imputador de consumo por sesión de turno):
   * las `inventory_transactions` del consumo original ya tienen (o no) un
   * `kds_session_id`. La guarda `kds_session_id IS NULL` del helper de QUI-760
   * protege el caso "ya imputado": el resend NO las mueve porque no crea
   * transactions nuevas. Si estaban huérfanas, el turno que cocine el nuevo
   * ticket las imputa al hacer `start/ready/delivered`. El resend es transparente
   * al imputador — un ticket nuevo, no duplica consumo.
   */
  async resendOrderItems(
    dto: ResendOrderItemsDto,
  ): Promise<{
    /** Ticket primario (estacion de menor id). */
    ticketId: number;
    /** Un id por estacion involucrada (mismo shape que el fire normal). */
    ticketIds: number[];
    /** Items reenviados. */
    firedItemIds: number[];
    /** Tickets viejos cancelados por este resend (solo `lost_command`). */
    cancelledTicketIds: number[];
  }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Gate al igual que el fire normal: un resend en tienda no-restaurante no
    // tiene sentido (no hay KDS adonde rutear).
    const storeIndustries = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: { industries: true },
    });
    if (!storeIsRestaurant(storeIndustries?.industries)) {
      throw new VendixHttpException(ErrorCodes.RESTAURANT_NOT_ENABLED);
    }

    if (!dto.order_item_ids || dto.order_item_ids.length === 0) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_NO_ITEMS);
    }

    // 1. Cargar la orden y los items solicitados, scope-safe.
    const order = await this.prisma.orders.findFirst({
      where: { id: dto.order_id, store_id },
      select: {
        id: true,
        store_id: true,
        // C.3 QUI-733 — la mesa se estampa al ticket via la sesión
        // ABIERTA del pedido (`table_sessions.order_id`). `orders` no
        // tiene `table_id` directo; la relación vive en table_sessions.
        // El fire normal usa el mismo patrón (líneas 278-283).
        table_sessions: {
          where: { closed_at: null },
          orderBy: { opened_at: 'desc' },
          take: 1,
          select: { id: true, table_id: true },
        },
        order_items: {
          where: { id: { in: dto.order_item_ids } },
          select: {
            id: true,
            product_id: true,
            product_name: true,
            product_variant_id: true,
            quantity: true,
            notes: true,
            // La bandera es la primera guarda del resend: si el item NUNCA
            // fue consumido al disparar, no es reenviable — es un fire
            // inicial. Lo mandamos al fire normal en lugar de inventar
            // un ticket con consumo cero.
            inventory_consumed_at_fire: true,
            products: {
              select: {
                id: true,
                kds_id: true,
              },
            },
            product_variants: {
              select: { id: true, name: true, product_id: true },
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

    // 2. Validar estado de la orden. cancelled y refunded nunca reciben resend;
    //    cualquier otro estado (created, processing, delivered, finished) es
    //    legítimo porque un ticket se puede perder en cualquier momento de la
    //    cadena mientras la orden siga activa.
    const orderState = await this.prisma.orders.findUnique({
      where: { id: order.id },
      select: { state: true },
    });
    if (
      orderState?.state === 'cancelled' ||
      orderState?.state === 'refunded'
    ) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_NOT_RESENDABLE);
    }

    // 3. Validar que CADA item está consumido y pertenece a la orden. Si
    //    alguno no cumple, rechaza — el cliente puede entonces decidir si
    //    dispara un fire normal o elimina ese id del payload.
    for (const item of order.order_items) {
      if (!item.inventory_consumed_at_fire) {
        throw new VendixHttpException(
          ErrorCodes.KITCHEN_FIRE_NOT_RESENDABLE,
          `El item #${item.id} nunca fue consumido al disparar a cocina. ` +
            `Use el fire normal en lugar del resend para items sin consumir.`,
        );
      }
    }

    // 4. Validar que ninguno de los items ya fue entregado al cliente. Un
    //    ticket de un item entregado no se reenvía: la cocina ya cocinó el
    //    plato y el cliente ya lo tiene. Si la operación humana insiste, el
    //    operador edita el pedido o crea uno nuevo.
    const deliveredRows = await this.prisma.kitchen_ticket_items.findMany({
      where: {
        order_item_id: { in: order.order_items.map((it) => it.id) },
        status: 'delivered',
      },
      select: { order_item_id: true },
    });
    if (deliveredRows.length > 0) {
      const ids = Array.from(
        new Set(deliveredRows.map((r) => r.order_item_id)),
      ).join(', ');
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_FIRE_NOT_RESENDABLE,
        `Los items #${ids} ya fueron entregados y no se reenvían. ` +
          `Cree un nuevo pedido si el cliente quiere repetir el plato.`,
      );
    }

    // 5. Resolver KDS por item — mismo patrón que `fireOrderItemsInTx`. Si los
    //    items enrutan a estaciones distintas, son tickets distintos. El
    //    `UNIQUE (store_id, kds_id, business_date, daily_number)` exige
    //    poblar `kds_id` y `business_date` (los NULL no colisionan en
    //    Postgres), y un resend en NULL podría insertar duplicados sin
    //    que el P2002 nos avisara. Por eso los populamos explícitamente.
    const defaultKds = await this.prisma.kds.findFirst({
      where: { store_id, is_default: true, is_active: true },
      select: { id: true },
    });
    if (!defaultKds) {
      throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_NO_DEFAULT_KDS);
    }

    const kdsByProduct = new Map<number, number>();
    for (const item of order.order_items) {
      if (item.product_id) {
        kdsByProduct.set(
          item.product_id,
          item.products?.kds_id ?? defaultKds.id,
        );
      }
    }

    const businessDate = await this.getBusinessDate(store_id);
    const businessDateAsDate = new Date(`${businessDate}T00:00:00.000Z`);

    // 6. Crear los tickets en transacción. Mismo advisory lock + count +
    //    daily_number que el fire normal, agrupando por kds_id cuando los
    //    items enrutan a estaciones distintas.
    const snapshotsByKds = new Map<
      number,
      Array<{
        orderItemId: number;
        productId: number;
        productName: string;
        quantity: number;
        productVariantId: number | null;
        variantLabel: string | null;
        notes: string | null;
      }>
    >();
    for (const item of order.order_items) {
      if (!item.product_id) continue;
      const kdsId = kdsByProduct.get(item.product_id) ?? defaultKds.id;
      const snap = {
        orderItemId: item.id,
        productId: item.product_id,
        productName: item.product_name,
        quantity: Number(item.quantity || 0),
        productVariantId: item.product_variant_id ?? null,
        variantLabel: this.variantLabelFor(item),
        notes: item.notes ?? null,
      };
      const bucket = snapshotsByKds.get(kdsId);
      if (bucket) bucket.push(snap);
      else snapshotsByKds.set(kdsId, [snap]);
    }

    const createdTickets: Array<{ id: number; kds_id: number }> = [];

    // 6b. Tickets viejos candidatos a cancelacion (solo en `lost_command`).
    //
    // Buscamos TODOS los tickets previos que tengan AL MENOS UN item de los
    // reenviados, sin importar el estado del item, PERO limitamos la
    // cancelacion a los que NO estan en estado terminal (`delivered`): un
    // ticket cuyo item ya fue entregado no se cancela retroactivamente — ya
    // cuenta como coccion real para el reporte historico.
    //
    // Si reason='remake_dish', esta lista queda vacia y el comportamiento es
    // el viejo (dos tickets vivos apuntando al mismo item, ambos reales).
    const oldTicketIdsToCancel: number[] =
      dto.reason === 'lost_command'
        ? Array.from(
            new Set(
              (
                await this.prisma.kitchen_ticket_items.findMany({
                  where: {
                    order_item_id: { in: order.order_items.map((it) => it.id) },
                    status: { in: ['pending', 'in_preparation'] },
                    // Acotar al mismo `business_date` del reenvío: un
                    // pendiente de hace semanas es problema de QUI-761
                    // (caducidad por dia), no del resend. Cancelar
                    // tickets historicos como efecto colateral de una
                    // accion sobre datos de hoy es una escritura sobre
                    // datos que nadie pidio cambiar.
                    kitchen_ticket: {
                      business_date: businessDateAsDate,
                    },
                  },
                  select: { kitchen_ticket_id: true },
                })
              ).map((row) => row.kitchen_ticket_id),
            ),
          )
        : [];

    const ticketIds: number[] = await this.prisma.$transaction(
      async (tx) => {
        const ids: number[] = [];

        // 6b.i Cancelar los tickets viejos en la MISMA transaccion. Solo
        // se invoca si la razon es `lost_command` — si el operador eligio
        // `remake_dish`, oldTicketIdsToCancel viene vacio y este bloque es
        // no-op. El helper `cancelTicketInTx` flipea el ticket a 'cancelled'
        // y a sus items pendientes/preparacion a 'cancelled' tambien
        // (ignora `delivered` y `ready`, que ya cuentan como coccion real).
        //
        // Contexto de inventario: la cancelacion aqui es de TICKET, no de
        // INVENTARIO. La merma ya se firmo al disparar el primer fire y
        // `payments.updateInventoryFromOrder:2554` ya protege contra doble
        // descuento via `if (item.inventory_consumed_at_fire === true)
        // continue;`. Cancelar la reimpresion no devuelve nada al stock
        // (la fila `kitchen_ticket_items` vieja pasa a cancelled; el row
        // de `inventory_transactions` del consumo original sigue intacto y
        // estampado al turno de QUI-760 si corresponde).
        for (const oldTicketId of oldTicketIdsToCancel) {
          await this.cancelTicketInTx(tx, oldTicketId);
        }

        // Orden estable por kds_id: mismo shape que el fire normal.
        for (const kdsId of [...snapshotsByKds.keys()].sort((a, b) => a - b)) {
          const snaps = snapshotsByKds.get(kdsId)!;

          // El lock y el count son POR ESTACION y POR DIA — un restaurante
          // con dos tickets #1 simultáneos en dos cocinas distintas es lo
          // que este lock evita. Mismo patrón que `fireOrderItemsInTx:875`.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${store_id}::int, hashtext(${businessDate} || ':' || ${kdsId}::text)::int)`;
          const sameDayCount = await tx.kitchen_tickets.count({
            where: {
              store_id,
              kds_id: kdsId,
              business_date: businessDateAsDate,
            },
          });

          const ticket = await tx.kitchen_tickets.create({
            data: {
              store_id,
              order_id: order.id,
              // Misma mesa que el fire normal (vía el snapshot del order):
              // NULL para mostrador / delivery. El resend hereda la mesa
              // del pedido original, no del ticket anterior.
              table_id: order.table_sessions?.[0]?.table_id ?? null,
              kds_id: kdsId,
              status: 'pending',
              daily_number: sameDayCount + 1,
              business_date: businessDateAsDate,
              fired_at: new Date(),
              items: {
                create: snaps.map((snap) => ({
                  order_item_id: snap.orderItemId,
                  product_id: snap.productId,
                  quantity: snap.quantity,
                  status: 'pending',
                  // El snapshot del variant_label viaja igual que en el
                  // fire normal — inmutable a cambios posteriores del
                  // nombre de la variante.
                  product_variant_id: snap.productVariantId,
                  variant_label: snap.variantLabel,
                  notes: snap.notes,
                })),
              },
            },
            include: { items: true },
          });
          ids.push(ticket.id);
          createdTickets.push({ id: ticket.id, kds_id: kdsId });
        }
        return ids;
      },
    );

    // 7. Emitir `ticket.created` por cada uno (igual que el fire normal:
    //    después del commit, best-effort). El tipo es `ticket.created`
    //    según el union declarado en el frontend
    //    (`kitchen-ticket.interface.ts:136`). NO `kitchen.ticket.created`.
    try {
      const tickets = await this.prisma.kitchen_tickets.findMany({
        where: { id: { in: ticketIds }, store_id },
        include: KITCHEN_TICKET_INCLUDE,
      });
      for (const ticket of tickets) {
        this.pushKitchenEvent(store_id, {
          type: 'ticket.created',
          ticket,
          ts: Date.now(),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to push SSE for resend tickets ${ticketIds.join(', ')}: ${
          (err as Error).message
        }`,
      );
    }

    // 8. Emitir `ticket.cancelled` por cada viejo cancelado (solo si
    //    `lost_command`). Usamos `emitTicketCancelledEvent` que ya invoca
    //    el imputador de QUI-760
    //    (`KdsSessionsService.attributeOpenSessionToTicketConsumption`) en
    //    post-commit — la guarda `kds_session_id IS NULL` deja quietas
    //    las inventory_transactions del consumo original que ya estan
    //    estampadas. Si hay filas sin estampar, se imputan al turno
    //    actual. El resend no las altera.
    for (const oldTicketId of oldTicketIdsToCancel) {
      await this.emitTicketCancelledEvent(oldTicketId);
    }

    // El primario es el de menor kds_id (mismo criterio que el fire
    // normal). Aquí ya tenemos `createdTickets` ordenada por kds_id, así
    // que el primero es el primario.
    return {
      ticketId: ticketIds[0],
      ticketIds,
      firedItemIds: order.order_items.map((it) => it.id),
      cancelledTicketIds: oldTicketIdsToCancel,
    };
  }

  async previewFire(
    orderId: number,
    candidateOrderItemIds: number[],
  ): Promise<{
    order_id: number;
    items: Array<{
      order_item_id: number;
      product_id: number | null;
      product_name: string;
      quantity: number;
      notes: string | null;
      has_active_recipe: boolean;
      components: Array<{
        component_product_id: number;
        name: string;
        sku: string | null;
        stock_unit: string | null;
        /** Cantidad total para ESTA línea (ya multiplicada por su cantidad). */
        quantity: number;
        depth: number;
        path_recipe_ids: number[];
      }>;
    }>;
    skipped_item_ids: number[];
  }> {
    const ctx = await this.prepareFireContext(orderId, candidateOrderItemIds);
    // `prepareFireContext` devuelve null cuando NINGUN item es elegible (todos ya
    // consumidos, o ninguno es prepared). Para una previsualizacion eso no es un
    // error: es "no hay nada que confirmar", y el modal debe poder decirlo en vez
    // de reventar.
    if (!ctx) {
      return { order_id: orderId, items: [], skipped_item_ids: candidateOrderItemIds };
    }

    // Un solo lookup de catálogo para todos los componentes de todos los items:
    // resolver el nombre por línea haría N consultas donde una alcanza, y un
    // envío de 10 platos son decenas de hojas.
    const componentIds = new Set<number>();
    for (const it of ctx.preparedItems) {
      for (const line of it.bomLines) componentIds.add(line.component_product_id);
    }
    const components =
      componentIds.size > 0
        ? await this.prisma.products.findMany({
            where: { id: { in: [...componentIds] } },
            select: { id: true, name: true, sku: true, stock_unit: true },
          })
        : [];
    // Tipo explicito por la misma razon que arriba: el Map inferido desde un
    // `map` sobre tuplas ensancha el valor a `{}` y los accesos fallan.
    type ComponentMeta = {
      id: number;
      name: string;
      sku: string | null;
      stock_unit: string | null;
    };
    const byId = new Map<number, ComponentMeta>(
      components.map((c) => [c.id, c as ComponentMeta]),
    );

    // La nota se lee de `order_items.notes`: es el camino de captura que el
    // cocinero traduce a exclusiones cuando la petición no calza con un
    // ingrediente exacto ("poca sal", "bien cocido").
    const allItemIds = [
      ...ctx.preparedItems.map((i) => i.orderItem.id),
      ...ctx.recipeLessItems.map((i) => i.id),
    ];
    const notesRows =
      allItemIds.length > 0
        ? await this.prisma.order_items.findMany({
            where: { id: { in: allItemIds } },
            select: { id: true, notes: true },
          })
        : [];
    // Tipo explicito: con el `?? null`, TS ensancha el valor del Map a `{}`.
    const notesById = new Map<number, string | null>(
      notesRows.map((r) => [r.id, r.notes ?? null]),
    );

    return {
      order_id: orderId,
      items: [
        ...ctx.preparedItems.map((it) => ({
          order_item_id: it.orderItem.id,
          product_id: it.orderItem.product_id,
          product_variant_id: it.orderItem.product_variant_id ?? null,
          variant_attributes: it.orderItem.variant_attributes ?? null,
          product_name: it.orderItem.product_name,
          quantity: Number(it.orderItem.quantity || 0),
          notes: notesById.get(it.orderItem.id) ?? null,
          has_active_recipe: true,
          components: it.bomLines.map((line) => {
            const meta = byId.get(line.component_product_id);
            return {
              component_product_id: line.component_product_id,
              name: meta?.name ?? `#${line.component_product_id}`,
              sku: meta?.sku ?? null,
              stock_unit: meta?.stock_unit ?? null,
              // `explodeBom` ya aplicó merma y yield en cada nivel; se multiplica
              // por la cantidad de la línea para que el modal muestre lo que
              // realmente se va a descontar y no la receta unitaria.
              quantity: line.quantity * Number(it.orderItem.quantity || 0),
              depth: line.depth,
              path_recipe_ids: line.path_recipe_ids,
            };
          }),
        })),
        ...ctx.recipeLessItems.map((it) => ({
          order_item_id: it.id,
          product_id: it.product_id,
          product_variant_id: it.product_variant_id ?? null,
          variant_attributes: it.variant_attributes ?? null,
          product_name: it.product_name,
          quantity: Number(it.quantity || 0),
          notes: notesById.get(it.id) ?? null,
          has_active_recipe: false,
          components: [],
        })),
      ],
      skipped_item_ids: ctx.skippedItemIds,
    };
  }

  /**
   * VERIFICACION DE TICKET — QUI-655.
   *
   * Devuelve, por cada platillo del ticket, su receta con los insumos que va a
   * consumir y cuales vienen EXCLUIDOS. Es lo que alimenta el modal obligatorio
   * para pasar de pendiente a en preparacion.
   *
   * Por que NO reusa `/preview`: el preview parte de `prepareFireContext`, que
   * descarta los items con `inventory_consumed_at_fire = true` — una condicion del
   * ENVIO. Al verificar, el item ya paso por el fire, asi que el preview lo excluia
   * y el modal llegaba vacio. Esta lectura parte del TICKET, no de la elegibilidad
   * para enviar.
   *
   * Contrato identico al del preview a proposito, para que el modal se reutilice
   * sin bifurcar su codigo.
   */
  async getTicketVerification(ticketId: number): Promise<{
    order_id: number;
    items: Array<{
      order_item_id: number;
      product_id: number | null;
      product_name: string;
      quantity: number;
      notes: string | null;
      has_active_recipe: boolean;
      excluded_component_ids: number[];
      components: Array<{
        component_product_id: number;
        name: string;
        sku: string | null;
        stock_unit: string | null;
        quantity: number;
        depth: number;
        path_recipe_ids: number[];
      }>;
    }>;
    skipped_item_ids: number[];
  }> {
    const { ticket } = await this.getTicketForStore(ticketId);
    const rawItems: any[] = (ticket as any).items ?? [];

    const items: any[] = [];
    const componentIds = new Set<number>();
    const perItem: Array<{ item: any; bom: BomExplosionLine[] }> = [];
    // CP-POLLO-ARABE-727 A.7 — cache explodeBom per recipeId so N lines sharing
    // the same recipe cost 1 explosion, not N. Mirrors prepareFireContext.
    const bomCache = new Map<number, BomExplosionLine[]>();

    for (const it of rawItems) {
      // `KITCHEN_TICKET_INCLUDE` ya carga `product.recipe {id, is_active}`, así
      // que no hay que re-consultar `recipes.findFirst` por línea — ese era el
      // N+1 del modal de verificación de QUI-655 (10 platos = 10 round-trips).
      const recipe = it.product?.recipe ?? null;
      // Sin receta activa se devuelve igual, con `components: []`: el cocinero debe
      // verlo en el modal y poder confirmarlo, no que desaparezca.
      let bom: BomExplosionLine[];
      if (!recipe || !recipe.is_active) {
        bom = [];
      } else {
        const cached = bomCache.get(recipe.id);
        if (cached) {
          bom = cached;
        } else {
          bom = await this.recipesService.explodeBom(recipe.id);
          bomCache.set(recipe.id, bom);
        }
      }
      for (const l of bom) componentIds.add(l.component_product_id);
      perItem.push({ item: it, bom });
    }

    const meta =
      componentIds.size > 0
        ? await this.prisma.products.findMany({
            where: { id: { in: [...componentIds] } },
            select: { id: true, name: true, sku: true, stock_unit: true },
          })
        : [];
    type Meta = { id: number; name: string; sku: string | null; stock_unit: string | null };
    const byId = new Map<number, Meta>(meta.map((m) => [m.id, m as Meta]));

    const orderItemIds = rawItems
      .map((i) => i.order_item_id)
      .filter((v): v is number => typeof v === 'number');
    const orderItems =
      orderItemIds.length > 0
        ? await this.prisma.order_items.findMany({
            where: { id: { in: orderItemIds } },
            select: { id: true, notes: true },
          })
        : [];
    const notesById = new Map<number, string | null>(
      orderItems.map((r) => [r.id, r.notes ?? null]),
    );

    for (const { item, bom } of perItem) {
      const qty = Number(item.quantity || 0);
      items.push({
        order_item_id: item.order_item_id,
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? null,
        variant_attributes: item.variant_label ?? null,
        product_name: item.product?.name ?? `#${item.product_id}`,
        quantity: qty,
        notes: notesById.get(item.order_item_id) ?? item.notes ?? null,
        has_active_recipe: bom.length > 0,
        // Lo que ya venia excluido: el modal los arranca desmarcados y por lo tanto
        // TACHADOS, para que el cocinero vea "sin papas" sin leer una nota.
        excluded_component_ids: (item.exclusions ?? []).map(
          (e: any) => e.component_product_id,
        ),
        components: bom.map((line) => {
          const m = byId.get(line.component_product_id);
          return {
            component_product_id: line.component_product_id,
            name: m?.name ?? `#${line.component_product_id}`,
            sku: m?.sku ?? null,
            stock_unit: m?.stock_unit ?? null,
            // Multiplicado por la cantidad de la linea: la receta cruda es unitaria
            // y mostrarla asi haria que el cocinero vea menos de lo que se gasta.
            quantity: line.quantity * qty,
            depth: line.depth,
            path_recipe_ids: line.path_recipe_ids,
          };
        }),
      });
    }

    return { order_id: ticket.order_id, items, skipped_item_ids: [] };
  }

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
        // C.3 QUI-733 — la sesión de mesa ABIERTA (closed_at IS NULL) del pedido,
        // para estampar `kitchen_tickets.table_id` al fire. `orders` no tiene
        // `table_session_id`: la relación vive al revés (table_sessions.order_id).
        // La más reciente; el índice one_open_per_table (A.3) garantiza una sola.
        table_sessions: {
          where: { closed_at: null },
          orderBy: { opened_at: 'desc' },
          take: 1,
          select: { id: true, table_id: true },
        },
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
                // QUI-651 — estacion destino del plato. NULL => KDS por defecto.
                kds_id: true,
                // CP-POLLO-ARABE-727 A.6 — conteo de variantes para el warn de
                // "producto con variantes y fire sin variante".
                _count: { select: { product_variants: true } },
              },
            },
            // CP-POLLO-ARABE-727 A.6 — arrastre de la variante vendida (ver nota
            // en el include de `fireOrderItems`).
            product_variants: {
              select: { id: true, name: true, product_id: true },
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
      // CP-POLLO-ARABE-727 A.6 — mismo guard que `fireOrderItems`: ERR-15
      // (variante que no pertenece al producto) + warn de variante ausente.
      this.assertVariantBelongsToProduct(item);
      this.warnMissingVariantIdForProduct(item);
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
    // CP-POS-SVC-PERF-001 / A.2 — cache explodeBom per recipeId locally so
    // multiple cart lines sharing the same recipe cost 1 explosion (not N).
    const bomCache = new Map<number, BomExplosionLine[]>();
    // CP-POLLO-ARABE-727 A.7 — un único `findMany` en vez de `findFirst` por
    // línea, y por `client` (el tx de la transacción abierta del llamador), no
    // por `this.prisma`: esto era la fuga de pool documentada (1 conexión
    // retenida por la tx + N secuenciales del mismo pool).
    const firedProductIds = firedItemIds.map((itemId) => {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      return item.product_id!;
    });
    const activeRecipes =
      firedProductIds.length > 0
        ? await client.recipes.findMany({
            where: {
              product_id: { in: [...new Set(firedProductIds)] },
              is_active: true,
            },
            select: { id: true, product_id: true, is_active: true },
          })
        : [];
    const recipeByProduct = new Map<
      number,
      { id: number; product_id: number | null; is_active: boolean }
    >(activeRecipes.map((r) => [r.product_id, r]));
    for (const itemId of firedItemIds) {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      const recipe = recipeByProduct.get(item.product_id!);
      if (!recipe || !recipe.is_active) {
        recipeLessItems.push(item);
        continue;
      }
      let bomLines = bomCache.get(recipe.id);
      if (!bomLines) {
        bomLines = await this.recipesService.explodeBom(
          recipe.id,
          { [recipe.id]: 1 },
          client,
        );
        bomCache.set(recipe.id, bomLines);
      }
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
    // CP-POS-SVC-PERF-001 / A.1 — batch the N+1 location lookups into a
    // single Promise.all pass. Stock-location resolution is independent
    // per product, so parallelising is safe and reduces 30+ sequential
    // RTT to 1 round-trip burst.
    const distinctLeafIds = Array.from(allLeafProductIds);
    const locationResults = await Promise.all(
      distinctLeafIds.map((pid) =>
        this.stockLevelManager
          .getDefaultLocationForProduct(pid, undefined, client)
          .then((loc) => [pid, loc] as const)
          .catch(() => [pid, null] as const),
      ),
    );
    for (const [pid, loc] of locationResults) {
      if (loc !== null) locationByProduct.set(pid, loc);
    }

    const businessDate = await this.getBusinessDate(store_id);

    return {
      order: {
        id: order.id,
        order_number: order.order_number,
        table_id: order.table_sessions?.[0]?.table_id ?? null,
      },
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
      /** QUI-651 — un id por estacion involucrada; el SSE los empuja todos. */
      ticketIds: number[];
      firedItemSnapshots: Array<{
        orderItemId: number;
        productId: number;
        productName: string;
        quantity: number;
        // CP-POLLO-ARABE-727 A.6 — mismo shape que `fireOrderItemsInTx`; el
        // auto-fire también conserva la variante en el snapshot.
        productVariantId: number | null;
        variantLabel: string | null;
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
      // QUI-651 — este es el segundo camino de fire (auto-fire desde pago / cierre
      // de mesa / split) y tenia el MISMO defecto que el manual: empujaba solo el
      // ticket primario, asi que en un envio de dos estaciones la segunda no se
      // enteraba hasta el siguiente refresco.
      const allTickets = await this.prisma.kitchen_tickets.findMany({
        where: { id: { in: result.ticketIds }, store_id },
        include: KITCHEN_TICKET_INCLUDE,
      });
      for (const ticket of allTickets) {
        this.pushKitchenEvent(store_id, {
          type: 'ticket.created',
          ticket,
          ts: Date.now(),
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to build SSE payload for tickets ${result.ticketIds.join(', ')}: ${
          (err as Error).message
        }`,
      );
    }
    return {
      kitchen_ticket_id: result.ticketId,
      kitchen_ticket_ids: result.ticketIds,
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

    // QUI-XXX — station-lock guard. Si el turno abierto de la KDS del ticket
    // lo posée otro operador y todavía está fresco (<5min sin `last_seen_at`),
    // el helper lanza KDS_STATION_LOCKED antes de cualquier mutación de
    // estado. Lazy inactividad: si el turno está vencido lo cierra en
    // silencio y deja pasar. Owner/admin pueden actuar aunque el turno sea
    // ajeno, pero el "Tomar control" explícito vive en el botón del status
    // bar — esta mutación NO estampa `force_taken_by_user_id` por sí sola.
    await this.kdsSessionsService.assertCanMutateStationTicket(ticket.kds_id);

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
      // CP-POLLO-ARABE-727 F.1 — `KITCHEN_TICKET_INCLUDE` ya carga
      // `product.recipe {id, is_active}` (su comentario dice "Mirrors the
      // startPreparation guard"). Re-consultar `recipes.findFirst` por línea
      // era el mismo N+1 que A.7 eliminó en `fireOrderItems`/`prepareFireContext`
      // y quedó vivo acá: N round-trips secuenciales al pool por ticket.
      const hasActiveRecipe = item.product?.recipe?.is_active === true;
      if (!hasActiveRecipe) {
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
    // QUI-760 — imputa las inventory_transactions del ticket a la sesión
    // abierta de la KDS. Va DESPUÉS del pushKitchenEvent y envuelto en
    // try/catch: la imputación es un side-effect contable; si falla, NO
    // debe tumbar el handler (el cambio de estado ya está commiteado) NI
    // bloquear la difusión SSE — un efecto contable no puede tener poder
    // de veto sobre la difusión operativa. La guarda `kds_session_id IS
    // NULL` del helper hace que solo la primera acción tenga efecto;
    // llamarlo desde los tres sale gratis y no rompe idempotencia.
    this.pushKitchenEvent(store_id, {
      type: 'ticket.started',
      ticket: full.ticket,
      ts: Date.now(),
    });
    try {
      await this.kdsSessionsService.attributeOpenSessionToTicketConsumption(ticketId);
    } catch (err) {
      this.logger.error(
        `QUI-760: failed to attribute ticket ${ticketId} consumption to KDS session`,
        err as Error,
      );
    }
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

    // Ver `startPreparation` — station-lock guard uniforme en todas las
    // mutaciones de cocina.
    await this.kdsSessionsService.assertCanMutateStationTicket(ticket.kds_id);

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
    // QUI-760 — ver nota en `startPreparation`. La guarda `kds_session_id`
    // IS NULL garantiza que este helper no haga nada si el ticket ya fue
    // firmado por `start`. Mismo orden push-primero-try-catch-después:
    // la difusión operativa no puede depender de un efecto contable.
    this.pushKitchenEvent(store_id, {
      type: 'ticket.ready',
      ticket: full.ticket,
      ts: Date.now(),
    });
    // T9 — paso 2: listo de cocina produce notificación de tienda. Va
    // DESPUÉS del push operativo y envuelto en try/catch porque la difusión
    // del sonido no puede depender de un efecto secundario (mismo patrón que
    // la imputación contable QUI-760 de abajo). `@OnEvent` tiene
    // `suppressErrors` en true por defecto en este repo, así que un fallo
    // dentro del listener se traga solo: registramos explícito para que el
    // guardia del sonido no se vuelva silencio inexplicable.
    try {
      this.eventEmitter.emit('kitchen.ticket_ready', {
        store_id,
        ticket_id: ticketId,
        order_id: full.ticket.order_id,
        order_number: (full.ticket as any).order?.order_number ?? null,
      });
    } catch (err) {
      this.logger.error(
        `[kitchen.ticket_ready] failed to emit for ticket #${ticketId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
    try {
      await this.kdsSessionsService.attributeOpenSessionToTicketConsumption(ticketId);
    } catch (err) {
      this.logger.error(
        `QUI-760: failed to attribute ticket ${ticketId} consumption to KDS session`,
        err as Error,
      );
    }
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

    // Ver `startPreparation` — station-lock guard uniforme.
    await this.kdsSessionsService.assertCanMutateStationTicket(ticket.kds_id);

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

    // QUI-652 — el ticket de cocina alimenta el HECHO DE SERVICIO en
    // `order_items`, que es donde vive la entrega desde que se desacoplo de
    // cocina. Sin esto habria dos verdades: el plato preparado quedaria
    // 'delivered' en el ticket y sin marca de entrega en su linea de pedido,
    // mientras una cerveza (que nunca pasa por cocina) solo tendria la marca.
    //
    // Se estampa solo donde esta NULL: la primera entrega es la que ocurrio, y
    // un re-delivery no debe mover la fecha hacia adelante.
    const deliveredItems = await this.prisma.kitchen_ticket_items.findMany({
      where: { kitchen_ticket_id: ticketId },
      select: { order_item_id: true },
    });
    if (deliveredItems.length > 0) {
      await this.prisma.order_items.updateMany({
        where: {
          id: { in: deliveredItems.map((it) => it.order_item_id) },
          delivered_at: null,
        },
        data: {
          delivered_at: new Date(),
          delivered_by_user_id:
            RequestContextService.getContext()?.user_id ?? null,
          updated_at: new Date(),
        },
      });
    }

    const full = await this.getTicketForStore(ticketId);
    // QUI-760 — ver nota en `startPreparation`. Mismo helper, mismo
    // invariante de idempotencia: si el ticket ya fue firmado por `start`
    // o `ready`, este llamado no estampa nada. Mismo orden push-primero-
    // try-catch-después: la difusión operativa no puede depender de un
    // efecto contable.
    this.pushKitchenEvent(store_id, {
      type: 'ticket.delivered',
      ticket: full.ticket,
      ts: Date.now(),
    });
    try {
      await this.kdsSessionsService.attributeOpenSessionToTicketConsumption(ticketId);
    } catch (err) {
      this.logger.error(
        `QUI-760: failed to attribute ticket ${ticketId} consumption to KDS session`,
        err as Error,
      );
    }

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

    // Ver `startPreparation` — station-lock guard uniforme.
    await this.kdsSessionsService.assertCanMutateStationTicket(ticket.kds_id);

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
    // QUI-760 — imputa las inventory_transactions del ticket a la sesión
    // abierta de la KDS. El insumo YA se gastó al cocinar: cancelar el
    // ticket no lo devuelve al stock (la acción no distingue «no se llegó
    // a preparar» de «se cocinó y se canceló»), y la merma queda cargada
    // al turno que la produjo. Coherente con la regla "atribución es de
    // quien cocina". Mismo patrón push-primero-try-catch-después que los
    // otros tres handlers: la difusión operativa no depende del helper.
    this.pushKitchenEvent(store_id, {
      type: 'ticket.cancelled',
      ticket: full.ticket,
      ts: Date.now(),
    });
    try {
      await this.kdsSessionsService.attributeOpenSessionToTicketConsumption(ticketId);
    } catch (err) {
      this.logger.error(
        `QUI-760: failed to attribute ticket ${ticketId} consumption to KDS session`,
        err as Error,
      );
    }
    return full.ticket;
  }

  /**
   * Transaction-local cancel of a kitchen ticket WITHOUT the SSE push.
   *
   * Mirrors the write body of `cancelTicket` (status flip on the ticket +
   * its non-delivered items) but takes the caller's `tx` so the mutation is
   * atomic with a larger operation (e.g. removing a fired item from a table
   * session), and does NOT open its own `$transaction` (which would nest)
   * nor emit any SSE (which must happen AFTER the outer commit). The caller
   * is responsible for calling `emitTicketCancelledEvent(ticketId)` once the
   * enclosing transaction commits.
   *
   * The caller MUST have already validated tenancy + the `pending` precondition
   * (this helper performs the raw writes only).
   *
   * QUI-760 — esta vía NO imputa consumo al cerrar la tx. La imputación
   * (`attributeOpenSessionToTicketConsumption`) hace su propio
   * `updateMany` con scope por tienda y no se puede meter adentro de una
   * tx ajena sin correr dos riesgos: contaminar la semántica de la tx
   * del llamador (un fallo de imputación podría hacer rollback de
   * cancelación que ya estaba decidida) y bloquear el commit de ese
   * flujo por un efecto contable. La imputación viaja con el SSE: el
   * `emitTicketCancelledEvent` post-commit ya invoca el helper además
   * del push. Si el caller invoca `cancelTicketInTx` y olvida el
   * `emitTicketCancelledEvent`, el ticket queda cancelado pero su
   * consumo NO se imputa — mismo hueco que ya existía para el SSE, la
   * imputación lo hereda. Documentado para que no parezca un olvido.
   */

  async cancelTicketInTx(
    tx: Prisma.TransactionClient,
    ticketId: number,
  ): Promise<void> {
    await tx.kitchen_tickets.update({
      where: { id: ticketId },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    await tx.kitchen_ticket_items.updateMany({
      where: { kitchen_ticket_id: ticketId, status: { not: 'delivered' } },
      data: { status: 'cancelled', updated_at: new Date() },
    });
  }

  /**
   * Post-commit SSE emitter for a ticket that was cancelled inside another
   * service's transaction via `cancelTicketInTx`. Re-reads the (now cancelled)
   * ticket in the current store context and pushes the canonical
   * `ticket.cancelled` KDS event. Best-effort: a failure is logged and never
   * bubbles up (the DB state is already committed).
   */
  async emitTicketCancelledEvent(ticketId: number): Promise<void> {
    try {
      const { ticket, store_id } = await this.getTicketForStore(ticketId);
      this.pushKitchenEvent(store_id, {
        type: 'ticket.cancelled',
        ticket,
        ts: Date.now(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to emit ticket.cancelled for ticket ${ticketId}: ${
          (err as Error).message
        }`,
      );
    }
    // QUI-760 — imputación post-commit, después de empujar el SSE (o de
    // intentar empujarlo). Mismo patrón que `cancelTicket` directo: el
    // insumo ya se gastó al cocinar y la merma queda cargada al turno.
    // Se intenta imputar incluso si el push falló arriba — la imputación
    // es independiente del SSE. Best-effort: si el helper tira, se
    // loguea y se continúa (el caller ya invocó este helper asumiendo
    // post-commit, no propagamos error).
    try {
      await this.kdsSessionsService.attributeOpenSessionToTicketConsumption(ticketId);
    } catch (err) {
      this.logger.warn(
        `QUI-760: failed to attribute cancelled ticket ${ticketId} consumption: ${
          (err as Error).message
        }`,
      );
    }
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

    // Ver `startPreparation` — station-lock guard uniforme.
    await this.kdsSessionsService.assertCanMutateStationTicket(ticket.kds_id);

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
  /**
   * Parte las lineas cuya exclusion aplica a MENOS unidades que su cantidad.
   * QUI-655.
   *
   * `quantity: 3` con la excepcion en 1 pasa a `quantity: 2` (receta completa) +
   * `quantity: 1` (con la exclusion). Devuelve los ids efectivos a firear y las
   * exclusiones REMAPEADAS a la linea nueva — la que lleva la excepcion es la
   * nueva, no la original, porque la original se queda con el resto homogeneo.
   *
   * Corre en su propia transaccion: la particion tiene que ser atomica (o se
   * parten las dos lineas o ninguna), pero NO debe compartir transaccion con el
   * consumo. Si el fire falla despues, la particion ya persistida sigue siendo
   * correcta: refleja lo que el cliente pidio, y reintentar el envio consume sobre
   * lineas ya homogeneas.
   *
   * Idempotencia: una linea ya partida llega con `quantity` igual a
   * `applies_to_units`, asi que la condicion no se cumple y no se vuelve a partir.
   */
  private async splitLinesForExclusions(dto: FireOrderItemsDto): Promise<{
    orderItemIds: number[];
    exclusions: Array<{ order_item_id: number; component_product_ids: number[] }>;
  }> {
    const exclusions = (dto.exclusions ?? []).map((e) => ({
      order_item_id: e.order_item_id,
      component_product_ids: e.component_product_ids ?? [],
      applies_to_units: e.applies_to_units,
    }));

    const partial = exclusions.filter(
      (e) => e.applies_to_units != null && e.component_product_ids.length > 0,
    );
    if (partial.length === 0) {
      return {
        orderItemIds: dto.order_item_ids,
        exclusions: exclusions.map((e) => ({
          order_item_id: e.order_item_id,
          component_product_ids: e.component_product_ids,
        })),
      };
    }

    const originals = await this.prisma.order_items.findMany({
      where: { id: { in: partial.map((e) => e.order_item_id) } },
    });
    // Tipo explicito: el Map inferido desde tuplas ensancha el valor a `{}` y todo
    // acceso a propiedades falla. Cuarta vez que aparece este patron en el repo.
    type OriginalItem = (typeof originals)[number];
    const byId = new Map<number, OriginalItem>(
      originals.map((o) => [o.id, o] as [number, OriginalItem]),
    );

    const resultIds = [...dto.order_item_ids];
    const remapped = new Map<number, number[]>();
    for (const e of exclusions) {
      remapped.set(e.order_item_id, e.component_product_ids);
    }

    await (this.prisma as any).$transaction(async (tx: Prisma.TransactionClient) => {
      for (const e of partial) {
        const original = byId.get(e.order_item_id);
        if (!original) continue;
        const units = Number(e.applies_to_units);
        const qty = Number(original.quantity);
        // Aplica a todas (o mas): no hay nada que partir, la linea ya es homogenea.
        if (!Number.isFinite(units) || units <= 0 || units >= qty) continue;

        const unitPrice = Number(original.unit_price);
        const remaining = qty - units;

        // La linea ORIGINAL se queda con el resto SIN exclusion, y la nueva lleva
        // la excepcion. Al reves obligaria a mover la exclusion capturada al pedir
        // y a reescribir la fila que el cliente ya vio en su cuenta.
        await tx.order_items.update({
          where: { id: original.id },
          data: {
            quantity: remaining,
            total_price: new Prisma.Decimal(unitPrice * remaining),
            updated_at: new Date(),
          },
        });

        const created = await tx.order_items.create({
          data: {
            order_id: original.order_id,
            product_id: original.product_id,
            product_variant_id: original.product_variant_id,
            product_name: original.product_name,
            quantity: units,
            unit_price: original.unit_price,
            total_price: new Prisma.Decimal(unitPrice * units),
            item_type: original.item_type,
            cost_price: original.cost_price,
            is_price_overridden: original.is_price_overridden,
            // La parte nueva NO hereda el consumo: es justamente la que todavia
            // no se cocino.
            inventory_consumed_at_fire: false,
            inventory_committed: false,
            is_takeaway: original.is_takeaway,
            notes: original.notes,
            skip_kds: original.skip_kds,
            // Puntero de agrupacion visual: la UI reagrupa las partes para que el
            // cliente siga viendo "3 pollos" y no dos filas sueltas.
            split_from_order_item_id:
              original.split_from_order_item_id ?? original.id,
            updated_at: new Date(),
          },
        });

        // La exclusion viaja a la linea NUEVA; la original queda completa.
        remapped.delete(original.id);
        remapped.set(created.id, e.component_product_ids);
        resultIds.push(created.id);
      }
    });

    return {
      orderItemIds: [...new Set(resultIds)],
      exclusions: [...remapped.entries()].map(([order_item_id, ids]) => ({
        order_item_id,
        component_product_ids: ids,
      })),
    };
  }

  // ------------------------------------------------------ A.6 variant helpers
  /**
   * CP-POLLO-ARABE-727 A.6 — ERR-15 en fire-time. La variante vendida se estampa
   * en `kitchen_ticket_items`, así que el fire DEBE garantizar que la variante
   * que declara `order_item.product_variant_id` pertenece realmente a
   * `order_item.product_id`. Si no, el ticket mostraría una especificación de
   * otro plato (ej. "Pollo" con la variante de una línea ajena) y el inventario
   * quedaría descuadrado — se falla fuerte antes de estampar una variante que no
   * corresponde. Las dos capas de ERR-15 no son redundantes: A.6 cubre el fire;
   * C.4 cubre los write-sites upstream (retail incluido).
   *
   * Invariante del dominio (ver `recipes.service.ts`): el yield puede tener
   * variantes, los componentes del BOM NO.
   */
  private assertVariantBelongsToProduct(
    item: {
      id: number;
      product_id: number | null;
      product_variant_id: number | null;
      product_variants?: { product_id: number } | null;
    },
  ): void {
    if (item.product_variant_id == null) return;
    const belongs = item.product_variants?.product_id === item.product_id;
    if (!belongs) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCT_VARIANT_MISMATCH,
        undefined,
        {
          order_item_id: item.id,
          product_id: item.product_id,
          product_variant_id: item.product_variant_id,
        },
      );
    }
  }

  /**
   * CP-POLLO-ARABE-727 A.6 — única señal del riesgo contable más grave del plan
   * ("inventario descuadrado"): un plato con variantes que llega al fire SIN
   * `product_variant_id`. El operador vendió la línea base (que
   * `enforceStockLevelsMode` borra), así que el consumo descontaría una fila que
   * ningún agregado lee. Se avisa con `logger.warn` (no se bloquea): la venta
   * puede ser legítima —por ejemplo una variante sin stock forzada a la base—
   * pero el operador debe poder rastrear que ocurrió.
   */
  private warnMissingVariantIdForProduct(
    item: {
      id: number;
      product_id: number | null;
      product_variant_id: number | null;
      products?: { _count?: { product_variants?: number } } | null;
    },
  ): void {
    if (item.product_variant_id != null) return;
    const variantCount = item.products?._count?.product_variants ?? 0;
    if (variantCount > 0) {
      this.logger.warn('variant_id missing for product with variants', {
        order_item_id: item.id,
        product_id: item.product_id,
      });
    }
  }

  /**
   * CP-POLLO-ARABE-727 A.6 — etiqueta snapshot de la variante que viaja al
   * ticket de cocina. Se toma del nombre de la variante (via el include de
   * `order_items → product_variants`); si no lo tiene, cae al snapshot persistido
   * `variant_attributes` y luego a `variant_sku`. Es INMUTABLE: se congela al
   * fire y no se re-etiqueta si `product_variants.name` cambia después (igual
   * que `order_items.product_name`). Devuelve `null` para producto sin variante.
   */
  private variantLabelFor(
    item: {
      product_variants?: { name: string | null } | null;
      variant_attributes?: string | null;
      variant_sku?: string | null;
    },
  ): string | null {
    return (
      item.product_variants?.name ??
      item.variant_attributes ??
      item.variant_sku ??
      null
    );
  }

}
