import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { MenuAvailabilityService } from './menu-availability.service';
import {
  CreateAvailabilityWindowDto,
  UpdateAvailabilityWindowDto,
} from './dto';

/**
 * Menu-level availability windows. Section-scoped windows are created by
 * passing `menu_section_id` in the body; the controller accepts both
 * shapes transparently.
 */
@Controller('store/menus/:menuId/availability-windows')
@UseGuards(PermissionsGuard)
export class MenuAvailabilityController {
  constructor(
    private readonly availabilityService: MenuAvailabilityService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:menus:read')
  async list(@Param('menuId', ParseIntPipe) menuId: number) {
    try {
      const data = await this.availabilityService.listForMenu(menuId);
      return this.responseService.success(data, 'Ventanas de disponibilidad');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener ventanas',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post()
  @Permissions('store:menus:update')
  async create(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Body() dto: CreateAvailabilityWindowDto,
  ) {
    try {
      const data = await this.availabilityService.create(menuId, dto);
      return this.responseService.created(data, 'Ventana creada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al crear la ventana',
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
    @Body() dto: UpdateAvailabilityWindowDto,
  ) {
    try {
      const data = await this.availabilityService.update(id, dto);
      return this.responseService.updated(data, 'Ventana actualizada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar la ventana',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:menus:update')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.availabilityService.delete(id);
      return this.responseService.deleted('Ventana eliminada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al eliminar la ventana',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
