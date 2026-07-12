import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { TablesService } from './tables.service';
import { SettingsService } from '../settings/settings.service';
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
    //    absent, we use the opening user as a placeholder so the draft
    //    order has a valid FK to `users`. A real customer can be set
    //    later via the normal order update path.
    const customerId = dto.customer_id ?? userId;

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

    this.logger.log(
      `Table session closed: session=${sessionId} table=${session.table_id} order=${session.order_id}`,
    );
    return this.findOne(sessionId);
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
}
