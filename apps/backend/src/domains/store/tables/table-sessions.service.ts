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
  opened_by: number;
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

    // 3. Resolve currency via the shared SettingsService. The
    //    `store_settings` table does not have a top-level `currency`
    //    column — it lives inside the `settings` JSON blob under
    //    `general.currency`. Falling back to 'COP' to match the rest
    //    of the project.
    const currency = await this.settingsService.getStoreCurrency();
    const safeCurrency = currency || 'COP';

    // 4. Generate an order number. We use the same numeric pattern
    //    as `OrdersService.generateOrderNumber` (T- + ts) to avoid
    //    colliding with retail orders. Avoid reusing `generateOrderNumber`
    //    to keep the table-session flow independent of the retail
    //    order_number sequence.
    const orderNumber = `T-${Date.now()}-${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, '0')}`;

    // 5. ATOMIC: create order (empty items) + table_session + flip
    //    table status to 'occupied'.
    const session = await this.prisma.$transaction(async (tx) => {
      const order = await tx.orders.create({
        data: {
          store_id: storeId,
          customer_id: customerId,
          order_number: orderNumber,
          state: 'draft',
          channel: 'pos',
          delivery_type: 'direct_delivery',
          currency: safeCurrency,
          subtotal_amount: 0,
          tax_amount: 0,
          shipping_cost: 0,
          discount_amount: 0,
          grand_total: 0,
          total_paid: 0,
          remaining_balance: 0,
          internal_notes: 'Mesa abierta — cuenta editable',
          updated_at: new Date(),
        },
      });

      const newSession = await tx.table_sessions.create({
        data: {
          store_id: storeId,
          table_id: dto.table_id,
          order_id: order.id,
          opened_by: userId,
          guest_count: dto.guest_count ?? null,
          updated_at: new Date(),
        },
      });

      await tx.tables.update({
        where: { id: dto.table_id },
        data: { status: 'occupied', updated_at: new Date() },
      });

      return newSession;
    });

    this.logger.log(
      `Table session opened: session=${session.id} table=${dto.table_id} order=${session.order_id} user=${userId}`,
    );

    return this.findOne(session.id);
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
    const { storeId } = this.requireContext();

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
