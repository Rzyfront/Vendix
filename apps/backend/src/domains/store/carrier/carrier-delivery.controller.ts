import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CarrierDeliveryService } from './carrier-delivery.service';
import { PoolQueryDto } from './dto/pool-query.dto';
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
 * Los endpoints de EJECUCIÓN (dispatch/settle/release/close) son de la Fase B7;
 * este controller queda listo para extenderse con ellos.
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
}
