import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { TablesService } from './tables.service';
import {
  CreateTableDto,
  UpdateTableDto,
  TableQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * TablesController (Restaurant Suite — Fase E)
 *
 * REST seam for the `tables` domain.
 *
 *   POST   /api/store/tables            create a table
 *   GET    /api/store/tables            list (paginated, filterable)
 *   GET    /api/store/tables/floor-map  one-shot floor projection
 *   GET    /api/store/tables/:id        detail + active session
 *   PATCH  /api/store/tables/:id        partial update
 *   DELETE /api/store/tables/:id        hard delete (rejected if sessions exist)
 *
 * Permission policy:
 *   - GET list/detail/floor-map → store:tables:read
 *   - POST create               → store:tables:create
 *   - PATCH update              → store:tables:update
 *   - DELETE                    → store:tables:delete
 *
 * The `floor-map` endpoint is intentionally placed BEFORE the `:id`
 * route in declaration order — NestJS resolves routes top-down and the
 * `:id` would otherwise capture "floor-map" as an id.
 */
@Controller('store/tables')
@UseGuards(PermissionsGuard)
export class TablesController {
  constructor(
    private readonly tablesService: TablesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:tables:create')
  async create(@Body() dto: CreateTableDto) {
    try {
      const result = await this.tablesService.create(dto);
      return this.responseService.created(
        result,
        'Mesa creada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al crear la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get('floor-map')
  @Permissions('store:tables:read')
  async floorMap() {
    try {
      const data = await this.tablesService.floorMap();
      return this.responseService.success(
        data,
        'Mapa de mesas obtenido',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener el mapa de mesas',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get()
  @Permissions('store:tables:read')
  async findAll(@Query() query: TableQueryDto) {
    try {
      const result = await this.tablesService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Mesas obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener las mesas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:tables:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.tablesService.findOne(id);
      return this.responseService.success(
        result,
        'Mesa obtenida exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:tables:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableDto,
  ) {
    try {
      const result = await this.tablesService.update(id, dto);
      return this.responseService.updated(
        result,
        'Mesa actualizada exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:tables:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.tablesService.remove(id);
      return this.responseService.deleted('Mesa eliminada exitosamente');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al eliminar la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
