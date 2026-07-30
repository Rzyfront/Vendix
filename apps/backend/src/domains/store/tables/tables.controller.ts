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
 *   GET    /api/store/tables/:id/qr     QR code (public_url + qr_data_url)
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
 *
 * NO hay `try/catch` en ningún handler, y no debe volver a haberlo (QUI-571).
 * `TablesService` lanza excepciones tipadas (`VendixHttpException`,
 * `BadRequestException`) y el `AllExceptionsFilter` global
 * (`apps/backend/src/main.ts:55`) las convierte en el status HTTP real más
 * `error_code`. Atrapar el error y **devolverlo** con
 * `responseService.error(...)` hacía que Nest respondiera HTTP 200 con el
 * status verdadero escondido en el cuerpo (`{"success":false,…,"statusCode":409}`),
 * y cualquier cliente que mire el status leía un éxito donde hubo un rechazo.
 * `table-sessions.controller.ts` siempre siguió este patrón.
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
    const result = await this.tablesService.create(dto);
    return this.responseService.created(result, 'Mesa creada exitosamente');
  }

  @Get('floor-map')
  @Permissions('store:tables:read')
  async floorMap() {
    const data = await this.tablesService.floorMap();
    return this.responseService.success(data, 'Mapa de mesas obtenido');
  }

  @Get()
  @Permissions('store:tables:read')
  async findAll(@Query() query: TableQueryDto) {
    const result = await this.tablesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Mesas obtenidas exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:tables:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.tablesService.findOne(id);
    return this.responseService.success(result, 'Mesa obtenida exitosamente');
  }

  @Get(':id/qr')
  @Permissions('store:tables:read')
  async getQr(@Param('id', ParseIntPipe) id: number) {
    const result = await this.tablesService.getQr(id);
    return this.responseService.success(
      result,
      'QR de mesa generado exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:tables:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableDto,
  ) {
    const result = await this.tablesService.update(id, dto);
    return this.responseService.updated(result, 'Mesa actualizada exitosamente');
  }

  @Delete(':id')
  @Permissions('store:tables:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.tablesService.remove(id);
    return this.responseService.deleted('Mesa eliminada exitosamente');
  }
}
