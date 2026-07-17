import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CarrierDeliveryService } from './carrier-delivery.service';
import { PoolQueryDto } from './dto/pool-query.dto';
import {
  SettleStopDto,
  ReleaseStopDto,
  CloseDispatchRouteDto,
  ReorderStopsDto,
} from '../dispatch-routes/dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

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
}
