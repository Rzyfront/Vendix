import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, defer, from, interval, merge } from 'rxjs';
import { catchError, filter, map } from 'rxjs/operators';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { TableSessionsService } from './table-sessions.service';
import {
  OpenTableSessionDto,
  AddItemsToTableSessionDto,
  AssignCustomerDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { NotificationsSseService } from '../notifications/notifications-sse.service';

/**
 * Whitelist of notification `type` values that the staff dashboard cares
 * about. Anything NOT in this set is dropped before reaching the
 * browser. Default-deny: prefer false negatives over false positives.
 *
 * Members (current snapshot — see plan B3 + Fase F/H):
 *   - `comensal_joined` | `comensal_left`     (B1: comensales vía QR)
 *   - `item_added`                            (B2: items agregados)
 *   - `guest_count_changed`                   (B2: comensales declarados)
 *   - `bill.requested`                        (C2: pedido de cuenta)
 *   - `payment.pending` | `payment.confirmed` (C3/C4: payments dashboard)
 *   - `kitchen.*`                             (kitchen-fire.service push)
 *   - `table_payment_pending` |
 *     `table_payment_confirmed`               (C5: payment per-table state)
 */
const STAFF_EVENT_WHITELIST = (type: string): boolean => {
  if (type === 'comensal_joined') return true;
  if (type === 'comensal_left') return true;
  if (type === 'item_added') return true;
  if (type === 'guest_count_changed') return true;
  if (type === 'bill.requested') return true;
  if (type === 'payment.pending') return true;
  if (type === 'payment.confirmed') return true;
  if (type === 'table_payment_pending') return true;
  if (type === 'table_payment_confirmed') return true;
  if (type.startsWith('kitchen.')) return true;
  // The synthetic channels emitted by THIS SSE (snapshot / heartbeat) are
  // allowed through here too — they're emitted as their own typed
  // MessageEvent payloads and never hit this predicate (they're written
  // directly to the wire via the `merge`, not via the Subject).
  return false;
};

/**
 * TableSessionsController (Restaurant Suite — Fase E)
 *
 * REST seam for the `table_sessions` domain (open checks).
 *
 *   POST  /api/store/table-sessions              open session (creates order draft)
 *   GET   /api/store/table-sessions/:id          session detail with current draft order
 *   POST  /api/store/table-sessions/:id/add-items append items to the draft order
 *   PATCH /api/store/table-sessions/:id/customer assign/detach the order customer
 *   POST  /api/store/table-sessions/:id/close    close the session (NOT the order)
 *
 * Permission policy:
 *   - GET detail  → store:table_sessions:read
 *   - POST open   → store:table_sessions:create
 *   - POST add-items / PATCH customer / close → store:table_sessions:update
 */
@Controller('store/table-sessions')
@UseGuards(PermissionsGuard)
export class TableSessionsController {
  constructor(
    private readonly tableSessionsService: TableSessionsService,
    private readonly responseService: ResponseService,
    private readonly sseService: NotificationsSseService,
    private readonly requestContextService: RequestContextService,
  ) {}

  @Post()
  @Permissions('store:table_sessions:create')
  async open(@Body() dto: OpenTableSessionDto) {
    try {
      const result = await this.tableSessionsService.openSession(dto);
      return this.responseService.created(
        result,
        'Sesión de mesa abierta exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al abrir la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get(':id')
  @Permissions('store:table_sessions:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.tableSessionsService.findOne(id);
      return this.responseService.success(
        result,
        'Sesión de mesa obtenida exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la sesión de mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/add-items')
  @Permissions('store:table_sessions:update')
  async addItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddItemsToTableSessionDto,
  ) {
    try {
      const result = await this.tableSessionsService.addItems(id, dto);
      return this.responseService.updated(
        result,
        'Items agregados a la cuenta',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al agregar items a la cuenta',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':id/customer')
  @Permissions('store:table_sessions:update')
  async assignCustomer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignCustomerDto,
  ) {
    try {
      const result = await this.tableSessionsService.assignCustomer(
        id,
        dto.customer_id,
      );
      return this.responseService.updated(
        result,
        dto.customer_id == null
          ? 'Cliente desasignado de la cuenta'
          : 'Cliente asignado a la cuenta',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al asignar el cliente a la cuenta',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/close')
  @Permissions('store:table_sessions:update')
  async close(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.tableSessionsService.closeSession(id);
      return this.responseService.updated(
        result,
        'Sesión de mesa cerrada',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al cerrar la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  /**
   * Staff real-time stream: `/api/store/table-sessions/stream`.
   *
   * Drives the mesas dashboard (POS-web). Emits:
   *   1) An INITIAL `{ type: 'snapshot', data: { sessions: [...] } }`
   *      event so a freshly connected client doesn't render a blank
   *      room map while waiting for live deltas.
   *   2) Live events from the shared per-store subject (`comensal_*`,
   *      `item_added`, `guest_count_changed`, `bill.requested`,
   *      `payment.*`, `kitchen.*`, `table_payment_*`). Anything NOT in
   *      `STAFF_EVENT_WHITELIST` is dropped — default-deny.
   *   3) A 30s heartbeat comment (`: heartbeat <ts>`) so proxies and
   *      CDNs see the stream is alive.
   *
   * Auth: `JwtAuthGuard` is global and accepts `?token=` for SSE
   * clients (EventSource can't set Authorization headers). The store
   * identity is taken from `req.user.store_id` via the request context
   * — we capture it SYNCHRONOUSLY (before the Observable is returned)
   * because the snapshot is resolved lazily under `defer`/`from`,
   * AFTER AsyncLocalStorage has already unwound.
   *
   * Cleanup: on `req.on('close', …)` we decrement the per-store
   * refcount via `sseService.unsubscribe` — when the last subscriber
   * leaves, `NotificationsSseService` tears the Subject down.
   */
  @Sse('stream')
  @Permissions('store:table_sessions:read')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) {
      throw new ForbiddenException('Store context required');
    }
    // Snapshot the AsyncLocalStorage context synchronously — the SSE
    // emits fire asynchronously (defer + interval) and the request
    // context is unwound by the time the snapshot resolves. Without
    // this, `StorePrismaService.table_sessions.findMany` inside the
    // snapshot would surface STORE_CONTEXT_001.
    const requestContext = context;
    const store_id = context.store_id;

    const subject = this.sseService.getOrCreate(store_id);

    req.on('close', () => {
      this.sseService.unsubscribe(store_id);
    });

    // 1) Snapshot of currently-open table_sessions for this store.
    //    Resolved asynchronously and emitted as a single-shot event;
    //    errors are downgraded to an empty payload so they don't tear
    //    down the live stream.
    const snapshot$ = defer(() =>
      from(
        RequestContextService.run(requestContext, () =>
          this.tableSessionsService
            .listActiveSessions()
            .then((sessions) => ({
              sessions,
              server_ts: Date.now(),
            })),
        )
          .then(
            (snap) =>
              ({
                type: 'snapshot',
                data: snap,
              }) as { type: string; data: any },
          )
          .catch(
            (err) =>
              ({
                type: 'snapshot',
                data: { sessions: [], server_ts: Date.now(), error: (err as Error).message },
              }) as { type: string; data: any },
          ),
      ),
    ).pipe(
      catchError(() => from([] as { type: string; data: any }[])),
      map(
        (payload) =>
          ({
            data: JSON.stringify(payload),
          }) as MessageEvent,
      ),
    );

    // 2) Live events from the shared per-store subject — FILTERED by
    //    whitelist to default-deny anything not relevant to the staff
    //    dashboard (e.g. push notifications, web-push noise, etc.).
    const live$ = subject.pipe(
      filter((payload) => STAFF_EVENT_WHITELIST(payload.type)),
      map(
        (payload) =>
          ({
            data: JSON.stringify(payload),
          }) as MessageEvent,
      ),
    );

    // 3) Heartbeat every 30s — emitted as a comment (": ping") so it
    //    doesn't trigger client-side reconnection logic.
    const heartbeat$ = interval(30_000).pipe(
      map(
        () =>
          ({
            data: `: heartbeat ${Date.now()}`,
          }) as MessageEvent,
      ),
    );

    return merge(snapshot$, live$, heartbeat$);
  }
}
