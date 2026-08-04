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
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { MenusService } from './menus.service';
import {
  CreateMenuDto,
  MenuQueryDto,
  UpdateMenuDto,
} from './dto';

/**
 * Store-scoped CRUD for Menus (Restaurant Suite — Fase G).
 *
 * Routes:
 *  POST  /api/store/menus
 *  GET   /api/store/menus
 *  GET   /api/store/menus/:id          simple menu row
 *  GET   /api/store/menus/:id/full     menu + sections + items + windows
 *  PATCH /api/store/menus/:id
 *  DELETE /api/store/menus/:id         soft delete (is_active=false)
 *
 * Permission policy:
 *  read/create/update/delete → store:menus:read|create|update|delete
 */
@Controller('store/menus')
@UseGuards(PermissionsGuard)
export class MenusController {
  constructor(
    private readonly menusService: MenusService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('stats')
  @Permissions('store:menus:read')
  async stats() {
    try {
      const data = await this.menusService.getStats();
      return this.responseService.success(data, 'Estadísticas de cartas');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener estadísticas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post()
  @Permissions('store:menus:create')
  async create(@Body() dto: CreateMenuDto) {
    // Sin try/catch: dejamos que VendixHttpException(MENU_DUP_NAME) se
    // propague al AllExceptionsFilter global, que devuelve HTTP 409 nativo
    // con body { statusCode, error_code, message, ... }. El handler
    // anterior atrapaba la excepción y devolvía HTTP 200 con success:false
    // en el body, lo que hacía que el frontend (HttpClient desempaca
    // res.data sin chequear success) mostrara el toast "Carta creada"
    // falsamente. Mismo patrón que el resto de controllers del repo.
    const data = await this.menusService.create(dto);
    return this.responseService.created(data, 'Menú creado exitosamente');
  }

  @Get()
  @Permissions('store:menus:read')
  async findAll(@Query() query: MenuQueryDto) {
    try {
      const { data, meta } = await this.menusService.findAll(query);
      return this.responseService.paginated(
        data,
        meta.total,
        meta.page,
        meta.limit,
        'Menús obtenidos exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener los menús',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/full')
  @Permissions('store:menus:read')
  async findFull(@Param('id', ParseIntPipe) id: number) {
    try {
      const data = await this.menusService.findFull(id);
      return this.responseService.success(data, 'Menú completo obtenido');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener el menú',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get(':id')
  @Permissions('store:menus:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const data = await this.menusService.findOne(id);
      return this.responseService.success(data, 'Menú obtenido exitosamente');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener el menú',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:menus:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMenuDto,
  ) {
    try {
      const data = await this.menusService.update(id, dto);
      return this.responseService.updated(data, 'Menú actualizado');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar el menú',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:menus:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.menusService.softDelete(id);
      return this.responseService.deleted('Menú desactivado');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al desactivar el menú',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
