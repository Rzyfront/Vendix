import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { SchedulingService } from './scheduling.service';
import {
  SchedulingCalendarQueryDto,
  SchedulingListQueryDto,
  toSchedulingFilters,
} from './dto/scheduling-query.dto';

/**
 * Órdenes → Programación y Agenda (agenda-unificada F1). Solo lectura: cada
 * acción sobre un evento va al endpoint de su módulo dueño.
 *
 * Basta con leer una de las fuentes (los permisos se evalúan con "alguno de");
 * el servicio omite las fuentes que la industria, el permiso o el ajuste de la
 * tienda no habilitan, así que este controlador no lleva `@IndustryModule`.
 */
@Controller('store/scheduling')
@UseGuards(PermissionsGuard)
@Permissions('store:reservations:read', 'store:scheduled_orders:read')
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly responseService: ResponseService,
  ) {}

  /** Tipos habilitados, estados y personal para armar los filtros. */
  @Get('sources')
  async sources() {
    const data = await this.scheduling.getSources();
    return this.responseService.success(data, 'Fuentes de programación obtenidas');
  }

  /** Tabla de Programación: paginada en servidor. */
  @Get('events')
  async events(@Query() query: SchedulingListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.scheduling.list(toSchedulingFilters(query), page, limit);
    return this.responseService.paginated(
      result.data,
      result.total,
      page,
      limit,
      'Programación obtenida',
      undefined,
      { truncated: result.truncated, types: result.types },
    );
  }

  /** Agenda: eventos del rango visible del calendario. */
  @Get('calendar')
  async calendar(@Query() query: SchedulingCalendarQueryDto) {
    const result = await this.scheduling.calendar({
      ...toSchedulingFilters(query),
      from: query.from,
      to: query.to,
    });
    return this.responseService.success(result, 'Agenda obtenida');
  }
}
