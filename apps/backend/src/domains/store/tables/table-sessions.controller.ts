import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { TableSessionsService } from './table-sessions.service';
import {
  OpenTableSessionDto,
  AddItemsToTableSessionDto,
  AssignCustomerDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * TableSessionsController (Restaurant Suite — Fase E)
 *
 * REST seam for the `table_sessions` domain (open checks).
 *
 *   POST  /api/store/table-sessions              open session (creates order draft)
 *   GET   /api/store/table-sessions/:id          session detail with current draft order
 *   POST  /api/store/table-sessions/:id/add-items append items to the draft order
 *   PATCH /api/store/table-sessions/:id/customer assign/detach the order customer
 *   POST  /api/store/table-sessions/:id/close    close the session (NOT the order)
 *
 * Permission policy:
 *   - GET detail  → store:table_sessions:read
 *   - POST open   → store:table_sessions:create
 *   - POST add-items / PATCH customer / close → store:table_sessions:update
 */
@Controller('store/table-sessions')
@UseGuards(PermissionsGuard)
export class TableSessionsController {
  constructor(
    private readonly tableSessionsService: TableSessionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:table_sessions:create')
  async open(@Body() dto: OpenTableSessionDto) {
    try {
      const result = await this.tableSessionsService.openSession(dto);
      return this.responseService.created(
        result,
        'Sesión de mesa abierta exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al abrir la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get(':id')
  @Permissions('store:table_sessions:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.tableSessionsService.findOne(id);
      return this.responseService.success(
        result,
        'Sesión de mesa obtenida exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la sesión de mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/add-items')
  @Permissions('store:table_sessions:update')
  async addItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddItemsToTableSessionDto,
  ) {
    try {
      const result = await this.tableSessionsService.addItems(id, dto);
      return this.responseService.updated(
        result,
        'Items agregados a la cuenta',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al agregar items a la cuenta',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':id/customer')
  @Permissions('store:table_sessions:update')
  async assignCustomer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignCustomerDto,
  ) {
    try {
      const result = await this.tableSessionsService.assignCustomer(
        id,
        dto.customer_id,
      );
      return this.responseService.updated(
        result,
        dto.customer_id == null
          ? 'Cliente desasignado de la cuenta'
          : 'Cliente asignado a la cuenta',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al asignar el cliente a la cuenta',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/close')
  @Permissions('store:table_sessions:update')
  async close(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.tableSessionsService.closeSession(id);
      return this.responseService.updated(
        result,
        'Sesión de mesa cerrada',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al cerrar la mesa',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
