import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { TablesService } from '../../store/tables/tables.service';
import { TableSessionsService } from '../../store/tables/table-sessions.service';
import { SettingsService } from '../../store/settings/settings.service';
import { KitchenFireService } from '../../store/kitchen-fire/kitchen-fire.service';
import { MenuAvailabilityCheckerService } from '../../store/menus/menu-availability-checker.service';
import { NotificationsSseService } from '../../store/notifications/notifications-sse.service';
import { storeIsRestaurant } from '../../../common/helpers/industry-capabilities.helper';
import { AddItemsToTableSessionDto } from '../../store/tables/dto';

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
  table: { id: number; name: string };
  behavior: QrScanBehavior;
  auto_fire: boolean;
  session_id?: number;
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
    private readonly kitchenFireService: KitchenFireService,
    private readonly menuAvailabilityChecker: MenuAvailabilityCheckerService,
    private readonly sseService: NotificationsSseService,
  ) {}

  // ------------------------------------------------------------- settings
  /**
   * Reads `restaurant.qr_scan_behavior` and `restaurant.qr_auto_fire`
   * from `store_settings.settings` for the current store. Follows the
   * same direct-read pattern as `CheckoutService.getCheckoutSettings`
   * (checkout.service.ts:250) — avoids the heavy `getSettings()` path
   * (which signs S3 URLs etc.) for a lightweight settings-block read.
   */
  private async getQrSettings(): Promise<{
    behavior: QrScanBehavior;
    auto_fire: boolean;
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

    return {
      behavior: (restaurant.qr_scan_behavior as QrScanBehavior) ?? 'menu_only',
      auto_fire: !!restaurant.qr_auto_fire,
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

    const table = await this.prisma.tables.findFirst({
      where: { public_token: token },
      select: { id: true, name: true, status: true },
    });
    if (!table) {
      throw new VendixHttpException(ErrorCodes.TABLE_NOT_FOUND);
    }

    const { behavior, auto_fire } = await this.getQrSettings();

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
        this.notifyStaffTableScan(table.id, table.name);
        break;

      default:
        // Unknown behavior — fall back to menu_only (safest).
        break;
    }

    return {
      table: { id: table.id, name: table.name },
      behavior,
      auto_fire,
      ...(session_id !== undefined && { session_id }),
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

  // ----------------------------------------------------------- auto-fire
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

  // ------------------------------------------------------- notify staff
  /**
   * Pushes an SSE notification to the store's staff channel so a mesero
   * sees that a diner scanned the QR at `tableId` and is waiting for
   * confirmation. Uses `NotificationsSseService.push` (per-store
   * broadcast) — same channel the KDS and order-created events use.
   */
  private notifyStaffTableScan(tableId: number, tableName: string): void {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) return;

    this.sseService.push(store_id, {
      id: Date.now(),
      type: 'qr_table_scan',
      title: 'Mesa escaneada',
      body: `Un cliente escaneó el QR de la mesa ${tableName} y solicita confirmación`,
      data: { table_id: tableId, table_name: tableName },
      created_at: new Date().toISOString(),
    });
  }
}