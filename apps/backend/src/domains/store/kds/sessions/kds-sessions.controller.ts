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
   * (a) Historial de consumos: una fila por insumo POR PEDIDO, con cantidad y
   * costo. Permite navegar del resumen al detalle.
   */
  @Get(':id/consumption-history')
  @Permissions('store:kds_sessions:read')
  async consumptionHistory(@Param('id', ParseIntPipe) id: number) {
    const result = await this.sessionsService.getConsumptionHistory(id);
    return this.responseService.success(result);
  }

  /**
   * (b) Resumen de consumos: una fila por insumo con cantidad y costo totales
   * del turno. En vivo mientras la sesión está abierta; tras cerrar, el valor
   * congelado vive en `kds_sessions.summary`.
   */
  @Get(':id/consumption-summary')
  @Permissions('store:kds_sessions:read')
  async consumptionSummary(@Param('id', ParseIntPipe) id: number) {
    const result = await this.sessionsService.buildConsumptionSummary(id);
    return this.responseService.success(result);
  }
}
