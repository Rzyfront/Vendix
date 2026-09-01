import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { KdsSessionsService } from './kds-sessions.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CloseKdsSessionDto, OpenKdsSessionDto } from '../dto';

/**
 * Turnos de estación (QUI-651). La sesión se exige AL ACTUAR sobre un ticket,
 * no al entrar al tablero: leer no genera dato que necesite dueño. Misma
 * convención que caja.
 */
@Controller('store/kds-sessions')
@UseGuards(PermissionsGuard)
export class KdsSessionsController {
  constructor(
    private readonly sessionsService: KdsSessionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:kds_sessions:read')
  async findAll(@Query('kds_id') kdsId?: string) {
    const parsed = kdsId != null ? Number(kdsId) : undefined;
    const result = await this.sessionsService.findAll(
      Number.isFinite(parsed) ? parsed : undefined,
    );
    return this.responseService.success(result);
  }

  /**
   * Sesión abierta de una estación, o null. La UI lo consulta para decidir si
   * la primera acción de gestión debe pedir apertura.
   */
  @Get('open/:kdsId')
  @Permissions('store:kds_sessions:read')
  async findOpen(@Param('kdsId', ParseIntPipe) kdsId: number) {
    const result = await this.sessionsService.findOpenByKds(kdsId);
    return this.responseService.success(result);
  }

  @Post('open')
  @Permissions('store:kds_sessions:create')
  @HttpCode(HttpStatus.CREATED)
  async open(@Body() dto: OpenKdsSessionDto) {
    const result = await this.sessionsService.open(dto);
    return this.responseService.success(result, 'Sesión de estación abierta');
  }

  /**
   * Cierra el turno y congela el resumen de consumo en `summary`. Snapshot
   * inmutable: después del cierre no vuelve a recalcularse.
   */
  @Post(':id/close')
  @Permissions('store:kds_sessions:update')
  async close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseKdsSessionDto,
  ) {
    const result = await this.sessionsService.close(id, dto);
    return this.responseService.updated(result, 'Sesión de estación cerrada');
  }

  /**
   * Heartbeat — el frontend lo llama una vez por minuto mientras el
   * operador mantiene la sesión abierta. Refresca `last_seen_at`; sólo
   * el dueño del turno o un rol privilegiado pueden invocarlo.
   */
  @Post(':id/heartbeat')
  @Permissions('store:kds_sessions:update')
  async heartbeat(@Param('id', ParseIntPipe) id: number) {
    await this.sessionsService.heartbeat(id);
    return this.responseService.success({ id }, 'Heartbeat registrado');
  }

  /**
   * Toma forzada — cierra el turno abierto de otro operador y abre uno
   * nuevo para el caller. Sólo roles `owner`/`admin`/`super_admin`. La
   * validación de permisos finos vive en el servicio (chequea el rol, no
   * una fila de `permissions`).
   */
  @Post('force-take/:kdsId')
  @Permissions('store:kds_sessions:create')
  async forceTake(@Param('kdsId', ParseIntPipe) kdsId: number) {
    const result = await this.sessionsService.forceTake(kdsId);
    return this.responseService.success(result, 'Control de la estación transferido');
  }

  /**
   * (a) Historial de consumos: una fila por insumo POR PEDIDO, con la cantidad
   * consumida. ADR-10: el KDS no transporta dinero. Permite navegar del resumen
   * al detalle.
   */
  /**
   * Reporte de consumo de insumos por estación, agregable por KDS y por rango.
   *
   * Rutas literales ANTES de las paramétricas: `:id/...` capturaría `report` como
   * id si se declararan al revés.
   */
  @Get('report/consumption')
  @Permissions('store:kds_sessions:read')
  async consumptionReport(
    @Query('kds_id') kdsId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parsedKds = kdsId != null ? Number(kdsId) : undefined;
    const result = await this.sessionsService.getConsumptionReport({
      kds_id: Number.isFinite(parsedKds) ? parsedKds : undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return this.responseService.success(result);
  }

  /**
   * Consumo sin turno atribuido. Se expone aparte y no se esconde: es un caso
   * válido (el fire nunca se bloquea por falta de sesión), pero omitirlo haría
   * que el reporte por estación pareciera cuadrar contra el COGS total.
   */
  @Get('report/unattributed')
  @Permissions('store:kds_sessions:read')
  async unattributedConsumption(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const result = await this.sessionsService.getUnattributedConsumption({
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
    return this.responseService.success(result);
  }

  @Get(':id/consumption-history')
  @Permissions('store:kds_sessions:read')
  async consumptionHistory(@Param('id', ParseIntPipe) id: number) {
    const result = await this.sessionsService.getConsumptionHistory(id);
    return this.responseService.success(result);
  }

  /**
   * (b) Resumen de consumos: una fila por insumo con la cantidad total del
   * turno. ADR-10: sin dinero en el payload. En vivo mientras la sesión está
   * abierta; tras cerrar, el valor congelado vive en `kds_sessions.summary`.
   */
  @Get(':id/consumption-summary')
  @Permissions('store:kds_sessions:read')
  async consumptionSummary(@Param('id', ParseIntPipe) id: number) {
    const result = await this.sessionsService.buildConsumptionSummary(id);
    return this.responseService.success(result);
  }
}
