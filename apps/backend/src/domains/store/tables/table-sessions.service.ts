import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { TablesService } from './tables.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import { SessionsService } from '../cash-registers/sessions/sessions.service';
import { MovementsService } from '../cash-registers/movements/movements.service';
import { KitchenFireService } from '../kitchen-fire/kitchen-fire.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { OpenTableSessionDto, AddItemsToTableSessionDto } from './dto';

/**
 * Public shape returned by `openSession` and `findOne`.
 */
export interface TableSessionView {
  id: number;
  store_id: number;
  table_id: number;
  order_id: number;
  opened_by: number | null;
  opened_at: Date;
  closed_at: Date | null;
  guest_count: number | null;
  order?: {
    id: number;
    state: string;
    grand_total: Prisma.Decimal | number;
    subtotal_amount: Prisma.Decimal | number;
    tax_amount: Prisma.Decimal | number;
    discount_amount: Prisma.Decimal | number;
    // The order's customer (orders.customer_id is Int? nullable). The
    // Prisma relation is named `users`; we remap it to `customer` here so
    // the open-table consumer reads a stable field name.
    customer: {
      id: number;
      first_name: string;
      last_name: string;
    } | null;
    order_items: Array<{
      id: number;
      product_id: number | null;
      product_name: string;
      quantity: number;
      unit_price: Prisma.Decimal | number;
      total_price: Prisma.Decimal | number;
      inventory_consumed_at_fire: boolean;
      // Snapshot of `products.product_type` taken at order creation
      // (Restaurant Suite — see addItems at L311 and OrdersService
      // create at orders.service.ts:138-141). Drives the table-session
      // UI to know whether an order_item is a `prepared` dish (kitchen
      // flow) or a non-dish like bottled water (no kitchen control).
      item_type: string | null;
      // KDS state per dish (Restaurant Suite — Gap 2 pattern, mirrors
      // orders.service.findOne). Ordered desc by id so the most recent
      // ticket-item wins; empty for items never fired to the kitchen.
      kitchen_ticket_items: Array<{
        id: number;
        status: string;
        kitchen_ticket_id: number;
        kitchen_ticket: {
          id: number;
          status: string;
          daily_number: number | null;
          fired_at: Date;
        };
      }>;
    }>;
  };
  table?: {
    id: number;
    name: string;
    zone: string | null;
    status: string;
  };
}

/**
 * TableSessionsService
 *
 * Restaurant Suite — Fase E. Owns the "open check" lifecycle:
 *
 *   1. openSession(tableId, userId, guestCount)  → create draft order +
 *      table_session. The draft order is created via the existing
 *      `OrdersService.create` (state='draft'), so all of the retail
 *      order invariants (currency, audit log, etc.) keep working. The
 *      order is then bound to the session via `table_sessions.order_id`.
 *   2. addItems(sessionId, items)                → append items to the
 *      existing draft order. We do NOT use `OrdersService.updateOrderItems`
 *      because that path rejects orders in non-'created' states — the
 *      draft order is open and editable. We persist directly into
 *      `order_items` and re-derive the order's totals.
 *   3. closeSession(sessionId)                   → mark `closed_at`. The
 *      order is left in `draft` and is paid via the normal payments
 *      flow; closing the table does NOT complete the order.
 *
 * Atomicity: each multi-step operation runs in a single Prisma
 * transaction. Inventory consumption does NOT happen here — it is
 * driven by `KitchenFireService` (Fase D) when the operator hits
 * "Enviar a cocina".
 *
 * The "split" of an order into N sub-orders is owned by
 * `SplitOrderService` (same module). It is intentionally a separate
 * service because it crosses both `orders` and `table_sessions`
 * boundaries and has its own atomic transaction shape.
 */
@Injectable()
export class TableSessionsService {
  private readonly logger = new Logger(TableSessionsService.name);

  constructor(
    private prisma: StorePrismaService,
    private tablesService: TablesService,
    private settingsService: SettingsService,
    private readonly notificationsService: NotificationsService,
    private readonly notificationsSseService: NotificationsSseService,
    private readonly eventEmitter: EventEmitter2,
    // Cash-register services (from CashRegistersModule) — used to mirror the
    // POS arqueo behavior when a manual table payment is confirmed by staff.
    private readonly cashRegisterSessionsService: SessionsService,
    private readonly cashRegisterMovementsService: MovementsService,
    // Restaurant Suite — item removal (frente 2). KitchenFireService is used to
    // cancel a `pending` ticket in-tx + emit its SSE post-commit;
    // StockLevelManager reverses the fire's inventory consumption.
    private readonly kitchenFireService: KitchenFireService,
    private readonly stockLevelManager: StockLevelManager,
  ) {}

  // ------------------------------------------------------------------ helpers
  private requireContext(): {
    storeId: number;
    userId: number;
  } {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const userId = context?.user_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    if (!userId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return { storeId, userId };
  }

  /**
   * Variant of `requireContext` for anonymous (QR-initiated) flows.
   * Only requires a `store_id` in the request context — `user_id` is
   * optional because the actor is an unauthenticated diner scanning a
   * QR code at the table. Used by `openTableSessionPublic`.
   */
  private requireStoreContext(): { storeId: number } {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return { storeId };
  }

  /**
   * Shared atomic block for opening a table session. Both
   * `openSession` (POS, authenticated) and `openTableSessionPublic`
   * (QR, anonymous) delegate here so the draft-order + session +
   * table-status-flip invariants live in one place.
   *
   * Parameters are the only things that differ between the two entry
   * points:
   *   - `openedBy`     null for anonymous QR sessions, userId for POS.
   *   - `customerId`   null for anonymous, userId fallback for POS.
   *   - `channel`      'pos' for POS, 'ecommerce' for QR.
   *   - `deliveryType` 'direct_delivery' for POS, 'dine_in' for QR.
   */
  private async createOpenSession(args: {
    tableId: number;
    storeId: number;
    openedBy: number | null;
    customerId: number | null;
    channel: 'pos' | 'ecommerce';
    deliveryType: 'direct_delivery' | 'dine_in';
    guestCount: number | null;
    internalNotes: string;
  }): Promise<{ id: number; order_id: number; table_id: number }> {
    const currency = await this.settingsService.getStoreCurrency();
    const safeCurrency = currency || 'COP';

    const orderNumber = `T-${Date.now()}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.orders.create({
        data: {
          store_id: args.storeId,
          customer_id: args.customerId,
          order_number: orderNumber,
          state: 'draft',
          channel: args.channel,
          delivery_type: args.deliveryType,
          currency: safeCurrency,
          subtotal_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          discount_amount: 0,
          grand_total: 0,
          total_paid: 0,
          remaining_balance: 0,
          internal_notes: args.internalNotes,
          updated_at: new Date(),
        },
      });

      const newSession = await tx.table_sessions.create({
        data: {
          store_id: args.storeId,
          table_id: args.tableId,
          order_id: order.id,
          opened_by: args.openedBy,
          guest_count: args.guestCount,
          updated_at: new Date(),
        },
      });

      await tx.tables.update({
        where: { id: args.tableId },
        data: { status: 'occupied', updated_at: new Date() },
      });

      return {
        id: newSession.id,
        order_id: newSession.order_id,
        table_id: newSession.table_id,
      };
    });
  }

  // ---------------------------------------------------------------- open
  /**
   * Open a new table session. Creates a draft order (via a minimal
   * `orders.create`) and binds it to a fresh `table_sessions` row.
   *
   * The customer is optional: if not provided, we fall back to the
   * opening user themselves (which is the common pattern in POS —
   * the table's check is held by the server).
   */
  async openSession(dto: OpenTableSessionDto): Promise<TableSessionView> {
    const { storeId, userId } = this.requireContext();

    // 1. Verify table exists, is not already occupied.
    const table = await this.tablesService.getById(dto.table_id);
    if (table.status === 'occupied') {
      const existing = await this.tablesService.getActiveSession(
        dto.table_id,
      );
      if (existing) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_ALREADY_OPEN,
        );
      }
    }

    // 2. Resolve the customer. We accept an explicit customer_id; if
    //    absent, the draft order is opened as a true anonymous sale
    //    (`customer_id = null`, consumidor final) — we NEVER fall back to
    //    the opening user (that misattributed the check to the waiter/admin
    //    and violated the restaurant-ops "no id=1 sentinel" invariant).
    //
    //    Anonymous open is gated by the `pos.allow_anonymous_sales` setting
    //    (mirrors the POS cobro flow): if anonymous sales are disabled and
    //    no customer was provided, opening the table is a business error.
    if (dto.customer_id == null) {
      const settings = await this.settingsService.getSettings();
      if (settings.pos?.allow_anonymous_sales !== true) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_CUSTOMER_REQUIRED,
        );
      }
    }
    const customerId = dto.customer_id ?? null;

    // 3. ATOMIC: create order (empty items) + table_session + flip
    //    table status to 'occupied'. Delegates to the shared
    //    `createOpenSession` helper so the QR-anonymous variant reuses
    //    the exact same invariants.
    const session = await this.createOpenSession({
      tableId: dto.table_id,
      storeId,
      openedBy: userId,
      customerId,
      channel: 'pos',
      deliveryType: 'direct_delivery',
      guestCount: dto.guest_count ?? null,
      internalNotes: 'Mesa abierta — cuenta editable',
    });

    this.logger.log(
      `Table session opened: session=${session.id} table=${dto.table_id} order=${session.order_id} user=${userId}`,
    );

    return this.findOne(session.id);
  }

  /**
   * Open a table session for an anonymous diner scanning a QR code at
   * the table (Restaurant Suite — QR-por-mesa, Fase 7).
   *
   * Differences from `openSession`:
   *   - `user_id` is NOT required in the request context. Only `store_id`
   *     is needed (the store is encoded in the QR payload / route).
   *   - `opened_by` is null (no authenticated opener).
   *   - `customer_id` is null (anonymous check; a real customer can be
   *     attached later via `assignCustomer`).
   *   - The draft order is created with `channel: 'ecommerce'` and
   *     `delivery_type: 'dine_in'` so downstream reporting/filters can
   *     distinguish QR-initiated checks from POS-initiated ones.
   *   - Idempotent: if the table already has an active (non-closed)
   *     session, that session is returned as-is instead of throwing
   *     `TABLE_SESSION_ALREADY_OPEN`. This matches the diner mental
   *     model — scanning the same QR twice must not error.
   */
  async openTableSessionPublic(
    tableId: number,
    openedByUserId?: number | null,
    guestCount?: number | null,
  ): Promise<TableSessionView> {
    const { storeId } = this.requireStoreContext();

    // 1. Idempotency: if there is already an active session for this
    //    table, return it. A diner re-scanning the QR should never see
    //    an "already open" error — they should land on the live check.
    const existing = await this.tablesService.getActiveSession(tableId);
    if (existing) {
      return this.findOne(existing.id);
    }

    // 2. ATOMIC: create draft order (anonymous, ecommerce/dine_in) +
    //    table_session (opened_by null) + flip table to 'occupied'.
    //    `guestCount` is optional (GAP-10): the QR scan may not know the
    //    party size yet — the diner can set it later via `setGuestCount`.
    const session = await this.createOpenSession({
      tableId,
      storeId,
      openedBy: openedByUserId ?? null,
      customerId: null,
      channel: 'ecommerce',
      deliveryType: 'dine_in',
      guestCount: guestCount ?? null,
      internalNotes: 'Mesa abierta vía QR — cuenta anónima',
    });

    this.logger.log(
      `Public table session opened: session=${session.id} table=${tableId} order=${session.order_id}`,
    );

    return this.findOne(session.id);
  }

  // ---------------------------------------------------------- guest count
  /**
   * Set the party size on an open table session (Restaurant Suite —
   * QR-por-mesa, GAP-10).
   *
   * Anonymous-safe: uses `requireStoreContext()` (only `store_id`, no
   * `user_id`) so an unauthenticated QR diner can declare how many guests
   * are seated. Capacity validation (against `tables.capacity`) lives in
   * `EcommerceTablesService.setGuests` — here we only enforce the numeric
   * floor and the store-scoped write.
   *
   * The write goes through `updateMany` with an explicit `store_id`
   * filter (same tenant-guard pattern as `assignCustomer`) so a session
   * from another store can never be mutated even if the id is guessed.
   */
  async setGuestCount(
    sessionId: number,
    guestCount: number,
  ): Promise<TableSessionView> {
    const { storeId } = this.requireStoreContext();

    if (!Number.isInteger(guestCount) || guestCount < 1) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        'El número de comensales debe ser un entero mayor o igual a 1',
      );
    }

    // findOne is store-scoped (StorePrismaService): a session from another
    // store surfaces as TABLE_SESSION_NOT_FOUND before we ever write.
    const session = await this.findOne(sessionId);
    if (session.closed_at) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_CLOSED);
    }

    await this.prisma.table_sessions.updateMany({
      where: { id: sessionId, store_id: storeId },
      data: { guest_count: guestCount, updated_at: new Date() },
    });

    this.logger.log(
      `Table session guest_count set: session=${sessionId} guests=${guestCount}`,
    );

    return this.findOne(sessionId);
  }

  // ----------------------------------------------------------------- add
  /**
   * Append a batch of items to the draft order backing a table session.
   *
   * Validates the order is still in 'draft' state (cannot mutate a
   * paid/closed order) and re-derives `subtotal_amount` and
   * `grand_total` after appending the new lines. Inventory reservation
   * is intentionally NOT performed for `prepared` items — the consume
   * happens at fire-to-kitchen (Fase D).
   */
  async addItems(
    sessionId: number,
    dto: AddItemsToTableSessionDto,
  ): Promise<TableSessionView> {
    // requireStoreContext (not requireContext) so anonymous QR diners
    // (@OptionalAuth, no user_id) can self-order via EcommerceTablesService.
    // userId is not consumed in this method, and the POS controller path is
    // already gated by @Permissions('store:table_sessions:update') (auth).
    const { storeId } = this.requireStoreContext();

    const session = await this.findOne(sessionId);
    if (session.closed_at) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_CLOSED);
    }
    if (session.order?.state !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ORDER_NOT_DRAFT,
      );
    }
    if (!session.order) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_NOT_FOUND);
    }

    // 1. Resolve product details (name, unit_price, base_price).
    //    The product must be `is_sellable=true` to appear on the check.
    const productIds = Array.from(
      new Set(
        dto.items
          .map((i) => i.product_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );
    const products = await this.prisma.products.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        base_price: true,
        is_sellable: true,
        product_type: true,
        track_inventory: true,
      },
    });
    type ProductRow = (typeof products)[number];
    const productMap = new Map<number, ProductRow>(
      products.map((p: ProductRow) => [p.id, p]),
    );

    for (const item of dto.items) {
      const p = productMap.get(item.product_id);
      if (!p) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
          `Producto #${item.product_id} no existe o no pertenece a la tienda`,
        );
      }
      if (!p.is_sellable) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
          `Producto "${p.name}" no es vendible (is_sellable=false)`,
        );
      }
    }

    // 2. Persist lines + re-derive totals in a single transaction.
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        const product = productMap.get(item.product_id)!;
        const unitPrice = Number(product.base_price ?? 0);
        const totalPrice = unitPrice * item.quantity;

        await tx.order_items.create({
          data: {
            order_id: session.order_id,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            product_name: product.name,
            quantity: item.quantity,
            unit_price: new Prisma.Decimal(unitPrice),
            total_price: new Prisma.Decimal(totalPrice),
            item_type: product.product_type ?? 'physical',
            cost_price: null,
            is_price_overridden: false,
            inventory_consumed_at_fire: false,
            updated_at: new Date(),
          },
        });
      }

      // 3. Recompute order totals. The retail OrdersService stores
      //    grand_total = subtotal + tax - discount + shipping; for an
      //    open check we keep tax=0 (handled at fire or at pay) and
      //    discount=0 (applied at payment time). Shipping is N/A for
      //    dine-in.
      const allItems = await tx.order_items.findMany({
        where: { order_id: session.order_id },
        select: { total_price: true, tax_amount_item: true },
      });
      const subtotal = allItems.reduce(
        (acc, it) => acc + Number(it.total_price),
        0,
      );
      const tax = allItems.reduce(
        (acc, it) => acc + Number(it.tax_amount_item ?? 0),
        0,
      );

      await tx.orders.update({
        where: { id: session.order_id },
        data: {
          subtotal_amount: new Prisma.Decimal(subtotal),
          tax_amount: new Prisma.Decimal(tax),
          grand_total: new Prisma.Decimal(subtotal + tax),
          updated_at: new Date(),
        },
      });
    });

    this.logger.log(
      `Items appended: session=${sessionId} order=${session.order_id} lines=${dto.items.length}`,
    );
    return this.findOne(sessionId);
  }

  // -------------------------------------------------------------- remove
  /**
   * Remove a single item from the draft order backing an open table session
   * (Restaurant Suite — frente 2 "eliminar plato de la cuenta").
   *
   * Same gates as `addItems` (session open + order in `draft`). The item's
   * kitchen state decides the branch:
   *
   *   Tier 1 — NOT fired (`inventory_consumed_at_fire=false` AND no
   *     kitchen_ticket_item): plain delete + recompute. Inventory untouched.
   *
   *   Tier 2 — fired with its ticket in `pending`: cancel the KDS ticket
   *     (in-tx, SSE emitted post-commit) and REVERSE the stock consumed at
   *     fire, then delete + recompute. The reversal negates the recorded
   *     `inventory_transactions` of the fire (NOT a BOM re-explosion): those
   *     rows carry `order_item_id` + `product_id` + `quantity_change<0`; the
   *     location is re-resolved deterministically the same way the fire did
   *     (`getDefaultLocationForProduct`). The reversal `updateStock` call is a
   *     positive `return` movement and MUST NOT carry `order_item_id` (a child
   *     row with FK `onDelete: Restrict` would re-block the delete below).
   *
   *   Tier 3 — fired with its ticket in any non-`pending` status
   *     (`in_preparation` | `ready` | `delivered` | `cancelled`): blocked with
   *     `TABLE_SESSION_ITEM_NOT_REMOVABLE` (409).
   *
   * The accounting reversal of COGS is intentionally deferred (owner decision,
   * MVP): only stock is returned here.
   *
   * FK reality: `order_items` is the parent of `inventory_transactions`
   * (Restrict), `kitchen_ticket_items` (Restrict) and `order_item_taxes`
   * (Restrict), so those children are purged in-tx BEFORE the hard delete.
   *
   * Everything (cancel writes + reversal + child purge + delete + recompute)
   * runs in ONE `$transaction`; the `ticket.cancelled` SSE is emitted only
   * AFTER the commit.
   */
  async removeItem(
    sessionId: number,
    orderItemId: number,
  ): Promise<TableSessionView> {
    // Mirror addItems: only store context is required (the POS controller path
    // is already gated by @Permissions('store:table_sessions:update')).
    this.requireStoreContext();

    const session = await this.findOne(sessionId);
    if (session.closed_at) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_CLOSED);
    }
    if (!session.order) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_NOT_FOUND);
    }
    if (session.order.state !== 'draft') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ORDER_NOT_DRAFT,
      );
    }

    // Locate the item within the session's own draft order (this is also the
    // ownership guard — findOne is store-scoped).
    const orderItem = session.order.order_items.find(
      (it) => it.id === orderItemId,
    );
    if (!orderItem) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
        `El ítem #${orderItemId} no existe o no pertenece a esta sesión de mesa`,
      );
    }

    // Resolve the kitchen state. `kitchen_ticket_items` comes ordered desc by
    // id from findOne, so [0] is the most recent ticket-item for this line.
    const activeKti = orderItem.kitchen_ticket_items[0] ?? null;
    const ticketStatus = activeKti?.kitchen_ticket?.status ?? null;
    const ticketId = activeKti?.kitchen_ticket?.id ?? null;

    // "Fired" = the line was sent to the KDS at some point (flag flipped) OR it
    // currently has a kitchen_ticket_item. Non-fired lines are Tier 1.
    const wasFired =
      orderItem.inventory_consumed_at_fire === true || activeKti != null;
    const isPendingTicket = wasFired && ticketStatus === 'pending';

    // Removable only if: not fired (Tier 1) OR fired with a pending ticket
    // (Tier 2). Anything else (in_preparation/ready/delivered/cancelled) → 409.
    if (wasFired && !isPendingTicket) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Tier 2 — cancel the pending ticket + reverse the fire's stock.
      if (isPendingTicket && ticketId != null) {
        // TOCTOU guard: the kitchen may have advanced the ticket between the
        // findOne read and this transaction. Re-read + re-validate inside tx.
        const freshTicket = await tx.kitchen_tickets.findFirst({
          where: { id: ticketId },
          select: { status: true },
        });
        if (!freshTicket || freshTicket.status !== 'pending') {
          throw new VendixHttpException(
            ErrorCodes.TABLE_SESSION_ITEM_NOT_REMOVABLE,
          );
        }

        // Cancel the ticket rows in-tx (no SSE here — emitted post-commit).
        await this.kitchenFireService.cancelTicketInTx(tx, ticketId);

        // Reverse the leaf-ingredient consumption recorded at fire time.
        // inventory_movements has NO order_item_id; inventory_transactions
        // does. Idempotency: negative consumption txns only exist for
        // track_inventory ingredients — if there are none, there is nothing to
        // reverse (e.g. recipe-less / non-tracked ingredients).
        const consumptionTxns = await tx.inventory_transactions.findMany({
          where: { order_item_id: orderItemId, quantity_change: { lt: 0 } },
          select: {
            product_id: true,
            product_variant_id: true,
            quantity_change: true,
          },
        });
        for (const ct of consumptionTxns) {
          const locationId =
            await this.stockLevelManager.getDefaultLocationForProduct(
              ct.product_id,
              ct.product_variant_id ?? undefined,
            );
          await this.stockLevelManager.updateStock(
            {
              product_id: ct.product_id,
              variant_id: ct.product_variant_id ?? undefined,
              location_id: locationId,
              quantity_change: Math.abs(ct.quantity_change),
              movement_type: 'return',
              reason: 'Reversa fire — borrado de ítem de mesa',
              source_module: 'kitchen_fire_reversal',
              // NO order_item_id: the reversal must not create a child row that
              // re-blocks the order_item delete below (FK onDelete: Restrict).
              create_movement: true,
              validate_availability: false,
            },
            tx,
          );
        }
      }

      // Purge FK children (all onDelete: Restrict) BEFORE the hard delete, in
      // dependency order. Applies to every tier — even a non-fired line can
      // carry order_item_taxes (POS-created lines do).
      await tx.inventory_transactions.deleteMany({
        where: { order_item_id: orderItemId },
      });
      await tx.kitchen_ticket_items.deleteMany({
        where: { order_item_id: orderItemId },
      });
      await tx.order_item_taxes.deleteMany({
        where: { order_item_id: orderItemId },
      });

      await tx.order_items.delete({ where: { id: orderItemId } });

      // Recompute totals — EXACT mirror of addItems (subtotal = Σ total_price,
      // tax = Σ tax_amount_item, grand_total = subtotal + tax; no promo/coupon).
      const allItems = await tx.order_items.findMany({
        where: { order_id: session.order_id },
        select: { total_price: true, tax_amount_item: true },
      });
      const subtotal = allItems.reduce(
        (acc, it) => acc + Number(it.total_price),
        0,
      );
      const tax = allItems.reduce(
        (acc, it) => acc + Number(it.tax_amount_item ?? 0),
        0,
      );
      await tx.orders.update({
        where: { id: session.order_id },
        data: {
          subtotal_amount: new Prisma.Decimal(subtotal),
          tax_amount: new Prisma.Decimal(tax),
          grand_total: new Prisma.Decimal(subtotal + tax),
          updated_at: new Date(),
        },
      });
    });

    // Post-commit: emit the KDS `ticket.cancelled` SSE (Tier 2 only). Never
    // inside the tx — a rollback must not leave a phantom cancellation event.
    if (isPendingTicket && ticketId != null) {
      await this.kitchenFireService.emitTicketCancelledEvent(ticketId);
    }

    this.logger.log(
      `Table session item removed: session=${sessionId} order=${session.order_id} item=${orderItemId} tier=${
        isPendingTicket ? 'pending-reversal' : 'simple'
      }`,
    );
    return this.findOne(sessionId);
  }

  // --------------------------------------------------------------- close
  /**
   * Close a table session (mark `closed_at`). The order is left in
   * `draft` — it is paid via the normal payments flow (which can
   * happen with the session closed, e.g. someone pays the check after
   * stepping out of the restaurant). The table's `status` is set back
   * to 'cleaning' so the operator knows to reset it before the next
   * seating.
   */
  async closeSession(sessionId: number) {
    const session = await this.findOne(sessionId);
    if (session.closed_at) {
      // Idempotent — return the existing closed session.
      return session;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.table_sessions.update({
        where: { id: sessionId },
        data: { closed_at: new Date(), updated_at: new Date() },
      });
      await tx.tables.update({
        where: { id: session.table_id },
        data: { status: 'cleaning', updated_at: new Date() },
      });
    });

    // Notify staff + comensal streams of the close (ONLY on the real
    // transition — the idempotent short-circuit above already returned, so a
    // second close never re-emits). Post-commit: a rollback must not leave a
    // phantom `session_closed`.
    this.emitSessionClosed(session.store_id, sessionId);

    this.logger.log(
      `Table session closed: session=${sessionId} table=${session.table_id} order=${session.order_id}`,
    );
    return this.findOne(sessionId);
  }

  /**
   * Push the canonical `session_closed` SSE event on the per-store subject.
   * Consumed by both the staff dashboard stream (whitelisted in
   * `TableSessionsController`) and the comensal stream (whitelisted in
   * `EcommerceTablesController.DINER_LIFECYCLE_EVENTS`); each stream filters
   * by `data.table_session_id`. Best-effort — SSE failures must never break
   * the (already committed) close.
   *
   * Reused by the POS close-out path (`PaymentsService.processPosPayment`),
   * which closes the session directly inside its payment transaction and thus
   * cannot rely on `closeSession`'s own emit.
   */
  emitSessionClosed(storeId: number, sessionId: number): void {
    try {
      this.notificationsSseService.push(storeId, {
        id: 0,
        type: 'session_closed',
        title: 'Mesa cerrada',
        body: 'La cuenta de la mesa fue cerrada',
        data: { table_session_id: sessionId },
        created_at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Failed to push session_closed for session ${sessionId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  // ------------------------------------------------------ active sessions
  /**
   * Snapshot-friendly list of every OPEN (`closed_at IS NULL`)
   * table_session for the current store, resolved against the scoped
   * Prisma client. Used by the SSE staff stream to send a hydrated
   * initial payload so a freshly connected client doesn't render a
   * blank room map.
   *
   * Shape is intentionally compact (no `order_items` lines, no per-dish
   * KDS state) — the staff dashboard only needs the headline fields
   * to know which tables are currently occupied and by whom.
   * Per-session detail is fetched on demand via `findOne(id)`.
   */
  async listActiveSessions(): Promise<
    Array<{
      id: number;
      store_id: number;
      table_id: number;
      order_id: number;
      opened_at: Date;
      guest_count: number | null;
      table: {
        id: number;
        name: string;
        zone: string | null;
        status: string;
      } | null;
      order: {
        id: number;
        state: string;
        grand_total: Prisma.Decimal | number;
        customer: {
          id: number;
          first_name: string;
          last_name: string;
        } | null;
      };
    }>
  > {
    const { storeId } = this.requireStoreContext();
    return this.prisma.table_sessions.findMany({
      where: { store_id: storeId, closed_at: null },
      orderBy: { opened_at: 'asc' },
      select: {
        id: true,
        store_id: true,
        table_id: true,
        order_id: true,
        opened_at: true,
        guest_count: true,
        table: {
          select: {
            id: true,
            name: true,
            zone: true,
            status: true,
          },
        },
        order: {
          select: {
            id: true,
            state: true,
            grand_total: true,
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
      // The Prisma `users` relation on `orders.customer_id` is renamed
      // below to match the public `customer` field (same pattern as
      // `findOne`).
    }).then((rows) =>
      rows.map((r) => ({
        id: r.id,
        store_id: r.store_id,
        table_id: r.table_id,
        order_id: r.order_id,
        opened_at: r.opened_at,
        guest_count: r.guest_count,
        table: r.table
          ? {
              id: r.table.id,
              name: r.table.name,
              zone: r.table.zone,
              status: r.table.status,
            }
          : null,
        order: {
          id: r.order.id,
          state: r.order.state,
          grand_total: r.order.grand_total,
          customer: r.order.users
            ? {
                id: r.order.users.id,
                first_name: r.order.users.first_name,
                last_name: r.order.users.last_name,
              }
            : null,
        },
      })),
    );
  }

  // ---------------------------------------------------------------- read
  async findOne(id: number): Promise<TableSessionView> {
    const session = await this.prisma.table_sessions.findFirst({
      where: { id },
      include: {
        order: {
          select: {
            id: true,
            state: true,
            grand_total: true,
            subtotal_amount: true,
            tax_amount: true,
            discount_amount: true,
            // Customer of the draft order. orders.customer_id is Int?
            // nullable; the Prisma relation is `users`. We remap it to
            // `customer` below.
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              },
            },
            order_items: {
              orderBy: { id: 'asc' },
              select: {
                id: true,
                product_id: true,
                product_name: true,
                quantity: true,
                unit_price: true,
                total_price: true,
                inventory_consumed_at_fire: true,
                // Snapshot of product_type (see addItems at L311).
                // Read-only projection: lets the table-session UI hide
                // the kitchen controls for non-dish items.
                item_type: true,
                // KDS state per dish — same include shape as
                // orders.service.findOne (Gap 2). Ordered desc by id so
                // the most recent ticket-item leads the array.
                kitchen_ticket_items: {
                  orderBy: { id: 'desc' },
                  select: {
                    id: true,
                    status: true,
                    kitchen_ticket_id: true,
                    kitchen_ticket: {
                      select: {
                        id: true,
                        status: true,
                        daily_number: true,
                        fired_at: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        table: {
          select: {
            id: true,
            name: true,
            zone: true,
            status: true,
          },
        },
      },
    });
    if (!session) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_NOT_FOUND);
    }

    // Remap the Prisma `users` relation to `customer` so the consumer
    // reads a stable field name (orders' customer relation is `users`).
    const { order, ...rest } = session;
    return {
      ...rest,
      order: order
        ? {
            id: order.id,
            state: order.state,
            grand_total: order.grand_total,
            subtotal_amount: order.subtotal_amount,
            tax_amount: order.tax_amount,
            discount_amount: order.discount_amount,
            customer: order.users
              ? {
                  id: order.users.id,
                  first_name: order.users.first_name,
                  last_name: order.users.last_name,
                }
              : null,
            order_items: order.order_items.map((it) => ({
              id: it.id,
              product_id: it.product_id,
              product_name: it.product_name,
              quantity: it.quantity,
              unit_price: it.unit_price,
              total_price: it.total_price,
              inventory_consumed_at_fire: it.inventory_consumed_at_fire,
              item_type: it.item_type,
              kitchen_ticket_items: it.kitchen_ticket_items.map((kti) => ({
                id: kti.id,
                status: kti.status,
                kitchen_ticket_id: kti.kitchen_ticket_id,
                kitchen_ticket: {
                  id: kti.kitchen_ticket.id,
                  status: kti.kitchen_ticket.status,
                  daily_number: kti.kitchen_ticket.daily_number,
                  fired_at: kti.kitchen_ticket.fired_at,
                },
              })),
            })),
          }
        : undefined,
    };
  }

  // ------------------------------------------------------------ customer
  /**
   * Assign (or detach) the customer of the draft order backing an open
   * table session.
   *
   * Validation order mirrors `addItems`:
   *   1. tenant context (scoped service).
   *   2. session exists, belongs to the current store (findOne is scoped),
   *      and is OPEN (closed_at IS NULL).
   *   3. the customer exists (users.findUnique) when customerId != null.
   *
   * The mutation is a single `orders.customer_id` write on the linked
   * order. Passing `null` detaches the customer (anonymous check).
   */
  async assignCustomer(
    sessionId: number,
    customerId: number | null,
  ): Promise<TableSessionView> {
    const { storeId } = this.requireContext();

    // findOne is store-scoped (StorePrismaService), so a session from
    // another store surfaces as TABLE_SESSION_NOT_FOUND.
    const session = await this.findOne(sessionId);
    if (session.closed_at) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_CLOSED);
    }
    if (!session.order) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_NOT_FOUND);
    }

    // Validate the FK only when a customer is provided. Same pattern as
    // OrdersService.create — `users` getter is unscoped, so findUnique by
    // id is safe (no AND-wrap caveat).
    if (customerId != null) {
      const user = await this.prisma.users.findUnique({
        where: { id: customerId },
      });
      if (!user) {
        throw new VendixHttpException(ErrorCodes.CUST_FIND_001);
      }
    }

    // Tenant-guarded write: updateMany with the store filter so a cross
    // store order can never be mutated.
    await this.prisma.orders.updateMany({
      where: { id: session.order_id, store_id: storeId },
      data: { customer_id: customerId, updated_at: new Date() },
    });

    this.logger.log(
      `Table session customer ${
        customerId == null ? 'detached' : `set to ${customerId}`
      }: session=${sessionId} order=${session.order_id}`,
    );

    return this.findOne(sessionId);
  }

  // --------------------------------------------------- C3 — staff payments
  /**
   * List pending payments for the order backing a table session
   * (Restaurant Suite — table redesign C3).
   *
   * Returns every `payments` row where:
   *   - the row's `order_id` matches `session.order_id`, AND
   *   - `state = 'pending'`.
   *
   * Includes the method info (`store_payment_method.system_payment_method`)
   * so the POS UI can show "Efectivo $X" / "Transferencia $Y" badges
   * without a follow-up round-trip per row.
   *
   * Tenant-guard: `findOne(sessionId)` is store-scoped via
   * `StorePrismaService`, so a session id from another store surfaces as
   * `TABLE_SESSION_NOT_FOUND` before we touch the payments table.
   */
  async listPendingPayments(sessionId: number) {
    const session = await this.findOne(sessionId);

    const rows = await this.prisma.payments.findMany({
      where: {
        order_id: session.order_id,
        state: 'pending',
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      include: {
        store_payment_method: {
          include: {
            system_payment_method: {
              select: {
                id: true,
                type: true,
                display_name: true,
              },
            },
          },
        },
      },
    });

    return rows.map((p) => ({
      id: p.id,
      order_id: p.order_id,
      amount: p.amount,
      currency: p.currency,
      state: p.state,
      created_at: p.created_at,
      transaction_id: p.transaction_id,
      method: p.store_payment_method
        ? {
            store_payment_method_id: p.store_payment_method.id,
            type: p.store_payment_method.system_payment_method?.type ?? null,
            display_name:
              p.store_payment_method.system_payment_method?.display_name ??
              p.store_payment_method.display_name ??
              null,
          }
        : null,
    }));
  }

  /**
   * Staff-side confirmation of a pending table-session payment
   * (Restaurant Suite — table redesign C3).
   *
   * Validates:
   *   1. Session exists, belongs to the current store (findOne is scoped).
   *   2. Session is still OPEN (closed_at IS NULL). Closed sessions do not
   *      accept new payment transitions (the order can still be paid via
   *      the normal POS path).
   *   3. Payment belongs to the session's order AND is in state='pending'.
   *   4. Method is manual (`cash` / `bank_transfer` / `card`). Wompi /
   *      wallet payments are NEVER re-confirmed by staff — those are
   *      finalized by the gateway webhook (`webhook-handler.service.ts`)
   *      and the auto-entry listener (`AccountingEventsListener`).
   *
   * On success:
   *   - Updates the payment to `succeeded` + `paid_at` (CAS: no-op if the
   *     row is already in a final state — e.g. a webhook landed first).
   *   - Updates `orders.total_paid` / `remaining_balance` so the order
   *     reflects the new paid amount.
   *   - Emits `payment.received` with the canonical shape so the auto-entry
   *     listener + notification listener both fire identically to the POS
   *     fresh-sale path.
   *   - Pushes `payment.confirmed` on the per-store SSE subject (so the
   *     comensal UI updates the check live) and broadcasts a
   *     `table_payment_confirmed` notification (so the staff dashboard
   *     bell + sidebar refresh fire).
   *
   * The session REMAINS OPEN — staff can confirm one payment, then another,
   * until the full amount is covered. Session/table closure happens
   * separately (today via `applyPosPaymentToTableSession` when the last
   * payment drives the POS close-out, or via `closeSession`).
   */
  async confirmPayment(
    sessionId: number,
    paymentId: number,
  ): Promise<{ state: 'succeeded'; payment_id: number }> {
    const { storeId, userId } = this.requireContext();

    // 1. Tenant + open-session guards.
    const session = await this.findOne(sessionId);
    if (session.closed_at) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_CLOSED);
    }

    // 2. Resolve + authorize the payment row INSIDE the transaction so
    //    the CAS + balance update are atomic.
    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payments.findFirst({
        where: { id: paymentId, order_id: session.order_id },
        include: {
          store_payment_method: {
            include: { system_payment_method: true },
          },
          orders: {
            select: {
              id: true,
              order_number: true,
              store_id: true,
              subtotal_amount: true,
              tax_amount: true,
              discount_amount: true,
              tip_amount: true,
              customer_id: true,
              stores: { select: { organization_id: true } },
            },
          },
        },
      });

      if (!payment) {
        throw new VendixHttpException(
          ErrorCodes.PAY_FIND_001,
          `Pago #${paymentId} no encontrado o no pertenece a esta sesión de mesa`,
        );
      }
      if (payment.orders?.store_id !== storeId) {
        // Defense in depth — `findOne(sessionId)` is already store-scoped,
        // but re-check on the joined order to be safe.
        throw new VendixHttpException(
          ErrorCodes.STORE_CONTEXT_001,
          'La orden asociada pertenece a otra tienda',
        );
      }

      const methodType =
        payment.store_payment_method?.system_payment_method?.type ?? null;
      // 3. Manual-only gate. Wompi/webhook payments are finalized by the
      //    gateway; staff must not re-confirm them.
      const MANUAL_METHODS = new Set(['cash', 'bank_transfer', 'card']);
      if (!methodType || !MANUAL_METHODS.has(methodType)) {
        throw new VendixHttpException(
          ErrorCodes.PAY_METHOD_DISABLED_001,
          `El método de pago (${methodType ?? 'desconocido'}) no puede ser confirmado por staff. Use el webhook del procesador.`,
        );
      }

      // 4. CAS: skip the transition if the row is no longer pending.
      if (payment.state !== 'pending') {
        this.logger.log(
          `[confirmPayment] payment ${paymentId} state=${payment.state}; idempotent skip.`,
        );
        return { state: 'succeeded' as const, payment_id: payment.id, noop: true };
      }

      // 5. Transition + balance update.
      await tx.payments.update({
        where: { id: payment.id },
        data: {
          state: 'succeeded',
          paid_at: new Date(),
          updated_at: new Date(),
        },
      });

      const order = payment.orders;
      const orderTotalPaid = await this.bumpOrderBalanceInTx(
        tx,
        order.id,
        Number(payment.amount),
      );

      // 6. Emit canonical `payment.received`. Shape mirrors the POS fresh-sale
      //    emit (payments.service.ts L1179) so the auto-entry listener + the
      //    notification listener both process it identically.
      this.eventEmitter.emit('payment.received', {
        payment_id: payment.id,
        store_id: storeId,
        organization_id: order?.stores?.organization_id,
        order_id: order?.id,
        order_number: order?.order_number,
        amount: Number(payment.amount),
        subtotal_amount: Number(order?.subtotal_amount || 0),
        tax_amount: Number(order?.tax_amount || 0),
        tax_breakdown: [],
        withholding_breakdown: [],
        discount_amount: Number(order?.discount_amount || 0),
        tip_amount: Number(order?.tip_amount || 0),
        currency: payment.currency || 'COP',
        payment_method:
          payment.store_payment_method?.system_payment_method?.display_name ||
          payment.store_payment_method?.display_name ||
          'Unknown',
        user_id: userId,
        customer: order?.customer_id
          ? { id: Number(order.customer_id) }
          : undefined,
      });

      return {
        state: 'succeeded' as const,
        payment_id: payment.id,
        noop: false,
        orderNumber: order?.order_number ?? '',
        orderId: order.id,
        amount: Number(payment.amount),
        methodType,
        newTotalPaid: orderTotalPaid,
      };
    });

    // 7. Post-commit side effects — fire-and-await because the SSE push
    //    + notification broadcast are the only consumer-facing signal that
    //    the confirmation happened. They are safe to retry on idempotent
    //    state (`table_payment_confirmed` dedup is up to the consumer).
    if (!result.noop) {
      // 7a. SSE push — `payment.confirmed` so the comensal UI updates the
      //     live check (the `payments.pending` row disappears). Goes through
      //     the per-store subject — `TableSessionsController.stream` whitelists
      //     this type.
      this.notificationsSseService.push(storeId, {
        id: 0,
        type: 'payment.confirmed',
        title: 'Pago confirmado',
        body: `Pago #${result.payment_id} confirmado`,
        data: {
          table_session_id: sessionId,
          payment_id: result.payment_id,
          amount: result.newTotalPaid,
          method: result.methodType,
          order_number: result.orderNumber,
        },
        created_at: new Date().toISOString(),
      });

      // 7b. Notification row + web push + SSE for the staff dashboard.
      await this.notificationsService.createAndBroadcast(
        storeId,
        'table_payment_confirmed',
        'Pago confirmado',
        `Pago de mesa #${sessionId} confirmado por staff`,
        {
          route: `/admin/restaurant-ops/tables/session/${sessionId}`,
          table_session_id: sessionId,
          payment_id: result.payment_id,
          method: result.methodType,
        },
      );

      // 7c. Cash-register movement (staff arqueo). Mirror of the POS
      //     `PaymentsService.recordCashRegisterMovement`: only if the staff
      //     user has an OPEN cash session and the settings gate allows it.
      //     Runs ONLY on a real transition (guarded by `!result.noop`), so a
      //     webhook/idempotent re-confirm never double-counts the arqueo. A
      //     missing session or disabled gate is a SILENT skip — it must NEVER
      //     block the already-committed payment confirmation.
      await this.recordStaffCashMovement({
        storeId,
        userId,
        orderId: result.orderId,
        paymentId: result.payment_id,
        amount: result.amount,
        paymentMethod: result.methodType,
      });

      this.logger.log(
        `[confirmPayment] payment ${result.payment_id} confirmed by staff ${userId} on session ${sessionId}`,
      );
    }

    return { state: 'succeeded', payment_id: result.payment_id };
  }

  /**
   * Register a `sale` movement in `cash_register_movements` when a manual
   * table payment is confirmed by staff — the exact mirror of the POS
   * `PaymentsService.recordCashRegisterMovement`. Without this, the staff
   * cash count (arqueo) stays at 0 while accounting already booked the
   * cash-in (DR 1105 via the `payment.received` event), breaking the
   * cash-register ↔ ledger reconciliation.
   *
   * Business rule (mirror of the POS `processPosPayment` path): record ONLY if
   *   1. `pos.cash_register.enabled` is on, AND
   *   2. the confirming staff user has an OPEN cash session, AND
   *   3. for non-cash methods, `track_non_cash_payments` is on.
   * Any miss is a SILENT skip. This helper never throws and never blocks the
   * already-committed payment confirmation (called after the COMMIT and only
   * on a real transition, i.e. `!result.noop`).
   */
  private async recordStaffCashMovement(args: {
    storeId: number;
    userId: number;
    orderId: number;
    paymentId: number;
    amount: number;
    paymentMethod: string;
  }): Promise<void> {
    const { storeId, userId, orderId, paymentId, amount, paymentMethod } = args;
    try {
      if (amount <= 0) return;

      // 1. Feature gate — same key the POS reads.
      const settings = await this.settingsService.getSettings();
      const crSettings = settings.pos?.cash_register;
      if (!crSettings?.enabled) return;

      // 2. Open cash session for THIS staff user (store-scoped via context).
      const session = await this.cashRegisterSessionsService.getActiveSession(
        userId,
      );
      if (!session) return;

      // 3. Non-cash gate — skip unless the store tracks non-cash movements.
      if (paymentMethod !== 'cash' && !crSettings.track_non_cash_payments) {
        return;
      }

      await this.cashRegisterMovementsService.recordSaleMovement(session.id, {
        store_id: storeId,
        user_id: userId,
        amount,
        payment_method: paymentMethod,
        order_id: orderId,
        payment_id: paymentId,
      });

      this.logger.log(
        `[confirmPayment] cash-register sale movement recorded for session ${session.id}, order ${orderId}, payment ${paymentId}`,
      );
    } catch (error) {
      // Never let a cash-register failure surface to the confirmation — the
      // payment is already committed. Log and move on (mirror of the POS).
      this.logger.error(
        `[confirmPayment] error recording cash-register movement for order ${orderId}, payment ${paymentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * GAP-2-equivalent balance bump — re-reads `grand_total` and `total_paid`
   * INSIDE the transaction (so we see the latest values) and writes
   * `total_paid += payment.amount` / `remaining_balance = max(0, ...)` on
   * the order. Returns the NEW total_paid so callers (e.g. SSE push) can
   * surface the running sum without a follow-up read.
   */
  private async bumpOrderBalanceInTx(
    tx: Prisma.TransactionClient,
    orderId: number,
    paidAmount: number,
  ): Promise<number> {
    const order = await tx.orders.findUnique({
      where: { id: orderId },
      select: { grand_total: true, total_paid: true },
    });
    if (!order) return 0;
    const grandTotal = Number(order.grand_total || 0);
    const newTotalPaid = Number(order.total_paid || 0) + Number(paidAmount || 0);
    const remainingBalance = Math.max(grandTotal - newTotalPaid, 0);
    await tx.orders.update({
      where: { id: orderId },
      data: {
        total_paid: Math.round(newTotalPaid * 100) / 100,
        remaining_balance: Math.round(remainingBalance * 100) / 100,
        updated_at: new Date(),
      },
    });
    return Math.round(newTotalPaid * 100) / 100;
  }
}
