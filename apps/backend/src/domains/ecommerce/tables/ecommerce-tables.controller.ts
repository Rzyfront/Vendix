import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, Subject, defer, from, interval, merge } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { EcommerceTablesService } from './ecommerce-tables.service';
import { NotificationsSseService } from '../../store/notifications/notifications-sse.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { AddItemsToTableSessionDto } from '../../store/tables/dto';
import {
  CallWaiterDto,
  RequestBillDto,
  RequestSplitDto,
  SetGuestCountDto,
} from './dto';
import type { DinerStreamBinding } from './ecommerce-tables.service';

/**
 * Maps producer-side KDS lifecycle event types (emitted by
 * `KitchenFireService` onto the per-store SSE subject) to diner-safe
 * types. Any event type NOT in this map (and not `bill.requested`) is
 * default-denied by the diner stream filter — the diner never sees
 * `order_created`, `low_stock`, `qr_table_scan`, `table_call_waiter`,
 * etc.
 */
const DINER_KDS_MAP: Record<string, string> = {
  'ticket.created': 'kitchen.fired',
  'ticket.started': 'kitchen.preparing',
  'ticket.ready': 'kitchen.ready',
  'ticket.delivered': 'kitchen.delivered',
};

/**
 * EcommerceTablesController
 *
 * QR-por-mesa — Pasos 6 + 8.
 *
 * Public-facing endpoints that a diner reaches after scanning a table
 * QR code. The QR URL carries `?mesa=<public_token>`; the frontend
 * calls `GET /ecommerce/tables/resolve?token=<public_token>` to resolve
 * the table and learn the store's configured scan behavior.
 *
 * Auth model:
 *   - `resolve` and `order` use `@OptionalAuth()` — anonymous diners
 *     can scan and self-order without a customer account.
 *   - `confirm` requires an authenticated JWT (mesero) — no
 *     `@OptionalAuth()`, so `JwtAuthGuard` enforces a valid token.
 *
 * Tenant context: `store_id` is resolved from the ecommerce domain by
 * `DomainResolverMiddleware` and populated in `RequestContextService`.
 */
@Controller('ecommerce/tables')
@UseGuards(JwtAuthGuard)
export class EcommerceTablesController {
  constructor(
    private readonly service: EcommerceTablesService,
    private readonly sseService: NotificationsSseService,
  ) {}

  /**
   * Step 6 — Resolve a table by its public QR token.
   *
   * Returns the table's basic info, the store's configured scan behavior
   * (`menu_only` / `mark_occupied` / `open_tab` / `require_staff`),
   * `auto_fire` flag, and — for `open_tab` mode — the active
   * `session_id` so the frontend can subscribe to the live check.
   */
  @Get('resolve')
  @OptionalAuth()
  async resolve(@Query('token') token: string) {
    const data = await this.service.resolveByToken(token);
    return { success: true, data };
  }

  /**
   * Step 8 — Auto-pedido a la cuenta.
   *
   * Appends items to the draft order backing the table's active session.
   * Only allowed in `open_tab` and `require_staff` (post-confirmation)
   * modes; `menu_only` and `mark_occupied` reject with 409.
   *
   * If `qr_auto_fire` is true, the `prepared` items are fired to the
   * kitchen immediately (auto-fire).
   */
  @Post(':token/order')
  @OptionalAuth()
  async addOrderItems(
    @Param('token') token: string,
    @Body() dto: AddItemsToTableSessionDto,
  ) {
    const data = await this.service.addOrderItems(token, dto);
    return { success: true, data };
  }

  /**
   * Step 8 — Mesero confirms a `require_staff` QR scan.
   *
   * Requires an authenticated JWT (no `@OptionalAuth`). Opens a table
   * session with `opened_by = <mesero userId>` so the check is
   * attributed to the server who confirmed.
   */
  @Post(':token/confirm')
  async confirmStaff(@Param('token') token: string) {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    const data = await this.service.confirmStaff(token, userId);
    return { success: true, data };
  }

  /**
   * GAP-10 — Diner declares the party size for the table's active
   * session. Validated against `tables.capacity` server-side.
   */
  @Post(':token/guests')
  @OptionalAuth()
  async setGuests(
    @Param('token') token: string,
    @Body() dto: SetGuestCountDto,
  ) {
    const data = await this.service.setGuests(token, dto.guest_count);
    return { success: true, data };
  }

  /**
   * GAP-5 (read) — The live check the diner sees (items + totals). 404
   * when the table has no open session.
   */
  @Get(':token/bill')
  @OptionalAuth()
  async getBill(@Param('token') token: string) {
    const data = await this.service.getBill(token);
    return { success: true, data };
  }

  /**
   * GAP-3 — Real-time diner stream. Emits:
   *   1) A one-shot `{ type: 'snapshot', bill }` warm-up (bill=null when
   *      no open check yet, so the banner can still attach).
   *   2) Live diner-safe events (`kitchen.fired|preparing|ready|delivered`
   *      + `bill.requested`) filtered to THIS table's bound order/session.
   *   3) A heartbeat comment every 30s.
   *
   * Security (default-deny): `boundOrderId`/`boundSessionId` are derived
   * SERVER-SIDE from the `public_token`, never from the client. The
   * filter drops any event that is not in the diner whitelist OR does not
   * match the bound order/session — so a diner can never observe another
   * table's kitchen activity.
   *
   * ALS caveat: the request context is captured SYNCHRONOUSLY and every
   * deferred DB read (binding + snapshot) is re-wrapped in
   * `RequestContextService.run(...)`; otherwise `StorePrismaService` would
   * see no `store_id` (AsyncLocalStorage already unwound) and throw
   * STORE_CONTEXT_001.
   */
  @Sse(':token/stream')
  @OptionalAuth()
  stream(
    @Param('token') token: string,
    @Req() req: Request,
  ): Observable<MessageEvent> {
    // 1) Capture context SYNCHRONOUSLY (before returning the Observable).
    const requestContext = RequestContextService.getContext();
    const storeId = requestContext?.store_id;
    if (!requestContext || !storeId) {
      throw new ForbiddenException('Store context required');
    }

    // 2) Resolve the diner binding (order_id + session_id) SERVER-SIDE
    //    from the token. Async, so we hold it in a mutable closure var
    //    and default-deny live events until it resolves (or stays null
    //    when there is no active session yet).
    let binding: DinerStreamBinding | null = null;
    void RequestContextService.run(requestContext, () =>
      this.service.resolveDinerBinding(token),
    )
      .then((b) => {
        binding = b;
      })
      .catch(() => {
        binding = null;
      });

    // 3) Subscribe to the per-store subject + clean up on disconnect.
    const subject = this.sseService.getOrCreate(storeId);
    req.on('close', () => {
      this.sseService.unsubscribe(storeId);
    });

    // 4) Snapshot — resolved lazily inside the captured ALS context.
    const snapshot$ = defer(() =>
      from(
        RequestContextService.run(requestContext, () =>
          this.service.getBill(token),
        )
          .then(
            (bill) =>
              ({
                data: JSON.stringify({ type: 'snapshot', bill }),
              }) as MessageEvent,
          )
          .catch(
            () =>
              ({
                data: JSON.stringify({ type: 'snapshot', bill: null }),
              }) as MessageEvent,
          ),
      ),
    );

    // 5) Live events — default-deny filter keyed on the server-derived
    //    binding, then projected to a diner-safe payload. The per-store
    //    subject carries a mixed union (SseNotificationPayload from the
    //    bell + KdsSseEvent pushed as `any` by KitchenFireService), so we
    //    take the single necessary cast to a loose record here.
    const live$ = (
      subject as unknown as Subject<Record<string, unknown>>
    ).pipe(
      filter((ev) => this.matchesDiner(ev, binding)),
      map(
        (ev) =>
          ({
            data: JSON.stringify(this.projectForDiner(ev)),
          }) as MessageEvent,
      ),
    );

    // 6) Heartbeat every 30s (SSE comment — leading ":" keeps proxies
    //    alive without triggering client reconnection).
    const heartbeat$ = interval(30_000).pipe(
      map(() => ({ data: ': heartbeat' }) as MessageEvent),
    );

    return merge(snapshot$, live$, heartbeat$);
  }

  /**
   * GAP-5 (write) — Diner requests waiter attention. Fires a staff
   * notification (bell + SSE + web push); no mutation.
   */
  @Post(':token/call-waiter')
  @OptionalAuth()
  async callWaiter(
    @Param('token') token: string,
    @Body() dto: CallWaiterDto,
  ) {
    const data = await this.service.callWaiter(token, dto.note);
    return { success: true, data };
  }

  /**
   * GAP-5 (write) — Diner requests the bill. Fires a staff notification
   * and echoes `bill.requested` onto the diner stream; no mutation.
   */
  @Post(':token/request-bill')
  @OptionalAuth()
  async requestBill(
    @Param('token') token: string,
    @Body() dto: RequestBillDto,
  ) {
    const data = await this.service.requestBill(token, dto);
    return { success: true, data };
  }

  /**
   * GAP-8 (conservative) — Diner asks to split the bill. Fires a staff
   * notification ONLY; the mesero executes the real split from the staff
   * panel. No mutation, no `SplitOrderService` call.
   */
  @Post(':token/request-split')
  @OptionalAuth()
  async requestSplit(
    @Param('token') token: string,
    @Body() dto: RequestSplitDto,
  ) {
    const data = await this.service.requestSplit(token, dto);
    return { success: true, data };
  }

  // -------------------------------------------------- diner projection
  /**
   * Default-deny filter for the diner stream. Accepts ONLY:
   *   - KDS lifecycle events (whitelisted in `DINER_KDS_MAP`) whose
   *     `ticket.order_id` equals the bound order.
   *   - `bill.requested` events whose `data.table_session_id` equals the
   *     bound session.
   * Everything else — including all other notification types and any
   * event for a different table — is dropped.
   */
  private matchesDiner(
    ev: Record<string, unknown>,
    binding: DinerStreamBinding | null,
  ): boolean {
    if (!binding) return false;
    const type = typeof ev?.type === 'string' ? (ev.type as string) : '';
    if (!type) return false;

    if (DINER_KDS_MAP[type]) {
      const ticket = ev.ticket as { order_id?: number } | undefined;
      return ticket?.order_id === binding.order_id;
    }
    if (type === 'bill.requested') {
      const data = ev.data as { table_session_id?: number } | undefined;
      return data?.table_session_id === binding.session_id;
    }
    return false;
  }

  /**
   * Projects a raw per-store SSE event to a diner-safe payload. STRIPS
   * COGS / cost snapshots / recipe / sku and any store-internal ids —
   * the diner only receives presentational dish state.
   */
  private projectForDiner(ev: Record<string, unknown>): Record<string, unknown> {
    const type = typeof ev?.type === 'string' ? (ev.type as string) : '';

    if (type === 'bill.requested') {
      return {
        type: 'bill.requested',
        title: (ev.title as string) ?? 'Solicitud de cuenta',
        body: (ev.body as string) ?? '',
        ts: Date.now(),
      };
    }

    const dinerType = DINER_KDS_MAP[type] ?? 'kitchen.update';
    const ticket = (ev.ticket ?? {}) as Record<string, unknown>;
    const rawItems = Array.isArray(ticket.items)
      ? (ticket.items as Array<Record<string, unknown>>)
      : [];

    return {
      type: dinerType,
      ticket: {
        id: ticket.id ?? null,
        status: ticket.status ?? null,
        daily_number: ticket.daily_number ?? null,
        fired_at: ticket.fired_at ?? null,
        ready_at: ticket.ready_at ?? null,
        items: rawItems.map((it) => {
          const product = (it.product ?? {}) as Record<string, unknown>;
          return {
            product_name: product.name ?? null,
            quantity: it.quantity ?? null,
            status: it.status ?? null,
          };
        }),
      },
      ts: (ev.ts as number) ?? Date.now(),
    };
  }
}