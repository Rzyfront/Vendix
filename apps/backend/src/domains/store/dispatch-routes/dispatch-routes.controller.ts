import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { DispatchRoutesService } from './dispatch-routes.service';
import {
  CreateDispatchRouteDto,
  UpdateDispatchRouteDto,
  DispatchRouteQueryDto,
  AddStopsDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/dispatch-routes')
@UseGuards(PermissionsGuard)
export class DispatchRoutesController {
  constructor(
    private readonly dispatchRoutesService: DispatchRoutesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:dispatch_routes:read')
  async findAll(@Query() query: DispatchRouteQueryDto) {
    const result = await this.dispatchRoutesService.findAll(query);
    return this.responseService.success(
      result,
      'Planillas obtenidas exitosamente',
    );
  }

  @Get('stats')
  @Permissions('store:dispatch_routes:read')
  async getStats() {
    const result = await this.dispatchRoutesService.getStats();
    return this.responseService.success(
      result,
      'Estadísticas de planillas obtenidas',
    );
  }

  /**
   * Plan Despacho Economía — FASE 8 paso 24.
   * Monitor económico de planillas: por cada ruta muestra recaudo,
   * ingreso flete (414505), costo transporte (523550), margen flete
   * (= ingreso flete − costo transporte) y estado de liquidación.
   */
  @Get('monitor')
  @Permissions('store:dispatch_routes:read')
  async getMonitor(@Query() query: any) {
    const result = await this.dispatchRoutesService.getMonitor({
      page: Number(query?.page ?? 1),
      limit: Number(query?.limit ?? 20),
      store_id: query?.store_id ? Number(query.store_id) : undefined,
    });
    return this.responseService.success(
      result,
      'Monitor de planillas obtenido',
    );
  }

  /**
   * Lists dispatch notes that are eligible to be added to a new planilla
   * stop. Excludes notes that are already attached to a non-released stop
   * of a non-draft route, voided, or have been hard-deleted. This is the
   * canonical source for the wizard's stop picker — the legacy
   * `/dispatch-notes?status=confirmed` endpoint returns ALL confirmed
   * notes (including those already locked in active routes) and triggers
   * 500 errors when the operator tries to assign them.
   */
  @Get('available-notes')
  @Permissions('store:dispatch_routes:read')
  async listAvailableNotes(@Query('search') search?: string) {
    const result = await this.dispatchRoutesService.listAvailableNotes(
      search,
    );
    return this.responseService.success(
      result,
      'Remisiones disponibles para planilla',
    );
  }

  @Get(':id')
  @Permissions('store:dispatch_routes:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchRoutesService.findOne(id);
    return this.responseService.success(result, 'Planilla obtenida');
  }

  /**
   * Map view: not-yet-delivered stops (`pending` / `in_progress`) with their
   * resolved coordinates plus the route origin, for rendering the suggested
   * route on the planilla detail map. Stops whose coordinates cannot be
   * resolved are returned under `unlocated[]`.
   */
  @Get(':id/map-stops')
  @Permissions('store:dispatch_routes:read')
  async getMapStops(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchRoutesService.getMapStops(id);
    return this.responseService.success(
      result,
      'Paradas del mapa obtenidas',
    );
  }

  @Post()
  @Permissions('store:dispatch_routes:create')
  async create(@Body() dto: CreateDispatchRouteDto) {
    const result = await this.dispatchRoutesService.create(dto);
    return this.responseService.created(result, 'Planilla creada exitosamente');
  }

  @Patch(':id')
  @Permissions('store:dispatch_routes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDispatchRouteDto,
  ) {
    const result = await this.dispatchRoutesService.update(id, dto);
    return this.responseService.success(result, 'Planilla actualizada');
  }

  @Post(':id/stops')
  @Permissions('store:dispatch_routes:update')
  async addStops(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddStopsDto,
  ) {
    const result = await this.dispatchRoutesService.addStops(id, dto);
    return this.responseService.success(result, 'Paradas agregadas a la planilla');
  }

  @Delete(':id')
  @Permissions('store:dispatch_routes:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchRoutesService.remove(id);
    return this.responseService.success(result, 'Planilla eliminada');
  }
}
