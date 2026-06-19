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

  @Get(':id')
  @Permissions('store:dispatch_routes:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchRoutesService.findOne(id);
    return this.responseService.success(result, 'Planilla obtenida');
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
