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
    type PreparedItemContext = {
      orderItem: (typeof order.order_items)[number];
      recipeId: number;
      bomLines: BomExplosionLine[];
    };
    const preparedItems: PreparedItemContext[] = [];
    for (const itemId of firedItemIds) {
      const item = order.order_items.find((oi) => oi.id === itemId)!;
      const recipe = await this.prisma.recipes.findFirst({
        where: { product_id: item.product_id!, is_active: true },
        select: { id: true, product_id: true, is_active: true },
      });
      if (!recipe) {
        throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_NO_RECIPE);
      }
      if (!recipe.is_active) {
        throw new VendixHttpException(ErrorCodes.KITCHEN_FIRE_RECIPE_INACTIVE);
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

    // 4. ATOMIC TRANSACTION — for each item: per-leaf stock consumption +
    //    flag flip. Then create the kitchen_ticket + items.
    const result = await this.prisma.$transaction(async (tx) => {
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
          if (!Number.isFinite(consumedQty) || consumedQty <= 0) continue;

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

      // Create the kitchen_ticket + items (one ticket per fire call, one
      // item per fired order_item). Status defaults to 'pending'; Fase F
      // owns the KDS SSE controller that mutates these later.
      const ticket = await tx.kitchen_tickets.create({
        data: {
          store_id,
          order_id: order.id,
          status: 'pending',
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
    });

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
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: {
              product: {
                select: { id: true, name: true, sku: true, stock_unit: true },
              },
            },
          },
        },
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
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            product: {
              select: { id: true, name: true, sku: true, stock_unit: true },
            },
          },
        },
      },
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
   */
  async startPreparation(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled' || ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_INVALID_STATE,
        undefined,
        {
          from: ticket.status,
          to: 'in_preparation',
          hint: 'Un ticket cancelado o entregado no puede iniciarse.',
        },
      );
    }
    if (ticket.status === 'ready') {
      // Idempotent — already past this state.
      return ticket;
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
   */
  async markReady(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled' || ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_INVALID_STATE,
        undefined,
        {
          from: ticket.status,
          to: 'ready',
          hint: 'Un ticket cancelado o entregado no puede marcarse como listo.',
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
   * ready → delivered. Marks the order-side flow that the kitchen handoff
   * is complete. Items are NOT marked `inventory_consumed_at_fire` here
   * (that flag is flipped in fireOrderItems).
   */
  async markDelivered(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled' || ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_INVALID_STATE,
        undefined,
        {
          from: ticket.status,
          to: 'delivered',
          hint: 'El ticket ya está en estado terminal.',
        },
      );
    }
    if (ticket.status !== 'ready' && ticket.status !== 'in_preparation') {
      // Allow ready → delivered. For in_preparation, force a ready first.
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_INVALID_STATE,
        undefined,
        {
          from: ticket.status,
          to: 'delivered',
          hint: 'El ticket debe estar listo (ready) o en preparación para entregarse.',
        },
      );
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
    return full.ticket;
  }

  /**
   * pending | in_preparation | ready → cancelled. Irreversible from the
   * KDS (the order-side flow would have to re-fire to bring it back).
   */
  async cancelTicket(ticketId: number) {
    const { ticket, store_id } = await this.getTicketForStore(ticketId);

    if (ticket.status === 'cancelled' || ticket.status === 'delivered') {
      throw new VendixHttpException(
        ErrorCodes.KITCHEN_TICKET_INVALID_STATE,
        undefined,
        {
          from: ticket.status,
          to: 'cancelled',
          hint: 'El ticket ya está en estado terminal.',
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

  // ---------------------------------------------------------------- snapshot
  /**
   * Snapshot of all tickets relevant to the KDS board. Returns:
   *  - All non-terminal tickets (pending / in_preparation / ready) whose
   *    fired_at is within the window.
   *  - Plus recent (last 60min) delivered + cancelled tickets so the
   *    "Delivered" column can show what just left the kitchen.
   *
   * Used by both the explicit REST endpoint and the SSE warm-up.
   */
  async getActiveTicketsSnapshot(
    windowMinutes: number = 120,
  ): Promise<{ data: any[]; total: number; server_ts: number }> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowMinutes * 60_000);

    const data = await this.prisma.kitchen_tickets.findMany({
      where: {
        store_id,
        fired_at: { gte: cutoff },
      },
      orderBy: { fired_at: 'asc' },
      include: {
        items: {
          orderBy: { id: 'asc' },
          include: {
            product: {
              select: { id: true, name: true, sku: true, stock_unit: true },
            },
          },
        },
      },
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
        include: {
          items: {
            orderBy: { id: 'asc' },
            include: {
              product: {
                select: { id: true, name: true, sku: true, stock_unit: true },
              },
            },
          },
        },
      }),
      this.prisma.kitchen_tickets.count({ where }),
    ]);

    return { data, total };
  }
}
