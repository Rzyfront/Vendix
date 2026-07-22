import {
  Inject,
  Injectable,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { REDIS_CLIENT } from '@common/redis/redis.module';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { TablesService } from '../../store/tables/tables.service';
import { TableSessionsService } from '../../store/tables/table-sessions.service';
import { SettingsService } from '../../store/settings/settings.service';
import { CustomersService } from '../../store/customers/customers.service';
import { KitchenFireService } from '../../store/kitchen-fire/kitchen-fire.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';
import { NotificationsSseService } from '../../store/notifications/notifications-sse.service';
import { NotificationsService } from '../../store/notifications/notifications.service';
import { StorePaymentMethodsService } from '../../store/payments/services/store-payment-methods.service';
import { PaymentEncryptionService } from '../../store/payments/services/payment-encryption.service';
import { WompiClientFactory } from '../../store/payments/processors/wompi/wompi.factory';
import { WompiClient } from '../../store/payments/processors/wompi/wompi.client';
import { WompiEnvironment } from '../../store/payments/processors/wompi/wompi.types';
import { S3Service } from '@common/services/s3.service';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';
import { AddItemsToTableSessionDto } from '../../store/tables/dto';
import {
  CallWaiterDto,
  IdentifyTableDto,
  PayTableDto,
  RequestBillDto,
  RequestSplitDto,
} from './dto';

/**
 * QR-por-mesa scan behavior — mirrors the `restaurant.qr_scan_behavior`
 * setting (settings-schemas.dto.ts). Defaults to `menu_only` when the
 * block is absent so legacy stores are not surprised by an open tab.
 */
export type QrScanBehavior =
  | 'menu_only'
  | 'mark_occupied'
  | 'open_tab'
  | 'require_staff';

export interface ResolveByTokenResult {
  store_id: number;
  table: { id: number; name: string };
  behavior: QrScanBehavior;
  auto_fire: boolean;
  enable_table_checkout: boolean;
  session_id?: number;
  /**
   * Welcome-wizard gates (Step 4). Both are read from `pos.*` in the same
   * `store_settings` row `getQrSettings` already loads (single read), so the
   * storefront can offer/skip the anonymous option without a second request.
   */
  allow_anonymous: boolean;
  anonymous_default: boolean;
  /**
   * Identity currently attached to the table's active session (if any),
   * resolved SERVER-SIDE from `orders.customer_id`. `null` when the session
   * is anonymous or no session is open. The full `store_settings` object is
   * never exposed — only these derived flags.
   */
  customer: { id: number; name: string } | null;
}

/**
 * Result of the welcome-wizard identify endpoint (Step 3). `customer` is
 * `null` for the anonymous mode; `session_id` echoes the active session the
 * identity was attached to (null in pre-session modes where no tab exists
 * yet — the client persists the identity and re-sends it on `call-waiter`).
 */
export interface IdentifyTableResult {
  ok: true;
  customer: { id: number; name: string } | null;
  session_id: number | null;
}

export interface AddOrderItemsResult {
  session_id: number;
  order_id: number;
  added: number;
  fired: boolean;
}

export interface ConfirmStaffResult {
  session_id: number;
  order_id: number;
  opened_by: number;
}

export interface SetGuestsResult {
  session_id: number;
  guest_count: number;
}

export interface BillItemView {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  /**
   * Diner-facing thumbnail: the variant's denormalized image when the line
   * is a variant, else the product's primary image (lowest `sort_order`),
   * else `null`.
   *
   * Returned as a SIGNED S3 URL (24h) — matches the catalog/cart/account
   * contract (vendix-s3-storage). The DB stores raw S3 keys; signing happens
   * on read inside `getBill`. Already-signed (HTTP-with-query-string) values
   * are passed through untouched to avoid double-signing.
   */
  image_url: string | null;
}

export interface BillView {
  table: { id: number; name: string };
  session_id: number;
  order_id: number;
  items: BillItemView[];
  subtotal: number;
  grand_total: number;
  /** Sum of applied (succeeded) payments against this order. */
  total_paid: number;
  /** Outstanding amount the diner still owes (`grand_total − total_paid`). */
  balance_due: number;
  currency: string;
}

/**
 * Result for the diner-side pay endpoint. Mirrors the response shape of
 * `POST /ecommerce/checkout/prepare-wompi-payment` (so the storefront can
 * reuse its widget plumbing) but collapses manual methods to a flat
 * `{ payment_id, state }` payload — no Wompi widget data is needed for
 * `cash` / `bank_transfer`.
 */
export interface PayTableResult {
  payment_id: number;
  state: string;
  next?: 'wompi_widget';
  wompi_data?: {
    public_key: string;
    currency: string;
    amount_in_cents: number;
    reference: string;
    signature_integrity: string;
    redirect_url: string;
    acceptance_token: string;
    accept_personal_auth: string;
    customer_email: string;
  };
}

/**
 * Server-derived binding for the diner SSE stream. Always includes the
 * resolved `table_id` (from the `public_token`) so the stream filter can
 * receive `session_opened` events before a session is actually open —
 * otherwise the comensal in `menu_only` / `mark_occupied` / `require_staff`
 * modes would be deaf to the table transitioning into a tab they can join.
 *
 * `session_id` / `order_id` are nullable for the pre-session window; once a
 * session opens, the SSE handler can re-resolve the binding with all three
 * fields populated (typically the comensal reconnects after seeing
 * `session_opened`).
 *
 * All ids are derived SERVER-SIDE from the token — a diner can only ever
 * see KDS/bill events for their own table.
 */
export interface DinerStreamBinding {
  table_id: number;
  session_id: number | null;
  order_id: number | null;
}

/**
 * EcommerceTablesService
 *
 * QR-por-mesa — Pasos 6 + 8.
 *
 * Public-facing service that resolves a table by its `public_token` (the
 * value embedded in the QR URL) and orchestrates the configured scan
 * behavior (`restaurant.qr_scan_behavior`):
 *
 *   - `menu_only`     → no-op, returns context only.
 *   - `mark_occupied` → flips table status to 'occupied' (idempotent).
 *   - `open_tab`      → opens an anonymous table session (draft order +
 *                       table_session) via `TableSessionsService.openTableSessionPublic`.
 *   - `require_staff` → does NOT open a session; notifies store staff via
 *                       SSE so a mesero can confirm and open the tab.
 *
 * Step 8 adds `addOrderItems` (auto-pedido a la cuenta) and `confirmStaff`
 * (mesero confirms a `require_staff` scan).
 *
 * Tenant scope: every read/write relies on `StorePrismaService`
 * auto-scoping. The store_id is resolved from the request context
 * (populated by `DomainResolverMiddleware` from the ecommerce domain).
 */
@Injectable()
export class EcommerceTablesService {
  private readonly logger = new Logger(EcommerceTablesService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly tablesService: TablesService,
    private readonly tableSessionsService: TableSessionsService,
    private readonly settingsService: SettingsService,
    private readonly customersService: CustomersService,
    private readonly kitchenFireService: KitchenFireService,
    private readonly menuAvailabilityChecker: MenuAvailabilityCheckerService,
    private readonly sseService: NotificationsSseService,
    private readonly notificationsService: NotificationsService,
    private readonly storePaymentMethodsService: StorePaymentMethodsService,
    private readonly paymentEncryptionService: PaymentEncryptionService,
    private readonly wompiClientFactory: WompiClientFactory,
    private readonly s3Service: S3Service,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ------------------------------------------------------------- settings
  /**
   * Reads `restaurant.qr_scan_behavior`, `restaurant.qr_auto_fire` and
   * `restaurant.enable_table_checkout` from `store_settings.settings`
   * for the current store. Follows the same direct-read pattern as
   * `CheckoutService.getCheckoutSettings` (checkout.service.ts:250) —
   * avoids the heavy `getSettings()` path (which signs S3 URLs etc.) for
   * a lightweight settings-block read.
   */
  private async getQrSettings(): Promise<{
    behavior: QrScanBehavior;
    auto_fire: boolean;
    enable_table_checkout: boolean;
    allow_anonymous_sales: boolean;
    anonymous_sales_as_default: boolean;
  }> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const row = await this.prisma.store_settings.findUnique({
      where: { store_id },
      select: { settings: true },
    });
    const restaurant = (row?.settings as any)?.restaurant ?? {};
    // `pos.*` gates the welcome wizard's anonymous option (Step 3/4). Read
    // from the SAME settings row so resolve + identify stay single-read.
    const pos = (row?.settings as any)?.pos ?? {};

    return {
      behavior: (restaurant.qr_scan_behavior as QrScanBehavior) ?? 'menu_only',
      auto_fire: !!restaurant.qr_auto_fire,
      enable_table_checkout: !!restaurant.enable_table_checkout,
      allow_anonymous_sales: pos.allow_anonymous_sales === true,
      anonymous_sales_as_default: pos.anonymous_sales_as_default === true,
    };
  }

  // ---------------------------------------------------------- resolve token
  /**
   * Step 6 — Resolve a table by its `public_token` and execute the
   * configured QR scan behavior.
   *
   * The token is scoped to the current store (StorePrismaService
   * auto-scope), so a token from store A can never resolve a table
   * from store B.
   */
  async resolveByToken(token: string): Promise<ResolveByTokenResult> {
    if (!token || typeof token !== 'string') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_NOT_FOUND,
        'Token de mesa requerido',
      );
    }

    // store_id is echoed back so the diner's EventSource (which cannot send
    // an `x-store-id` header) can pass it as `?store_id=` on the /stream URL —
    // `DomainResolverMiddleware` reads `req.query.store_id`.
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true, status: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    const {
      behavior,
      auto_fire,
      enable_table_checkout,
      allow_anonymous_sales,
      anonymous_sales_as_default,
    } = await this.getQrSettings();

    let session_id: number | undefined;

    switch (behavior) {
      case 'menu_only':
        // No-op — the diner sees the digital menu only.
        break;

      case 'mark_occupied':
        // Idempotent: if the table is already 'occupied', the update
        // is a no-op (TablesService.update allows 'occupied' even with
        // an open session — see the state-transition guard).
        if (table.status !== 'occupied') {
          await this.tablesService.update(table.id, { status: 'occupied' });
        }
        break;

      case 'open_tab':
        // Open an anonymous table session (draft order + table_session).
        // Idempotent — re-scanning the QR returns the existing session.
        const session = await this.tableSessionsService.openTableSessionPublic(
          table.id,
        );
        session_id = session.id;
        break;

      case 'require_staff':
        // Do NOT open a session. Notify store staff via SSE so a mesero
        // can approach the table and confirm (POST /:token/confirm).
        // The QR `token` is forwarded so the bell payload includes
        // `public_token` (Step 4b, QR-mesa require_staff — POS approval
        // modal in Step 10 calls /confirm directly from the notif row).
        this.notifyStaffTableScan(table.id, table.name, token);
        break;

      default:
        // Unknown behavior — fall back to menu_only (safest).
        break;
    }

    // Step 4 — resolve the identity attached to the table's active session
    // (if any) so the welcome wizard can pre-fill / skip the identity step.
    // Works for every mode: `open_tab` just opened one; the others may still
    // have a POS-opened session. Derived SERVER-SIDE from `orders.customer_id`.
    let customer: { id: number; name: string } | null = null;
    const activeSession = await this.tablesService.getActiveSession(table.id);
    if (activeSession) {
      customer = await this.resolveOrderCustomer(activeSession.order_id);
    }

    return {
      store_id,
      table: { id: table.id, name: table.name },
      behavior,
      auto_fire,
      enable_table_checkout,
      allow_anonymous: allow_anonymous_sales,
      anonymous_default: anonymous_sales_as_default,
      customer,
      ...(session_id !== undefined && { session_id }),
    };
  }

  // ------------------------------------------------------------- identify
  /**
   * Step 3 — Welcome-wizard identity. A single `@OptionalAuth` endpoint that
   * centralizes the three diner identity modes:
   *
   *   - `anonymous`     → no identity is created. Only allowed when the store
   *                       enables `pos.allow_anonymous_sales`; otherwise the
   *                       SAME `TABLE_SESSION_CUSTOMER_REQUIRED` error that
   *                       `TableSessionsService.openSession` throws for a
   *                       disallowed anonymous open is reused (no new code).
   *   - `guest`         → resolves/creates a "cliente presentado" via
   *                       `CustomersService.resolveTableGuestCustomer`.
   *   - `authenticated` → attaches the logged-in customer (`req.user`).
   *
   * Session assignment happens ONLY when a tab is already open
   * (`open_tab` auto-opened it in `resolveByToken`, or a POS-opened session
   * exists). In `mark_occupied` / `require_staff` there is no session yet, so
   * the resolved identity is returned to the client to persist and re-attach
   * later (e.g. on `call-waiter`).
   */
  async identify(
    token: string,
    dto: IdentifyTableDto,
    userId?: number,
  ): Promise<IdentifyTableResult> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    if (!token || typeof token !== 'string') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_NOT_FOUND,
        'Token de mesa requerido',
      );
    }

    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    // May be null in the pre-session window (menu_only / mark_occupied /
    // require_staff before the mesero confirms). Assignment is a no-op then.
    const session = await this.tablesService.getActiveSession(table.id);

    switch (dto.mode) {
      case 'anonymous': {
        // Gate ONLY the explicit anonymous choice — reuse the exact
        // ErrorCode `openSession` throws for a disallowed anonymous open.
        const { allow_anonymous_sales } = await this.getQrSettings();
        if (allow_anonymous_sales !== true) {
          throw new VendixHttpException(
            ErrorCodes.TABLE_SESSION_CUSTOMER_REQUIRED,
          );
        }
        // No mutation — an already-open session simply stays anonymous.
        return { ok: true, customer: null, session_id: session?.id ?? null };
      }

      case 'guest': {
        if (!dto.guest?.first_name) {
          throw new VendixHttpException(
            ErrorCodes.SYS_VALIDATION_001,
            'El nombre del comensal es requerido para identificarse',
          );
        }
        const c = await this.customersService.resolveTableGuestCustomer(
          store_id,
          dto.guest,
        );
        if (session) {
          await this.tableSessionsService.assignCustomer(
            session.id,
            c.customer_id,
          );
        }
        return {
          ok: true,
          customer: { id: c.customer_id, name: c.name },
          session_id: session?.id ?? null,
        };
      }

      case 'authenticated': {
        if (!userId) {
          throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
        }
        const name = await this.resolveCustomerName(userId);
        if (session) {
          await this.tableSessionsService.assignCustomer(session.id, userId);
        }
        return {
          ok: true,
          customer: { id: userId, name },
          session_id: session?.id ?? null,
        };
      }

      default:
        // Unreachable — `mode` is enum-validated by the DTO.
        throw new VendixHttpException(
          ErrorCodes.SYS_VALIDATION_001,
          'Modo de identificación inválido',
        );
    }
  }

  // --------------------------------------------------- customer resolution
  /**
   * Resolve a diner's display name from `users` (scope-safe: the `users`
   * getter is unscoped, so a findFirst by id carries no AND-wrap caveat).
   * Returns an empty string when the user row is missing.
   */
  private async resolveCustomerName(userId: number): Promise<string> {
    const user = await this.prisma.users.findFirst({
      where: { id: userId },
      select: { first_name: true, last_name: true },
    });
    if (!user) return '';
    return [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  /**
   * Resolve the identity attached to an order (via `orders.customer_id`),
   * returning `{ id, name }` or `null` for an anonymous order. `orders` is
   * store-scoped (StorePrismaService), and the `order_id` always originates
   * from a store-scoped table + active-session lookup — so this stays
   * tenant-safe.
   */
  private async resolveOrderCustomer(
    orderId: number,
  ): Promise<{ id: number; name: string } | null> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { customer_id: true },
    });
    if (!order?.customer_id) return null;
    return {
      id: order.customer_id,
      name: await this.resolveCustomerName(order.customer_id),
    };
  }

  // --------------------------------------------------------- add order items
  /**
   * Step 8 — Append items to the draft order backing the table's active
   * session (auto-pedido a la cuenta).
   *
   * Gates:
   *   - Only `open_tab` and `require_staff` (after confirmation) modes
   *     allow self-ordering. `menu_only` and `mark_occupied` reject with
   *     409.
   *   - Items are validated as sellable + menu-availability-window
   *     compliant.
   *   - If `qr_auto_fire` is true and the store is a restaurant, the
   *     `prepared` items are fired to the kitchen immediately (same
   *     pattern as POS payment / split auto-fire).
   */
  async addOrderItems(
    token: string,
    dto: AddItemsToTableSessionDto,
  ): Promise<AddOrderItemsResult> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // 1. Resolve table by token.
    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    // 2. Gate by scan behavior — only open_tab / require_staff allow
    //    self-ordering.
    const { behavior, auto_fire } = await this.getQrSettings();
    if (behavior === 'menu_only' || behavior === 'mark_occupied') {
      throw new ConflictException(
        'Este modo de QR no permite pedidos directos a la cuenta. Solicita assistance al mesero.',
      );
    }

    // 3. Resolve the active session for the table.
    const activeSession = await this.tablesService.getActiveSession(
      table.id,
    );
    if (!activeSession) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_NOT_FOUND,
        'No hay una cuenta abierta para esta mesa',
      );
    }

    // 4. Validate items are sellable (delegated to TableSessionsService.addItems
    //    which checks is_sellable) + menu availability windows.
    const productIds = Array.from(
      new Set(
        dto.items
          .map((i) => i.product_id)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );
    if (productIds.length > 0) {
      const blocked = await this.menuAvailabilityChecker.getBlockedProductIds(
        store_id,
        productIds,
      );
      if (blocked.size > 0) {
        throw new VendixHttpException(
          ErrorCodes.TABLE_SESSION_ADD_ITEMS_INVALID,
          `Algunos productos no están disponibles en este momento (fuera de ventana de carta)`,
        );
      }
    }

    // 5. Append items to the draft order.
    const updated = await this.tableSessionsService.addItems(
      activeSession.id,
      dto,
    );

    const orderId = updated.order?.id ?? activeSession.order_id;
    const added = dto.items.length;

    // 5b. Post-commit SSE push — `item_added` for diner-side and staff-side
    //     listeners (ecommerce stream + /store/table-sessions/stream).
    //     The $transaction inside `addItems` has already committed by the
    //     time we get here, so the projected counts are stable.
    //     `store_id` is passed explicitly because the push executes
    //     synchronously and ALS is not relied on at this depth.
    const itemCount = updated.order?.order_items?.length ?? 0;
    const subtotal = Number(updated.order?.subtotal_amount ?? 0);
    this.sseService.push(store_id, {
      id: Date.now(),
      type: 'item_added',
      title: 'Items agregados a la cuenta',
      body: `Mesa ${table.name} — ${added} ítem(s) nuevo(s)`,
      data: {
        table_session_id: activeSession.id,
        item_count: itemCount,
        subtotal,
      },
      created_at: new Date().toISOString(),
    });

    // 6. Auto-fire to kitchen if configured.
    let fired = false;
    if (auto_fire) {
      fired = await this.tryAutoFire(store_id, orderId);
    }

    return {
      session_id: activeSession.id,
      order_id: orderId,
      added,
      fired,
    };
  }

  // ------------------------------------------------------ confirm by staff
  /**
   * Step 8 — Mesero confirms a `require_staff` QR scan. Opens a table
   * session with `opened_by = userId` (the authenticated mesero).
   * `openTableSessionPublic` accepts an optional `openedByUserId` so the
   * opener is set atomically inside the create-session `$transaction`.
   */
  async confirmStaff(token: string, userId: number): Promise<ConfirmStaffResult> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    // Open the session atomically with opened_by = mesero (require_staff
    // confirmation). openTableSessionPublic accepts an optional userId so
    // the session is created with the correct opener inside the same
    // $transaction — no post-open update needed.
    const session = await this.tableSessionsService.openTableSessionPublic(
      table.id,
      userId,
    );

    this.logger.log(
      `Staff confirmed QR table: session=${session.id} table=${table.id} opened_by=${userId}`,
    );

    return {
      session_id: session.id,
      order_id: session.order_id,
      opened_by: userId,
    };
  }

  // --------------------------------------------------- token → session
  /**
   * Resolve the current store + table + active session from a
   * `public_token`. THROWS `TABLE_SESSION_NOT_FOUND` when the table has
   * no open check — used by the diner write endpoints (set guests, call
   * waiter, request bill/split) which all require an open session.
   *
   * The table lookup is store-scoped (StorePrismaService), so a token
   * from store A can never resolve a table from store B.
   */
  private async resolveActiveSessionByToken(token: string): Promise<{
    store_id: number;
    table: { id: number; name: string; capacity: number | null };
    session: { id: number; order_id: number };
  }> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    if (!token || typeof token !== 'string') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_NOT_FOUND,
        'Token de mesa requerido',
      );
    }

    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true, capacity: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    const session = await this.tablesService.getActiveSession(table.id);
    if (!session) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_SESSION_NOT_FOUND,
        'No hay una cuenta abierta para esta mesa',
      );
    }

    return {
      store_id,
      table,
      session: { id: session.id, order_id: session.order_id },
    };
  }

  /**
   * Non-throwing variant used by the diner SSE stream (GAP-3). Always
   * returns a binding (never `null`) as long as the token resolves to a
   * table — even when no session is open yet. The returned `table_id`
   * lets the stream filter accept `session_opened` events for the comensal's
   * table before a tab exists; `session_id` / `order_id` are `null` in that
   * pre-session window and the comensal reconnects after seeing
   * `session_opened` to receive the post-session deltas.
   *
   * Returns `null` only when there is no store context or the token does
   * not resolve — those cases are hard connection denials.
   *
   * The returned ids are derived SERVER-SIDE from the token and used as
   * the default-deny filter key for live events.
   */
  async resolveDinerBinding(
    token: string,
  ): Promise<DinerStreamBinding | null> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id || !token || typeof token !== 'string') {
      return null;
    }
    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true },
    });
    if (!table) {
      return null;
    }
    const session = await this.tablesService.getActiveSession(table.id);
    if (!session) {
      // Pre-session binding — table_id is enough for `session_opened`
      // matching (comensal in menu_only/mark_occupied/require_staff
      // already attached to the stream).
      return { table_id: table.id, session_id: null, order_id: null };
    }
    return {
      table_id: table.id,
      session_id: session.id,
      order_id: session.order_id,
    };
  }

  // ------------------------------------------------------------- guests
  /**
   * GAP-10 — the diner declares the party size for the table's active
   * session. Validates against `tables.capacity` (when set) BEFORE
   * delegating the persistence to `TableSessionsService.setGuestCount`.
   */
  async setGuests(
    token: string,
    guestCount: number,
  ): Promise<SetGuestsResult> {
    const { store_id, table, session } =
      await this.resolveActiveSessionByToken(token);

    if (table.capacity != null && guestCount > table.capacity) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_GUEST_COUNT_EXCEEDS_CAPACITY,
        `La mesa "${table.name}" admite máximo ${table.capacity} comensales`,
      );
    }

    await this.tableSessionsService.setGuestCount(session.id, guestCount);

    // Post-commit SSE push — `guest_count_changed` for diner-side and
    // staff-side listeners. The `table_sessions.updateMany` inside
    // `setGuestCount` has already committed by the time we get here.
    // `store_id` is captured from the initial resolution (no ALS reliance
    // at this depth) and passed explicitly to `push()`.
    this.sseService.push(store_id, {
      id: Date.now(),
      type: 'guest_count_changed',
      title: 'Comensales actualizados',
      body: `Mesa ${table.name} — ${guestCount} comensal(es)`,
      data: {
        table_session_id: session.id,
        guest_count: guestCount,
      },
      created_at: new Date().toISOString(),
    });

    return { session_id: session.id, guest_count: guestCount };
  }

  // --------------------------------------------------------------- bill
  /**
   * GAP-5 (read) — the live check the diner sees. Projects the draft
   * order backing the table's active session to a diner-safe shape
   * (name + quantity + unit_price + total per line; no COGS, no cost
   * snapshot, no recipe). 404 `TABLE_SESSION_NOT_FOUND` when the table
   * has no open check.
   */
  async getBill(token: string): Promise<BillView> {
    const { table, session } = await this.resolveActiveSessionByToken(token);

    // Reuse the store-scoped session view for the projected items/totals.
    const view = await this.tableSessionsService.findOne(session.id);
    const order = view.order;

    // `findOne` intentionally omits currency; read it cheaply from the
    // scoped order row so the storefront can format money correctly, and
    // pull the denormalized balance columns while we're here.
    const orderRow = await this.prisma.orders.findFirst({
      where: { id: session.order_id },
      select: {
        currency: true,
        grand_total: true,
        total_paid: true,
        // `remaining_balance` exists on the order but is refreshed ONLY when
        // a payment is applied (bumpOrderBalanceInTx); for an unpaid draft
        // tab it stays 0 while items accumulate. We therefore derive the
        // live balance from `grand_total − total_paid` (the same formula
        // bumpOrderBalanceInTx uses) instead of reading it directly.
        remaining_balance: true,
      },
    });

    // Diner-safe line projection. `findOne` (the staff session view) does NOT
    // carry per-item images, and we must not enrich that shared view. Instead
    // read the order's lines directly with a lightweight, image-only include.
    // `this.prisma` (StorePrismaService) scopes `order_items` relationally via
    // `orders.store_id`, and the `order_id` was already resolved from a
    // store-scoped table + active-session lookup — so this stays tenant-safe.
    // No cost/COGS/recipe fields are selected (diner-safe).
    const lines = await this.prisma.order_items.findMany({
      where: { order_id: session.order_id },
      select: {
        product_name: true,
        quantity: true,
        unit_price: true,
        total_price: true,
        variant_image_url: true,
        products: {
          select: {
            product_images: {
              select: { image_url: true },
              orderBy: { sort_order: 'asc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });

    // BUG B — sign each line's `image_url` with the 24h presigner so the
    // storefront "Mi cuenta" panel renders thumbnails without 403s. Mirrors
    // cart/account/catalog (vendix-s3-storage contract: keys in DB, signed
    // on read). `signUrl` is itself defensive — it returns the value
    // untouched when it's already an absolute HTTP(S) URL, so we don't
    // double-sign anything that somehow already came in pre-signed.
    const items: BillItemView[] = await Promise.all(
      lines.map(async (it): Promise<BillItemView> => {
        const rawImageUrl =
          it.variant_image_url ??
          it.products?.product_images?.[0]?.image_url ??
          null;
        const signedImageUrl = rawImageUrl
          ? ((await this.s3Service.signUrl(rawImageUrl)) ?? null)
          : null;
        return {
          name: it.product_name,
          quantity: it.quantity,
          unit_price: Number(it.unit_price),
          total: Number(it.total_price),
          image_url: signedImageUrl,
        };
      }),
    );

    const grandTotal = Number(orderRow?.grand_total ?? order?.grand_total ?? 0);
    const totalPaid = Number(orderRow?.total_paid ?? 0);
    const balanceDue = Math.max(Math.round((grandTotal - totalPaid) * 100) / 100, 0);

    return {
      table: { id: table.id, name: table.name },
      session_id: session.id,
      order_id: session.order_id,
      items,
      subtotal: Number(order?.subtotal_amount ?? 0),
      grand_total: Number(order?.grand_total ?? 0),
      total_paid: totalPaid,
      balance_due: balanceDue,
      currency: orderRow?.currency ?? 'COP',
    };
  }

  // ------------------------------------------------------- call waiter
  /**
   * GAP-5 (write) — the diner requests attention. Persists + dispatches a
   * `table_call_waiter` notification (bell + SSE + web push) to the
   * waiters assigned to this table (Step 3, QR-mesa); falls back to a
   * store-wide broadcast when the table has no assigned waiters. No
   * table/order mutation.
   *
   * IMPORTANT — call-waiter is a PRE-session escalation. In `mark_occupied`
   * (and `require_staff`) the diner occupies/scans the table and summons a
   * mesero BEFORE any tab exists (precisely to have staff open it). It must
   * therefore NOT require an active session — doing so threw
   * TABLE_SESSION_NOT_FOUND and blocked the diner from calling the waiter on
   * a table they just occupied. We resolve the table by token directly and
   * only enrich the payload with session ids when a tab already exists
   * (`open_tab`). Unlike `requestBill`/`requestSplit`, which genuinely need an
   * open tab, calling a waiter is valid at any point once the table resolves.
   */
  async callWaiter(
    token: string,
    note?: string,
    customer?: { id?: number; name?: string },
  ): Promise<{ ok: true }> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    if (!token || typeof token !== 'string') {
      throw new VendixHttpException(
        ErrorCodes.TABLE_NOT_FOUND,
        'Token de mesa requerido',
      );
    }

    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    // May be null in the pre-session window (mark_occupied / require_staff).
    const session = await this.tablesService.getActiveSession(table.id);

    // Step 3 — identity for the staff notification. Prefer the identity
    // already attached to the active session (canonical); fall back to the
    // client hint for pre-session modes where no tab exists yet. When
    // neither is present the fields stay null (behaviour unchanged).
    let customerId: number | null = customer?.id ?? null;
    let customerName: string | null = customer?.name ?? null;
    if (session) {
      const sessionCustomer = await this.resolveOrderCustomer(
        session.order_id,
      );
      if (sessionCustomer) {
        customerId = sessionCustomer.id;
        customerName = sessionCustomer.name;
      }
    }

    await this.dispatchStaffNotification(
      store_id,
      table.id,
      'table_call_waiter',
      'Llamado de mesero',
      `Mesa ${table.name} solicita atención`,
      {
        table_id: table.id,
        table_name: table.name,
        table_session_id: session?.id ?? null,
        order_id: session?.order_id ?? null,
        note: note ?? null,
        customer_id: customerId,
        customer_name: customerName,
      },
      token,
    );

    this.logger.log(
      `QR call-waiter: table=${table.id} session=${session?.id ?? 'none'}`,
    );
    return { ok: true };
  }

  // ------------------------------------------------------- request bill
  /**
   * GAP-5 (write) — the diner requests the bill. Persists + dispatches a
   * `table_request_bill` staff notification (per waiter with broadcast
   * fallback — Step 3) AND pushes a lightweight `bill.requested` event
   * onto the per-store SSE subject so the diner's own stream (GAP-3)
   * reflects the request immediately. No mutation.
   */
  async requestBill(
    token: string,
    dto: RequestBillDto,
  ): Promise<{ ok: true }> {
    const { store_id, table, session } =
      await this.resolveActiveSessionByToken(token);

    const title = 'Solicitud de cuenta';
    const body = `Mesa ${table.name} solicita la cuenta`;

    await this.dispatchStaffNotification(
      store_id,
      table.id,
      'table_request_bill',
      title,
      body,
      {
        table_id: table.id,
        table_name: table.name,
        table_session_id: session.id,
        order_id: session.order_id,
        note: dto.note ?? null,
        payment_preference: dto.payment_preference ?? null,
      },
    );

    // Echo into the diner stream. The diner SSE filter (GAP-3) accepts
    // `bill.requested` events matched by `data.table_session_id`, so the
    // storefront banner flips to "cuenta solicitada" without a refetch.
    this.sseService.push(store_id, {
      id: Date.now(),
      type: 'bill.requested',
      title,
      body,
      data: {
        table_session_id: session.id,
        order_id: session.order_id,
      },
      created_at: new Date().toISOString(),
    });

    this.logger.log(
      `QR request-bill: table=${table.id} session=${session.id}`,
    );
    return { ok: true };
  }

  // ------------------------------------------------------ request split
  /**
   * GAP-8 (conservative) — the diner asks to split the bill. This does
   * NOT mutate anything and does NOT call `SplitOrderService`. It only
   * persists + dispatches a `table_request_split` staff notification
   * (per waiter with broadcast fallback — Step 3) so a mesero can
   * execute the real split from the staff panel.
   */
  async requestSplit(
    token: string,
    dto: RequestSplitDto,
  ): Promise<{ ok: true }> {
    const { store_id, table, session } =
      await this.resolveActiveSessionByToken(token);

    await this.dispatchStaffNotification(
      store_id,
      table.id,
      'table_request_split',
      'Solicitud de división de cuenta',
      `Mesa ${table.name} pide dividir en ${dto.n_splits}`,
      {
        table_id: table.id,
        table_name: table.name,
        table_session_id: session.id,
        order_id: session.order_id,
        n_splits: dto.n_splits,
        mode: dto.mode,
      },
    );

    this.logger.log(
      `QR request-split: table=${table.id} session=${session.id} n=${dto.n_splits} mode=${dto.mode}`,
    );
    return { ok: true };
  }

  // --------------------------------------------------------- table payment
  /**
   * Diner-side payment entry — registers the diner's intent to pay the
   * active session's bill via the chosen store payment method.
   *
   * Gate:
   *   - `restaurant.enable_table_checkout` MUST be true. When the flag
   *     is off (typical for stores that want a mesero to handle
   *     payment from the POS), the request is rejected with 409 +
   *     `TABLE_INVALID_STATUS` carrying a descriptive message.
   *
   * Method dispatch:
   *   - `cash` / `bank_transfer` → `payments` row with `state='pending'`
   *     (no cash register movement, no accounting entry, no session
   *     close). The staff notification carries the reference so the
   *     mesero can reconcile manually. Pushes `payment.pending` onto
   *     the per-store SSE subject so the diner's banner flips to
   *     "Pago pendiente" immediately.
   *   - `wompi` → `payments` row with `state='pending'` + the Wompi
   *     widget payload (`public_key`, integrity signature, acceptance
   *     tokens). The storefront renders the Wompi Widget just like the
   *     regular ecommerce checkout; the canonical confirm lands via
   *     the webhook (C4, out of scope), with the `/pay/confirm` route
   *     as a force-poll fallback.
   *
   * The session is **NEVER** closed by this path — closing is reserved
   * for the staff-driven `applyPosPaymentToTableSession` flow (C3).
   */
  async getTablePaymentMethods(token: string): Promise<
    Array<{
      id: number;
      type: string;
      name: string;
      icon?: string;
      requires_reference?: boolean;
    }>
  > {
    const { store_id } = await this.resolveActiveSessionByToken(token);

    // Reusa StorePaymentMethodsService.getEnabledForStore() — ya aplica
    // el filtro de store_payment_methods.enabled + las políticas de la org.
    // El controller del storefront recibe filas enmascaradas (custom_config
    // no se filtra aquí porque no lo necesita el comensal).
    const methods = await this.storePaymentMethodsService.getEnabledForStore();

    return methods
      .filter((m: any) =>
        ['cash', 'bank_transfer', 'wompi', 'wallet'].includes(m.system_payment_method?.type),
      )
      .map((m: any) => ({
        id: m.id,
        type: m.system_payment_method.type,
        name: m.display_name ?? m.system_payment_method.name,
        icon: m.system_payment_method.icon,
        requires_reference:
          m.system_payment_method.type === 'bank_transfer' ||
          m.system_payment_method.type === 'wompi',
      }));
  }

  async payTable(
    token: string,
    dto: PayTableDto,
    userId?: number,
  ): Promise<PayTableResult> {
    const { store_id, table, session } =
      await this.resolveActiveSessionByToken(token);

    // Gate — only stores that opted in to diner self-checkout expose
    // this endpoint. `enable_table_checkout` is a per-store switch in
    // `restaurant.*` (see settings-schemas.dto.ts).
    const { enable_table_checkout } = await this.getQrSettings();
    if (!enable_table_checkout) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_INVALID_STATUS,
        'El cobro desde la mesa está deshabilitado. Solicita al mesero que procese el pago.',
      );
    }

    // Resolve the chosen payment method. `findOne` already enforces
    // store-scope via StorePrismaService auto-filter.
    const storeMethod = await this.storePaymentMethodsService.findOne(
      dto.store_payment_method_id,
    );
    if (!storeMethod || storeMethod.state !== 'enabled') {
      throw new VendixHttpException(
        ErrorCodes.PAY_METHOD_DISABLED_001,
        'Método de pago no habilitado para esta tienda',
      );
    }
    const methodType: string =
      storeMethod.system_payment_method?.type ?? 'unknown';

    // Resolve the open order so we can default the amount when the
    // diner passes nothing (full bill pay) or accept a partial override.
    const order = await this.prisma.orders.findFirst({
      where: { id: session.order_id },
      select: {
        id: true,
        grand_total: true,
        total_paid: true,
        // Denormalized column; stale (0) for an unpaid draft tab — see the
        // balance derivation below. Selected for completeness/parity with
        // getBill; the live balance is computed from grand_total/total_paid.
        remaining_balance: true,
        currency: true,
      },
    });
    if (!order) {
      throw new VendixHttpException(ErrorCodes.TABLE_SESSION_NOT_FOUND);
    }

    // Outstanding balance = grand_total − succeeded payments (total_paid).
    // Derived instead of reading `remaining_balance` directly because that
    // column is only refreshed when a payment is applied (bumpOrderBalanceInTx)
    // and stays 0 for an unpaid draft tab while items accumulate. `total_paid`
    // counts succeeded payments only, so this is the true amount owed.
    const currencyCode = order.currency ?? 'COP';
    const balanceDue =
      Math.round(
        Math.max(Number(order.grand_total) - Number(order.total_paid), 0) * 100,
      ) / 100;

    // Default to the full outstanding balance when the diner does not pass
    // an explicit amount (full-bill pay). A client-supplied amount is
    // accepted only up to the outstanding balance (guarded below).
    const amount = dto.amount ?? balanceDue;

    // Anti-overpayment guard — reject with 4xx BEFORE creating any `payments`
    // row so the diner can never register more than what is owed. A one-cent
    // tolerance absorbs Decimal/float rounding noise on an exact-balance pay.
    if (balanceDue <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PAY_INVALID_AMOUNT_001,
        'La cuenta de la mesa ya está saldada; no hay saldo pendiente por pagar.',
        { balance_due: balanceDue, currency: currencyCode },
      );
    }
    if (amount <= 0) {
      throw new VendixHttpException(
        ErrorCodes.PAY_INVALID_AMOUNT_001,
        'El monto a pagar debe ser mayor a cero.',
        { amount, balance_due: balanceDue, currency: currencyCode },
      );
    }
    if (amount > balanceDue + 0.001) {
      throw new VendixHttpException(
        ErrorCodes.PAY_INVALID_AMOUNT_001,
        `El monto (${this.formatMoney(amount, currencyCode)}) supera el saldo pendiente de la cuenta (${this.formatMoney(balanceDue, currencyCode)}).`,
        { amount, balance_due: balanceDue, currency: currencyCode },
      );
    }

    // Manual methods (cash / bank_transfer) — insert a `pending`
    // payment row and ask the mesero to reconcile. We deliberately
    // do NOT close the session and do NOT touch cash registers /
    // accounting; the staff will reconcile in their own flow.
    if (methodType === 'cash' || methodType === 'bank_transfer') {
      const payment = await this.prisma.payments.create({
        data: {
          order_id: session.order_id,
          amount,
          currency: order.currency ?? 'COP',
          state: 'pending',
          store_payment_method_id: storeMethod.id,
          transaction_id: `${methodType}_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 11)}`,
          gateway_reference: dto.payment_reference ?? null,
          gateway_response: {
            table_session_id: session.id,
            table_id: table.id,
            method_type: methodType,
            diner_user_id: userId ?? null,
          },
        },
      });

      // Post-commit diner SSE — keeps the banner in sync without
      // forcing a refetch.
      this.sseService.push(store_id, {
        id: Date.now(),
        type: 'payment.pending',
        title: 'Pago pendiente',
        body: `Mesa ${table.name} — ${methodType}`,
        data: {
          table_session_id: session.id,
          payment_id: payment.id,
          amount,
          method: methodType,
          state: 'pending',
        },
        created_at: new Date().toISOString(),
      });

      // Staff notification — bell + SSE + web push so the mesero knows
      // to come reconcile.
      await this.notificationsService.createAndBroadcast(
        store_id,
        'table_payment_pending',
        'Pago pendiente de mesa',
        `Mesa ${table.name} — ${methodType} — ${this.formatMoney(amount)}`,
        {
          table_id: table.id,
          table_name: table.name,
          table_session_id: session.id,
          payment_id: payment.id,
          method_type: methodType,
          amount,
          payment_reference: dto.payment_reference ?? null,
        },
      );

      return { payment_id: payment.id, state: 'pending' };
    }

    // Wompi — prepare the widget payload by mirroring the
    // checkout.prepareWompiPayment contract locally (CheckoutService is
    // not directly available from this module — `EcommerceTablesModule`
    // doesn't import `CheckoutModule`).
    if (methodType === 'wompi') {
      const wompiMethod = await this.prisma.store_payment_methods.findFirst(
        {
          where: {
            id: storeMethod.id,
            state: 'enabled',
            system_payment_method: { type: 'wompi' },
          },
          include: { system_payment_method: true },
        },
      );
      if (!wompiMethod?.custom_config) {
        throw new VendixHttpException(
          ErrorCodes.PAY_METHOD_DISABLED_001,
          'Wompi no está configurado para esta tienda',
        );
      }
      const cfg = this.paymentEncryptionService.decryptConfig(
        wompiMethod.custom_config as Record<string, any>,
        'wompi',
      );
      const wompiConfig = {
        public_key: cfg.public_key,
        private_key: cfg.private_key,
        events_secret: cfg.events_secret || '',
        integrity_secret: cfg.integrity_secret || '',
        environment:
          (cfg.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
      };
      const client: WompiClient = this.wompiClientFactory.getClient(
        `store-${store_id}`,
        wompiConfig,
      );

      // Reuse reference if one was already issued for this order so
      // the Widget reuses the same pending transaction instead of
      // orphaning the previous one.
      const existingPayment = await this.prisma.payments.findFirst({
        where: { order_id: session.order_id },
        orderBy: { created_at: 'desc' },
      });
      let reference: string;
      let paymentId: number;
      if (existingPayment?.gateway_reference) {
        reference = existingPayment.gateway_reference;
        paymentId = existingPayment.id;
      } else {
        reference = `vendix_${store_id}_${session.order_id}_${Date.now()}`;
        const created = await this.prisma.payments.create({
          data: {
            order_id: session.order_id,
            amount,
            currency: order.currency ?? 'COP',
            state: 'pending',
            store_payment_method_id: wompiMethod.id,
            transaction_id: `wompi_${Date.now()}_${Math.random()
              .toString(36)
              .substring(2, 11)}`,
            gateway_reference: reference,
            gateway_response: {
              table_session_id: session.id,
              table_id: table.id,
              method_type: 'wompi',
              diner_user_id: userId ?? null,
            },
          },
        });
        paymentId = created.id;
      }

      const currency = order.currency ?? 'COP';
      const amountInCents = Math.round(amount * 100);
      const signature = client.generateIntegritySignature(
        reference,
        amountInCents,
        currency,
      );
      const tokens = await client.getAcceptanceTokens();

      return {
        payment_id: paymentId,
        state: 'pending',
        next: 'wompi_widget',
        wompi_data: {
          public_key: cfg.public_key,
          currency,
          amount_in_cents: amountInCents,
          reference,
          signature_integrity: signature,
          redirect_url: '',
          acceptance_token: tokens.acceptance_token,
          accept_personal_auth: tokens.personal_auth_token,
          customer_email: '',
        },
      };
    }

    // Anything else (card via Stripe / PayPal / wallet / …) is not
    // part of the v1 comensal surface — staff-only. Reject with a
    // descriptive 409 so the storefront can surface a friendly error
    // instead of timing out on the Widget.
    throw new VendixHttpException(
      ErrorCodes.PAY_METHOD_DISABLED_001,
      `Método de pago "${methodType}" no soportado en cobro de mesa`,
    );
  }

  /**
   * Force-confirms a Wompi payment registered via `payTable` by polling
   * the Wompi API for the transaction state. Mirrors
   * `CheckoutService.confirmWompiPayment` so the diner's return from
   * the widget sees a deterministic state immediately.
   *
   * Idempotent: if the payment is already terminal (succeeded / failed
   * / cancelled / refunded) it is returned as-is and no push is fired.
   * If Wompi doesn't know the reference yet (user closed the widget
   * before submitting) the payment row stays `pending` and we report
   * that — the canonical webhook (C4) is still responsible for the
   * terminal state transition.
   *
   * On terminal success, fires:
   *   - `payment.confirmed` onto the per-store SSE subject (diner
   *     filter, see `matchesDiner`).
   *   - `table_payment_confirmed` staff notification (bell + push).
   */
  async confirmWompiTablePayment(
    token: string,
    paymentId: number,
  ): Promise<{ state: string; order_state: string }> {
    const { store_id, table, session } =
      await this.resolveActiveSessionByToken(token);

    // Gate — same `enable_table_checkout` requirement.
    const { enable_table_checkout } = await this.getQrSettings();
    if (!enable_table_checkout) {
      throw new VendixHttpException(
        ErrorCodes.TABLE_INVALID_STATUS,
        'El cobro desde la mesa está deshabilitado',
      );
    }

    const payment = await this.prisma.payments.findFirst({
      where: { id: paymentId, order_id: session.order_id },
      include: {
        store_payment_method: {
          include: { system_payment_method: true },
        },
      },
    });
    if (!payment) {
      throw new VendixHttpException(
        ErrorCodes.PAY_FIND_001,
        'Pago no encontrado para esta mesa',
      );
    }
    if (
      payment.store_payment_method?.system_payment_method?.type !== 'wompi'
    ) {
      throw new VendixHttpException(
        ErrorCodes.PAY_INVALID_ORDER_001,
        'La orden no fue creada con Wompi',
      );
    }

    // Idempotency — terminal states short-circuit.
    const terminal = [
      'succeeded',
      'captured',
      'failed',
      'cancelled',
      'refunded',
    ];
    if (terminal.includes(payment.state)) {
      const order = await this.prisma.orders.findFirst({
        where: { id: payment.order_id },
        select: { state: true },
      });
      return {
        state: payment.state,
        order_state: order?.state ?? 'unknown',
      };
    }

    // Resolve Wompi client (same shape as `payTable`).
    const wompiMethod = await this.prisma.store_payment_methods.findFirst({
      where: {
        state: 'enabled',
        system_payment_method: { type: 'wompi' },
      },
      include: { system_payment_method: true },
    });
    if (!wompiMethod?.custom_config) {
      throw new VendixHttpException(
        ErrorCodes.PAY_METHOD_DISABLED_001,
        'Wompi no está configurado para esta tienda',
      );
    }
    const cfg = this.paymentEncryptionService.decryptConfig(
      wompiMethod.custom_config as Record<string, any>,
      'wompi',
    );
    const wompiConfig = {
      public_key: cfg.public_key,
      private_key: cfg.private_key,
      events_secret: cfg.events_secret || '',
      integrity_secret: cfg.integrity_secret || '',
      environment:
        (cfg.environment as WompiEnvironment) || WompiEnvironment.SANDBOX,
    };
    const client: WompiClient = this.wompiClientFactory.getClient(
      `store-${store_id}`,
      wompiConfig,
    );

    // Lookup priority: real Wompi id first, then Vendix reference.
    let txn: any = null;
    const placeholderRe = /^[a-z_]+_\d{10,}_[a-z0-9]+$/i;
    if (
      payment.transaction_id &&
      !placeholderRe.test(payment.transaction_id)
    ) {
      try {
        const resp = await client.getTransaction(payment.transaction_id);
        if (resp?.data?.id) txn = resp.data;
      } catch (err) {
        this.logger.warn(
          `confirmWompiTablePayment getTransaction failed: ${
            (err as Error).message
          }`,
        );
      }
    }
    if (!txn && payment.gateway_reference) {
      try {
        const resp = await client.getTransactionsByReference(
          payment.gateway_reference,
        );
        const list = resp?.data ?? [];
        if (list.length > 0) {
          txn = list.reduce(
            (latest: any, c: any) =>
              !latest ||
              new Date(c.created_at) > new Date(latest.created_at)
                ? c
                : latest,
            list[0],
          );
        }
      } catch (err) {
        this.logger.warn(
          `confirmWompiTablePayment getTransactionsByReference failed: ${
            (err as Error).message
          }`,
        );
      }
    }

    if (!txn) {
      this.logger.log(
        `confirmWompiTablePayment: no Wompi txn for payment=${payment.id} ref=${payment.gateway_reference}`,
      );
      return { state: payment.state, order_state: 'pending_payment' };
    }

    await this.applyWompiState(txn, payment);
    const finalPayment = await this.prisma.payments.findUnique({
      where: { id: payment.id },
      select: { state: true, transaction_id: true },
    });
    const finalOrder = await this.prisma.orders.findFirst({
      where: { id: payment.order_id },
      select: { state: true },
    });

    // Terminal success → post-commit diner push + staff notification.
    const finalState = finalPayment?.state ?? payment.state;
    if (finalState === 'succeeded' || finalState === 'captured') {
      this.sseService.push(store_id, {
        id: Date.now(),
        type: 'payment.confirmed',
        title: 'Pago confirmado',
        body: `Mesa ${table.name}`,
        data: {
          table_session_id: session.id,
          payment_id: payment.id,
          amount: Number(payment.amount),
          method: 'wompi',
          state: finalState,
        },
        created_at: new Date().toISOString(),
      });
      await this.notificationsService.createAndBroadcast(
        store_id,
        'table_payment_confirmed',
        'Pago confirmado de mesa',
        `Mesa ${table.name} — wompi — ${this.formatMoney(Number(payment.amount))}`,
        {
          table_id: table.id,
          table_name: table.name,
          table_session_id: session.id,
          payment_id: payment.id,
          method_type: 'wompi',
          amount: Number(payment.amount),
        },
      );
    }
    return {
      state: finalState,
      order_state: finalOrder?.state ?? 'unknown',
    };
  }

  /**
   * CAS-protected Wompi state-transition for the table-pay flow. Mirrors
   * `webhookHandler.applyWompiTransaction` but is invoked from the
   * user-facing `/pay/confirm` poll instead of the webhook. Refuses to
   * overwrite terminal states. Returns the new payment state on
   * transition, or `null` when Wompi still reports the txn as PENDING.
   */
  private async applyWompiState(
    txn: any,
    payment: { id: number; state: string; transaction_id: string | null },
  ): Promise<string | null> {
    const statusMap: Record<string, string> = {
      APPROVED: 'succeeded',
      DECLINED: 'failed',
      VOIDED: 'cancelled',
      ERROR: 'failed',
    };
    const mapped = statusMap[txn.status];
    if (!mapped) {
      // PENDING — leave as-is.
      return null;
    }
    const terminal = [
      'succeeded',
      'captured',
      'failed',
      'cancelled',
      'refunded',
    ];
    if (terminal.includes(payment.state)) {
      return payment.state;
    }
    await this.prisma.payments.update({
      where: { id: payment.id },
      data: {
        state: mapped,
        transaction_id: payment.transaction_id ?? txn.id,
        gateway_response: { transaction: txn },
        paid_at:
          mapped === 'succeeded' || mapped === 'captured' ? new Date() : null,
        updated_at: new Date(),
      },
    });
    return mapped;
  }

  /**
   * Cheap currency formatting for staff notifications — uses `Intl` so
   * the message reads naturally (e.g. `$ 45.000,00 COP`). Avoids
   * pulling `CurrencyPipe` (frontend only) and stays defensive when
   * `currency` is missing.
   */
  private formatMoney(amount: number, currency = 'COP'): string {
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  }
  /**
   * Best-effort auto-fire of `prepared` order items to the kitchen.
   * Mirrors the pattern in `split-order.service.ts:447` and
   * `payments.service.ts:1002`: `prepareFireContext` outside the
   * transaction, `fireOrderItemsInTx` inside, then
   * `emitKitchenFiredAfterCommit` after commit.
   *
   * Non-restaurant stores skip the fire (no kitchen). Failures are
   * logged but never bubble up — the items are already on the draft
   * order and the mesero can fire them manually from the KDS page.
   */
  private async tryAutoFire(
    store_id: number,
    order_id: number,
  ): Promise<boolean> {
    try {
      const store = await this.prisma.stores.findUnique({
        where: { id: store_id },
        select: { industries: true },
      });
      if (!storeIsRestaurant(store?.industries)) {
        return false;
      }

      // Resolve all order_item ids for the order (auto-fire targets all
      // `prepared` items that haven't been consumed yet —
      // `prepareFireContext` handles the partition).
      const order = await this.prisma.orders.findFirst({
        where: { id: order_id },
        select: {
          order_items: {
            where: { inventory_consumed_at_fire: false },
            select: { id: true },
          },
        },
      });
      const candidateIds = (order?.order_items ?? []).map((i) => i.id);
      if (candidateIds.length === 0) {
        return false;
      }

      const ctx = await this.kitchenFireService.prepareFireContext(
        order_id,
        candidateIds,
      );
      if (!ctx || ctx.firedItemIds.length === 0) {
        return false;
      }

      const fireResult = await this.prisma.$transaction(async (tx) => {
        return this.kitchenFireService.fireOrderItemsInTx(
          tx,
          store_id,
          ctx,
        );
      });

      await this.kitchenFireService.emitKitchenFiredAfterCommit(
        store_id,
        undefined,
        fireResult,
        order_id,
      );

      this.logger.log(
        `Auto-fired QR order: order=${order_id} ticket=${fireResult.ticketId} items=${fireResult.firedItemSnapshots.length}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Auto-fire failed for QR order ${order_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      return false;
    }
  }

  // --------------------------------------------- dispatchStaffNotification
  /**
   * Step 3 (QR-mesa) — per-user delivery helper. Resolves the waiters
   * assigned to `tableId` via `TablesService.getAssignedWaiterUserIds`
   * (Step 2) and emits ONE `sendToUser` per waiter with
   * `data.target_user_id` baked in. Falls back to a store-wide
   * `createAndBroadcast` when the table has NO assigned waiters, so
   * legacy tables and stores that never opt into the assignment
   * pivot keep working.
   *
   * The bell filter in `NotificationsService.findAll` honours
   * `data.target_user_id` and hides the row from non-recipient users,
   * so a mesero who is NOT assigned to the table does not see the
   * notification in their bell — only the assigned meseros do (plus
   * the diner-facing SSE channel, which is keyed off
   * `table_session_id` and unaffected).
   */
  private async dispatchStaffNotification(
    store_id: number,
    tableId: number,
    type: string,
    title: string,
    body: string,
    data: Record<string, any>,
    publicToken?: string,
  ): Promise<void> {
    // Step 4b (QR-mesa require_staff) — guarantee the per-table handle
    // (`public_token`) and `table_id` are always present in the payload
    // so the POS approval modal (Step 10) can call
    // `POST /ecommerce/tables/:token/confirm` directly from the
    // notification's `data` row without an extra table lookup. The token
    // is already public via the physical QR print, so it is not a
    // sensitive field.
    const enrichedData: Record<string, any> = {
      ...data,
      table_id: data.table_id ?? tableId,
      ...(publicToken ? { public_token: publicToken } : {}),
    };

    const waiterIds =
      await this.tablesService.getAssignedWaiterUserIds(tableId);
    if (waiterIds.length === 0) {
      await this.notificationsService.createAndBroadcast(
        store_id,
        type,
        title,
        body,
        enrichedData,
      );
      return;
    }
    for (const uid of waiterIds) {
      await this.notificationsService.sendToUser(
        store_id,
        uid,
        type,
        title,
        body,
        enrichedData,
      );
    }
  }

  // ------------------------------------------------------- notify staff
  /**
   * Step 3 (QR-mesa) — A diner scanning the QR under `require_staff`
   * behaviour now produces a persisted + bell + web push notification
   * routed through `dispatchStaffNotification` (per-waiter with
   * broadcast fallback) so the assigned mesero sees the request in
   * their bell. Previously this method only pushed an ephemeral SSE
   * tick on the store-wide channel — there was no DB row, so the
   * bell could not show it after a page reload.
   *
   * Fire-and-forget: the helper is awaited internally but the
   * surrounding `resolveByToken` returns its HTTP response without
   * waiting for the notification write — same pattern as
   * `createAndBroadcast` (which is non-throwing by design).
   */
  private notifyStaffTableScan(
    tableId: number,
    tableName: string,
    publicToken?: string,
  ): void {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) return;

    void this.dispatchStaffNotification(
      store_id,
      tableId,
      'qr_table_scan',
      'Mesa escaneada',
      `Un cliente escaneó el QR de la mesa ${tableName} y solicita confirmación`,
      { table_id: tableId, table_name: tableName },
      publicToken,
    );
  }

  // --------------------------------------------------- active_devices (Redis)
  /**
   * Tracks active diner devices per `table_session` so the
   * `session_closed` / `guest_count_changed` SSE handlers can know how
   * many clients are still attached and decide whether to push a banner
   * vs silently close the channel. Backed by a Redis Set
   * `table_session:{id}:devices` with a 2h sliding safety TTL.
   *
   * `uuid` is the diner's anonymous device identifier sent on the SSE
   * connection (GAP-7 device-id contract). `sadd` returns 1 the first
   * time a uuid joins, 0 if it was already in the set — used by the
   * SSE connect handler to fire a `guest_joined` event.
   */
  async registerDevice(
    sessionId: string | number,
    uuid: string,
  ): Promise<number> {
    const key = `table_session:${sessionId}:devices`;
    const added = await this.redis.sadd(key, uuid);
    await this.redis.expire(key, 7200);
    return added;
  }

  /**
   * Removes a diner device from the active set on SSE close / reconnect
   * mismatch. `srem` returns 1 if the uuid was present, 0 otherwise —
   * the SSE close handler uses this to skip a `guest_left` push when
   * the device was already evicted (e.g. session-closed wipe).
   */
  async unregisterDevice(
    sessionId: string | number,
    uuid: string,
  ): Promise<number> {
    return this.redis.srem(`table_session:${sessionId}:devices`, uuid);
  }

  /**
   * Current device count for a session — used by the session-close path
   * to decide whether to broadcast a final `session_closed` summary
   * (count === 0) or just mark the session closed server-side without
   * notifying (count > 0; the still-attached devices receive the event
   * on the next snapshot tick).
   */
  async getActiveDevicesCount(
    sessionId: string | number,
  ): Promise<number> {
    return this.redis.scard(`table_session:${sessionId}:devices`);
  }
}