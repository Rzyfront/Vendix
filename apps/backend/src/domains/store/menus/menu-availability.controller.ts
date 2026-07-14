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
 *
 * NOTA: sin try/catch. Las VendixHttpException del servicio (p.ej.
 * MENU_AVAILABILITY_INVALID_TIME → 422) se propagan al AllExceptionsFilter
 * global, que fija el HTTP status real y el error_code. Envolverlas aquí con
 * responseService.error() devolvía 200/201 con un body {statusCode:422}, y
 * Angular HttpClient —que sólo rechaza respuestas no-2xx— lo interpretaba como
 * éxito (falso positivo en el formulario de horarios).
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
    const data = await this.availabilityService.listForMenu(menuId);
    return this.responseService.success(data, 'Ventanas de disponibilidad');
  }

  @Post()
  @Permissions('store:menus:update')
  async create(
    @Param('menuId', ParseIntPipe) menuId: number,
    @Body() dto: CreateAvailabilityWindowDto,
  ) {
    const data = await this.availabilityService.create(menuId, dto);
    return this.responseService.created(data, 'Ventana creada');
  }

  @Patch(':id')
  @Permissions('store:menus:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAvailabilityWindowDto,
  ) {
    const data = await this.availabilityService.update(id, dto);
    return this.responseService.updated(data, 'Ventana actualizada');
  }

  @Delete(':id')
  @Permissions('store:menus:update')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.availabilityService.delete(id);
    return this.responseService.deleted('Ventana eliminada');
  }
}
