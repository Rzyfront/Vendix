import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Sse,
  Req,
  MessageEvent,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { CarrierDeliveryService } from './carrier-delivery.service';
import { CarrierPoolSseService } from './carrier-pool-sse.service';
import { PoolQueryDto } from './dto/pool-query.dto';
import { RouteHistoryQueryDto } from './dto/route-history-query.dto';
import {
  SettleStopDto,
  ReleaseStopDto,
  CloseDispatchRouteDto,
  ReorderStopsDto,
} from '../dispatch-routes/dto';
import { UpdateDispatchNoteAddressDto } from '../dispatch-notes/dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Carrier namespace controller (Repartos Fase B6).
 *
 * `@Controller('store/carrier')` — el marcador `/store/carrier/` es el ÚNICO
 * prefijo que `DomainScopeGuard` (B3) abre para el app_type `STORE_DELIVERY`.
 * El guard global `JwtAuthGuard` ya aplica; aquí sólo se añade
 * `PermissionsGuard` + `@Permissions`.
 *
 * Ningún endpoint expone route-id: cada acción resuelve "mi ruta" desde el JWT
 * (driver_user_id = ctx.user_id), neutralizando por construcción la fuga de
 * path-prefix del PermissionsGuard.
 *
 * Los endpoints de EJECUCIÓN (dispatch/start/settle/release/close/reorder)
 * son de la Fase B7: delegan en `RouteFlowService` (motor de despacho) tras
 * resolver "mi ruta" del JWT y validar la pertenencia de la parada.
 */
@Controller('store/carrier')
@UseGuards(PermissionsGuard)
export class CarrierDeliveryController {
  constructor(
    private readonly carrierService: CarrierDeliveryService,
    private readonly responseService: ResponseService,
    private readonly poolSse: CarrierPoolSseService,
  ) {}

  /** Pool de órdenes publicadas por el admin, sin reclamar. */
  @Get('pool')
  @Permissions('store:carrier:pool:read')
  async getPool(@Query() query: PoolQueryDto) {
    const { data, total, page, limit } =
      await this.carrierService.listPool(query);
    return this.responseService.paginated(
      data,
      total,
      page,
      limit,
      'Pool de repartos',
    );
  }

  /**
   * Stream SSE del pool en vivo. Emite `{ type: 'pool_changed' }` cada vez que
   * el pool muta (orden publicada/reexpuesta, reclamada, o cancelada/reembolsada)
   * para que la lista del repartidor se refresque sin polling. Auth por `?token=`
   * la resuelve el `JwtAuthGuard` global + el interceptor que puebla
   * `RequestContextService`. `pool/stream` es un sub-path distinto de `pool`
   * (exacto) y de `pool/:orderId/claim` (POST): no rompe el matching.
   */
  @Sse('pool/stream')
  @Permissions('store:carrier:pool:read')
  poolStream(@Req() req: Request): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    if (!store_id) throw new ForbiddenException('Store context required');

    const subject = this.poolSse.getOrCreate(store_id);
    req.on('close', () => this.poolSse.unsubscribe(store_id));

    return subject.pipe(
      map((payload) => ({ data: JSON.stringify(payload) }) as MessageEvent),
    );
  }

  /** Reclamar una orden (claim atómico primero-gana). */
  @Post('pool/:orderId/claim')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:claim')
  async claim(@Param('orderId', ParseIntPipe) orderId: number) {
    const result = await this.carrierService.claim(orderId);
    return this.responseService.success(result, 'Orden tomada para reparto');
  }

  /** Mi ruta activa + payout informativo (resuelta desde el JWT). */
  @Get('route')
  @Permissions('store:carrier:route:read')
  async getRoute() {
    const result = await this.carrierService.getActiveRouteWithPayout();
    return this.responseService.success(result, 'Mi ruta activa');
  }

  // ── Ejecución de ruta (Fase B7) — sin route-id: la ruta se resuelve del JWT ─

  /** Despachar MI ruta activa (draft → dispatched). */
  @Post('route/dispatch')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:dispatch')
  async dispatchRoute() {
    const result = await this.carrierService.dispatch();
    return this.responseService.success(result, 'Ruta despachada');
  }

  /** Iniciar una parada de MI ruta (pending → in_progress). */
  @Post('route/stops/:stopId/start')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:settle')
  async startStop(@Param('stopId', ParseIntPipe) stopId: number) {
    const result = await this.carrierService.startStop(stopId);
    return this.responseService.success(result, 'Parada iniciada');
  }

  /** Liquidar una parada de MI ruta (result + montos). */
  @Post('route/stops/:stopId/settle')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:settle')
  async settleStop(
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: SettleStopDto,
  ) {
    const result = await this.carrierService.settleStop(stopId, dto);
    return this.responseService.success(result, 'Parada liquidada');
  }

  /** Liberar una parada de MI ruta (la reexpone al pool si aplica). */
  @Post('route/stops/:stopId/release')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:release')
  async releaseStop(
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: ReleaseStopDto,
  ) {
    const result = await this.carrierService.releaseStop(stopId, dto);
    return this.responseService.success(result, 'Parada liberada');
  }

  /** Cerrar MI ruta (cuadre de caja) + payout informativo devengado. */
  @Post('route/close')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:close')
  async closeRoute(@Body() dto: CloseDispatchRouteDto) {
    const result = await this.carrierService.close(dto);
    return this.responseService.success(result, 'Ruta cerrada');
  }

  /** Reordenar las paradas de MI ruta ("Aplicar orden óptimo" del mapa). */
  @Post('route/reorder')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:carrier:settle')
  async reorderStops(@Body() dto: ReorderStopsDto) {
    const result = await this.carrierService.reorderStops(dto);
    return this.responseService.success(result, 'Paradas reordenadas');
  }

  // ── Detalle de parada + editar dirección ─────────────────────────────────

  /**
   * Detalle de una parada de MI ruta: la remisión completa con ítems +
   * producto (mismo shape que el admin `GET /store/dispatch-notes/:id`) para que
   * el modal del repartidor lo lea sin un contrato nuevo.
   */
  @Get('route/stops/:stopId')
  @Permissions('store:carrier:stop:read')
  async getStopDetail(@Param('stopId', ParseIntPipe) stopId: number) {
    const result = await this.carrierService.getStopDetail(stopId);
    return this.responseService.success(result, 'Detalle de parada');
  }

  /**
   * Editar la dirección de entrega de una parada de MI ruta. Delega en el
   * re-snapshot del admin (solo display+mapa, NO toca inventario ni contabilidad).
   */
  @Patch('route/stops/:stopId/address')
  @Permissions('store:carrier:stop:update_address')
  async updateStopAddress(
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: UpdateDispatchNoteAddressDto,
  ) {
    const result = await this.carrierService.updateStopAddress(stopId, dto);
    return this.responseService.success(result, 'Dirección actualizada');
  }

  // ── Historial de rutas del carrier ───────────────────────────────────────

  /**
   * Historial paginado de MIS planillas (todos los estados, incl. closed/voided).
   * `routes` (plural) NO choca con `route` (singular) ni con `route/...`.
   */
  @Get('routes')
  @Permissions('store:carrier:route:read')
  async listMyRoutes(@Query() query: RouteHistoryQueryDto) {
    const { data, total, page, limit } =
      await this.carrierService.listMyRoutes(query);
    return this.responseService.paginated(
      data,
      total,
      page,
      limit,
      'Historial de planillas',
    );
  }

  /** Detalle de una de MIS planillas del historial (por id). */
  @Get('routes/:id')
  @Permissions('store:carrier:route:read')
  async getMyRouteById(@Param('id', ParseIntPipe) id: number) {
    const result = await this.carrierService.getMyRouteById(id);
    return this.responseService.success(result, 'Detalle de planilla');
  }
}
