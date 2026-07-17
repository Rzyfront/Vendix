import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
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
  PayTableDto,
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
  private readonly logger = new Logger(EcommerceTablesController.name);

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
   * Lists payment methods enabled for the current store, scoped to the
   * table-token request. Public — diners use this to render the payment
   * sheet. Filters out methods that should never surface to the mesa
   * checkout flow (e.g. credit-on-account, layaway) by reusing the
   * existing StorePaymentMethodsService.getEnabledForStore() allowlist.
   */
  @Get(':token/payment-methods')
  @OptionalAuth()
  async getPaymentMethods(@Param('token') token: string) {
    const data = await this.service.getTablePaymentMethods(token);
    return { success: true, data };
  }

  /**
   * GAP-3 — Real-time diner stream. Emits:
   *   1) A one-shot `{ type: 'snapshot', bill, active_devices }` warm-up
   *      (bill=null when no open check yet, so the banner can still attach).
   *   2) Live diner-safe events:
   *      - `kitchen.fired|preparing|ready|delivered` (filtered to bound order).
   *      - `bill.requested` (filtered to bound session).
   *      - `comensal_joined` / `comensal_left` / `item_added` /
   *        `guest_count_changed` (filtered to bound session).
   *   3) A heartbeat comment every 30s.
   *
   * Device lifecycle (GAP-7):
   *   - On connect, a `device_id` is taken from `?device_id=` query (raw
   *     — `@Query()` DTOs are forbidden by `forbidNonWhitelisted` for SSE)
   *     or generated with `randomUUID()`.
   *   - Once the server-side binding resolves, the device is registered in
   *     Redis (`registerDevice`). If the SET did not contain it before
   *     (`added === 1`), a `comensal_joined` event is broadcast to other
   *     diners on the same store SSE subject.
   *   - On `req.close`, the device is removed via `unregisterDevice`. If
   *     the SET contained it (`removed === 1`), a `comensal_left` event
   *     is broadcast. Reconnexion flaps (same `device_id` rejoins) suppress
   *     duplicated join/leave pings.
   *
   * Security (default-deny): `boundOrderId`/`boundSessionId` are derived
   * SERVER-SIDE from the `public_token`, never from the client. The
   * filter drops any event that is not in the diner whitelist OR does not
   * match the bound order/session — so a diner can never observe another
   * table's kitchen activity.
   *
   * ALS caveat: the request context is captured SYNCHRONOUSLY and every
   * deferred DB read (binding + snapshot + device lifecycle) is re-wrapped
   * in `RequestContextService.run(...)`; otherwise `StorePrismaService` /
   * the Redis-backed device helpers would see no `store_id` (AsyncLocalStorage
   * already unwound) and throw STORE_CONTEXT_001.
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

    // 1.5) device_id — read from raw query, generate if absent.
    //      SSE cannot send `Authorization` header, so the frontend must
    //      pass `device_id` as a query param. We DO NOT use `@Query()`
    //      with a DTO (forbidNonWhitelisted would 400 on `device_id`).
    //      Generated UUID is per-tab anonymous — never tied to a customer.
    const rawDeviceId = (req.query?.device_id ?? req.query?.deviceId) as
      | string
      | undefined;
    const deviceId =
      typeof rawDeviceId === 'string' && rawDeviceId.length > 0
        ? rawDeviceId
        : randomUUID();

    // Capture for the close handler. Set once the binding resolves.
    let capturedSessionId: number | null = null;
    let capturedDeviceId: string | null = null;

    // 2) Resolve the diner binding (table_id + optional session_id +
    //    order_id) SERVER-SIDE from the token. Async, so we hold it in a
    //    mutable closure var and default-deny live events until it
    //    resolves. `resolveDinerBinding` now returns `{ table_id, ... }`
    //    even when no session is open yet — so the stream filter can
    //    accept `session_opened` events for the comensal's table in
    //    pre-session windows (menu_only / mark_occupied / require_staff).
    //    Returns `null` only on hard denial (no store context / unknown
    //    token) — those connections drop at the middleware layer.
    let binding: DinerStreamBinding | null = null;
    void RequestContextService.run(requestContext, () =>
      this.service.resolveDinerBinding(token),
    )
      .then(async (b) => {
        binding = b;
        if (!b) return;
        capturedSessionId = b.session_id;
        capturedDeviceId = deviceId;
        // Register this diner device in the per-session Redis set ONLY
        // when a session is open — the Redis set is per-session, so a
        // pre-session comensal has nothing to join yet. Once a session
        // opens (via `session_opened`), the comensal reconnects with a
        // full binding and the device is registered on that fresh
        // connection.
        if (b.session_id == null) return;
        try {
          const added = await RequestContextService.run(requestContext, () =>
            (
              this.service as unknown as {
                registerDevice: (
                  sessionId: number,
                  uuid: string,
                ) => Promise<number>;
              }
            ).registerDevice(b.session_id as number, deviceId),
          );
          if (added === 1) {
            const count = await RequestContextService.run(
              requestContext,
              () =>
                (
                  this.service as unknown as {
                    getActiveDevicesCount: (
                      sessionId: number,
                    ) => Promise<number>;
                  }
                ).getActiveDevicesCount(b.session_id as number),
            );
            this.sseService.push(storeId, {
              type: 'comensal_joined',
              data: {
                table_session_id: b.session_id,
                active_devices: count,
                device_id: deviceId,
              },
              ts: Date.now(),
            } as unknown as Parameters<
              typeof this.sseService.push
            >[1]);
          }
        } catch (err) {
          this.logger.warn(
            `registerDevice failed for token=${token}: ${
              (err as Error).message
            }`,
          );
        }
      })
      .catch(() => {
        binding = null;
      });

    // 3) Subscribe to the per-store subject + clean up on disconnect.
    const subject = this.sseService.getOrCreate(storeId);
    req.on('close', () => {
      this.sseService.unsubscribe(storeId);
      // Best-effort: only run if the binding had resolved (otherwise the
      // device was never registered). Use the captured session_id/deviceId
      // because `binding` may already have been GC'd by the time this
      // fires.
      const sessionIdToUnregister = capturedSessionId;
      const deviceIdToUnregister = capturedDeviceId;
      if (sessionIdToUnregister == null || !deviceIdToUnregister) {
        return;
      }
      // Fire-and-forget — pushing `comensal_left` is best-effort. Wrap
      // the SREM in ALS so Redis-backed services still see store context.
      void RequestContextService.run(requestContext, async () => {
        try {
          const removed = await (
            this.service as unknown as {
              unregisterDevice: (
                sessionId: number,
                uuid: string,
              ) => Promise<number>;
            }
          ).unregisterDevice(
            sessionIdToUnregister,
            deviceIdToUnregister,
          );
          if (removed === 1) {
            const count = await (
              this.service as unknown as {
                getActiveDevicesCount: (
                  sessionId: number,
                ) => Promise<number>;
              }
            ).getActiveDevicesCount(sessionIdToUnregister);
            this.sseService.push(storeId, {
              type: 'comensal_left',
              data: {
                table_session_id: sessionIdToUnregister,
                active_devices: count,
                device_id: deviceIdToUnregister,
              },
              ts: Date.now(),
            } as unknown as Parameters<
              typeof this.sseService.push
            >[1]);
          }
        } catch (err) {
          this.logger.warn(
            `unregisterDevice failed for token=${token}: ${
              (err as Error).message
            }`,
          );
        }
      });
    });

    // 4) Snapshot — resolved lazily inside the captured ALS context.
    //    Includes `active_devices` so the storefront can render an
    //    accurate comensal counter from the first frame.
    const snapshot$ = defer(() =>
      from(
        (async () => {
          try {
            const bill = await RequestContextService.run(requestContext, () =>
              this.service.getBill(token),
            );
            let activeDevices: number | null = null;
            if (bill?.session_id != null) {
              try {
                activeDevices = await RequestContextService.run(
                  requestContext,
                  () =>
                    (
                      this.service as unknown as {
                        getActiveDevicesCount: (
                          sessionId: number,
                        ) => Promise<number>;
                      }
                    ).getActiveDevicesCount(bill.session_id),
                );
              } catch {
                activeDevices = null;
              }
            }
            const payload: Record<string, unknown> = {
              type: 'snapshot',
              bill,
            };
            if (activeDevices !== null) {
              payload.active_devices = activeDevices;
            }
            return { data: JSON.stringify(payload) } as MessageEvent;
          } catch {
            return {
              data: JSON.stringify({ type: 'snapshot', bill: null }),
            } as MessageEvent;
          }
        })(),
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

  /**
   * C2 — Diner initiates payment of the open session's bill. Honors the
   * `restaurant.enable_table_checkout` gate (see `EcommerceTablesService.
   * payTable`); flows:
   *   - `cash` / `bank_transfer` → returns `{ payment_id, state:
   *     'pending' }` + pushes `payment.pending` onto the diner stream.
   *   - `wompi` → returns the same shape but adds `next: 'wompi_widget'`
   *     and the `wompi_data` payload the storefront renders.
   *
   * Auth: `@OptionalAuth` — anonymous comensales are the common case,
   * but a mesero who logged into the storefront can also fire this
   * (the QR token is the implicit auth). Store context is resolved
   * by `DomainResolverMiddleware`.
   */
  @Post(':token/pay')
  @OptionalAuth()
  async pay(
    @Param('token') token: string,
    @Body() dto: PayTableDto,
  ) {
    const userId = RequestContextService.getUserId() ?? undefined;
    const data = await this.service.payTable(token, dto, userId);
    return { success: true, data };
  }

  /**
   * C2 — Diner re-enters from the Wompi widget callback and wants the
   * canonical terminal state. Mirrors `CheckoutService.confirmWompiPayment`
   * but scoped to the table-pay flow; on `succeeded`/`captured` also
   * pushes `payment.confirmed` onto the diner stream + fires the staff
   * notification.
   *
   * Idempotent — calling twice on a terminal payment just returns the
   * persisted state.
   */
  @Post(':token/pay/confirm')
  @OptionalAuth()
  async confirmPay(
    @Param('token') token: string,
    @Body() body: { payment_id: number },
  ) {
    const data = await this.service.confirmWompiTablePayment(
      token,
      body.payment_id,
    );
    return { success: true, data };
  }

  // -------------------------------------------------- diner projection
  /**
   * Whitelist of diner-side lifecycle event types (these are NOT KDS
   * events — they describe the comensal's view: who's at the table, what
   * was added, party size changes, payment state). Each event is
   * filtered by `data.table_session_id === binding.session_id` (with a
   * fallback to `data.session_id` for the `comensal_*` pair — producer
   * may emit either field name).
   *
   * `payment.pending` / `payment.confirmed` are added in C5 so the
   * banner can flip to "Pago pendiente" / "Pago confirmado" without a
   * refetch (see `payTable` / `confirmWompiTablePayment`).
   */
  private static readonly DINER_LIFECYCLE_EVENTS: ReadonlySet<string> =
    new Set([
      'comensal_joined',
      'comensal_left',
      'item_added',
      'guest_count_changed',
      'payment.pending',
      'payment.confirmed',
      // Mesa cerrada por el staff (POS efectivo/tarjeta), el cierre canónico
      // o la reconciliación de un pago digital (Wompi/wallet). El comensal
      // recibe el evento y muestra la despedida / resumen de compra.
      'session_closed',
      // Mesa de la cual el comensal ya está observando pasa a tener una
      // cuenta abierta (POS, QR `open_tab` o `require_staff` confirmado).
      // Filtrado por `table_id` — NO requiere sesión previa en el binding,
      // porque es el evento que la CREA.
      'session_opened',
    ]);

  /**
   * Default-deny filter for the diner stream. Accepts ONLY:
   *   - KDS lifecycle events (whitelisted in `DINER_KDS_MAP`) whose
   *     `ticket.order_id` equals the bound order.
   *   - `bill.requested` events whose `data.table_session_id` equals the
   *     bound session.
   *   - Diner-side lifecycle events (`comensal_joined|left`, `item_added`,
   *     `guest_count_changed`, `payment.pending`, `payment.confirmed`,
   *     `session_closed`) whose `data.table_session_id` (or `data.session_id`)
   *     equals the bound session.
   *   - `session_opened` events whose `data.table_id` equals the bound
   *     table — accepted even when `binding.session_id` is `null`
   *     (pre-session window), so a comensal in `menu_only` / `mark_occupied`
   *     / `require_staff` can flip to "cuenta abierta" when staff opens the
   *     tab from the POS side or confirms a `require_staff` scan.
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
    if (type === 'session_opened') {
      // Table-scoped event: the comensal's table is the one transitioning.
      // Works for both pre-session (session_id === null) and post-session
      // (comensal already reconnected with full binding) — the latter is
      // effectively a no-op match for the staff.
      const data = ev.data as { table_id?: number } | undefined;
      return data?.table_id === binding.table_id;
    }
    if (EcommerceTablesController.DINER_LIFECYCLE_EVENTS.has(type)) {
      const data = ev.data as
        | { table_session_id?: number; session_id?: number }
        | undefined;
      const sid =
        data?.table_session_id ?? data?.session_id ?? undefined;
      return sid === binding.session_id;
    }
    return false;
  }

  /**
   * Projects a raw per-store SSE event to a diner-safe payload. STRIPS
   * COGS / cost snapshots / recipe / sku and any store-internal ids —
   * the diner only receives presentational dish state.
   *
   * For diner-side lifecycle events (`comensal_joined|left`,
   * `item_added`, `guest_count_changed`, `payment.pending`,
   * `payment.confirmed`) only fields present in `ev.data` are
   * forwarded; absent fields are simply omitted (no `null` padding).
   * The projected payload is intentionally minimal:
   *   `{ type, table_session_id, active_devices?, device_id?,
   *      item_count?, subtotal?, guest_count?, payment_state?,
   *      payment_id?, amount?, method?, ts }`
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

    if (type === 'session_opened') {
      // Pass-through projection: the comensal needs `table_id`, `session_id`,
      // `order_id`, `opened_at`, `opened_by` to flip into "cuenta abierta"
      // and (typically) reconnect the stream so subsequent events match the
      // post-session binding.
      const raw = (ev.data ?? {}) as Record<string, unknown>;
      const projected: Record<string, unknown> = { type };
      const allowedKeys = [
        'table_id',
        'session_id',
        'order_id',
        'opened_at',
        'opened_by',
      ];
      for (const key of allowedKeys) {
        if (raw[key] !== undefined) {
          projected[key] = raw[key];
        }
      }
      projected.ts = (ev.ts as number) ?? Date.now();
      return projected;
    }

    if (EcommerceTablesController.DINER_LIFECYCLE_EVENTS.has(type)) {
      const raw = (ev.data ?? {}) as Record<string, unknown>;
      const projected: Record<string, unknown> = { type };
      // Whitelist field-by-field — any unknown producer field is dropped.
      const allowedKeys = [
        'table_session_id',
        'active_devices',
        'device_id',
        'item_count',
        'subtotal',
        'guest_count',
        'payment_state',
        'payment_id',
        'amount',
        'method',
      ];
      for (const key of allowedKeys) {
        if (raw[key] !== undefined) {
          projected[key] = raw[key];
        }
      }
      projected.ts = (ev.ts as number) ?? Date.now();
      return projected;
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