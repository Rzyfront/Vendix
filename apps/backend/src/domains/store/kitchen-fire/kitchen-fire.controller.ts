import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { Observable, defer, from, interval, merge } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { KitchenFireService } from './kitchen-fire.service';
import { NotificationsSseService } from '../notifications/notifications-sse.service';
import {
  FireOrderItemsDto,
  KitchenTicketQueryDto,
  KdsSnapshotQueryDto,
} from './dto';

/**
 * KitchenFireController (Restaurant Suite — Fase D + F)
 *
 * REST + SSE seam for fire-to-kitchen and the KDS board.
 *
 *   POST /api/store/kitchen-fire                  fire a list of order_items
 *   GET  /api/store/kitchen-fire/tickets          KDS list (paginated)
 *   GET  /api/store/kitchen-fire/snapshot         active tickets snapshot
 *   GET  /api/store/kitchen-fire/stream           SSE: kitchen:{store_id}
 *   POST /api/store/kitchen-fire/tickets/:id/start
 *   POST /api/store/kitchen-fire/tickets/:id/ready
 *   POST /api/store/kitchen-fire/tickets/:id/delivered
 *   POST /api/store/kitchen-fire/tickets/:id/cancel
 *
 * Permission policy:
 *   - POST /           → store:kitchen_fire:create
 *   - POST /tickets/…  → store:kitchen_fire:update
 *   - GET  /tickets    → store:kitchen_fire:read
 *   - GET  /snapshot   → store:kitchen_fire:read
 *   - GET  /stream     → store:kitchen_fire:read
 */
@Controller('store/kitchen-fire')
@UseGuards(PermissionsGuard)
export class KitchenFireController {
  constructor(
    private readonly kitchenFireService: KitchenFireService,
    private readonly sseService: NotificationsSseService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:kitchen_fire:create')
  async fire(@Body() dto: FireOrderItemsDto) {
    try {
      const result = await this.kitchenFireService.fireOrderItems(dto);
      return this.responseService.created(
        result,
        `Fire-to-kitchen ejecutado: ticket #${result.kitchen_ticket_id}, COGS=${result.cogs_total}`,
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al enviar a cocina',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get('tickets')
  @Permissions('store:kitchen_fire:read')
  async listTickets(@Query() query: KitchenTicketQueryDto) {
    try {
      const { data, total } =
        await this.kitchenFireService.findTickets(query);
      const limit = query.limit ?? 50;
      return this.responseService.paginated(
        data,
        total,
        1,
        limit,
        'Tickets de cocina obtenidos',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener tickets de cocina',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ------------------------------------------------------------ snapshot REST
  /**
   * Explicit REST snapshot of active tickets. Used by the KDS page on
   * initial load AND as the warm-up payload of the SSE stream. The
   * default window is 120min (covers a typical service); callers can
   * tune via `?windowMinutes=`.
   */
  @Get('snapshot')
  @Permissions('store:kitchen_fire:read')
  async snapshot(@Query() query: KdsSnapshotQueryDto) {
    try {
      const snap = await this.kitchenFireService.getActiveTicketsSnapshot(
        query.windowMinutes,
      );
      return this.responseService.success(
        {
          tickets: snap.data,
          total: snap.total,
          server_ts: snap.server_ts,
          window_minutes: query.windowMinutes ?? 120,
        },
        'Snapshot de tickets activos',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener snapshot de tickets',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ------------------------------------------------------------ SSE stream
  /**
   * Real-time KDS stream. Emits:
   *   1) An initial `{ type: 'snapshot', tickets: [...] }` event so a
   *      freshly connected client doesn't have to render blank columns.
   *   2) Live events from the per-store subject:
   *        ticket.created | ticket.started | ticket.ready |
   *        ticket.delivered | ticket.cancelled
   *   3) A heartbeat comment every 30s to keep proxies alive.
   *
   * Frontend reconciles via ticket id (snapshot = full replace, live
   * events = upsert / remove). The Subject is cleaned up on disconnect
   * (req.close) by the existing NotificationsSseService bookkeeping.
   */
  @Sse('stream')
  @Permissions('store:kitchen_fire:read')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    const subject = this.sseService.getOrCreate(store_id);

    // `windowMinutes` se lee CRUDO de la query — NO usamos `@Query()` con
    // DTO aquí. EventSource solo puede autenticarse por `?token=` (no puede
    // setear el header Authorization), y el ValidationPipe global
    // (`forbidNonWhitelisted: true`) rechazaría esa propiedad `token` con
    // un BadRequestException, que en SSE se emite como `event: error` y
    // tumba el stream. Es el mismo motivo por el que notifications/stream
    // usa solo `@Req()`. El endpoint REST /snapshot sí conserva el DTO.
    const rawWindow = Number(req.query.windowMinutes);
    const windowMinutes = Number.isFinite(rawWindow)
      ? Math.min(Math.max(Math.trunc(rawWindow), 5), 720)
      : 120;

    req.on('close', () => {
      this.sseService.unsubscribe(store_id);
    });

    // 1) Snapshot — resolved asynchronously; emitted as a single-shot.
    //    We use `defer` + `from(promise)` to keep it lazy (so a query
    //    error during the snapshot does not tear down the live stream).
    const snapshot$ = defer(() =>
      from(
        this.kitchenFireService
          .getActiveTicketsSnapshot(windowMinutes)
          .then(
            (snap) =>
              ({
                data: JSON.stringify({
                  type: 'snapshot',
                  tickets: snap.data,
                  total: snap.total,
                  server_ts: snap.server_ts,
                  window_minutes: windowMinutes,
                }),
              }) as MessageEvent,
          )
          .catch(
            (err) =>
              ({
                data: JSON.stringify({
                  type: 'snapshot',
                  tickets: [],
                  total: 0,
                  server_ts: Date.now(),
                  error: (err as Error).message,
                }),
              }) as MessageEvent,
          ),
      ),
    ).pipe(catchError(() => from([] as MessageEvent[])));

    // 2) Live events from the shared per-store subject.
    const live$ = subject.pipe(
      map(
        (payload) =>
          ({
            data: JSON.stringify(payload),
          }) as MessageEvent,
      ),
    );

    // 3) Heartbeat every 30s — emitted as a comment (": ping") so
    //    clients (and proxies) see the stream is alive without
    //    triggering reconnection logic.
    const heartbeat$ = interval(30_000).pipe(
      map(
        () =>
          ({
            // SSE comment line; the leading ":" makes NestJS treat it
            // as a comment rather than a typed event.
            data: `: heartbeat ${Date.now()}`,
          }) as MessageEvent,
      ),
    );

    return merge(snapshot$, live$, heartbeat$);
  }

  // ------------------------------------------------------------ mutations
  @Post('tickets/:id/start')
  @Permissions('store:kitchen_fire:update')
  async startTicket(
    @Param('id', ParseIntPipe) id: number,
  ) {
    try {
      const ticket = await this.kitchenFireService.startPreparation(id);
      return this.responseService.success(ticket, 'Ticket en preparación');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al iniciar el ticket',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post('tickets/:id/ready')
  @Permissions('store:kitchen_fire:update')
  async readyTicket(@Param('id', ParseIntPipe) id: number) {
    try {
      const ticket = await this.kitchenFireService.markReady(id);
      return this.responseService.success(ticket, 'Ticket listo');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al marcar el ticket como listo',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post('tickets/:id/delivered')
  @Permissions('store:kitchen_fire:update')
  async deliverTicket(@Param('id', ParseIntPipe) id: number) {
    try {
      const ticket = await this.kitchenFireService.markDelivered(id);
      return this.responseService.success(ticket, 'Ticket entregado');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al entregar el ticket',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post('tickets/:id/cancel')
  @Permissions('store:kitchen_fire:update')
  async cancelTicket(@Param('id', ParseIntPipe) id: number) {
    try {
      const ticket = await this.kitchenFireService.cancelTicket(id);
      return this.responseService.success(ticket, 'Ticket cancelado');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al cancelar el ticket',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
