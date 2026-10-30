import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { ScheduledOrdersService } from './scheduled-orders.service';
import { AgendaQueryDto, RescheduleDto, TransitionScheduleDto } from './dto/scheduled-orders.dto';

/**
 * Agenda, transiciones y reprogramación. Se registra DESPUÉS de
 * `FulfillmentExceptionsController` para que `GET availability|exceptions`
 * no caiga en `GET :id`.
 */
@Controller('store/scheduled-orders')
@UseGuards(PermissionsGuard)
export class ScheduledOrdersController {
  constructor(
    private readonly scheduledOrders: ScheduledOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('agenda')
  @Permissions('store:scheduled_orders:read')
  async agenda(@Query() query: AgendaQueryDto) {
    const rows = await this.scheduledOrders.getAgenda(query);
    return this.responseService.success(rows, 'Agenda obtenida');
  }

  @Get(':id')
  @Permissions('store:scheduled_orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const row = await this.scheduledOrders.findOne(id);
    return this.responseService.success(row, 'Pedido programado obtenido');
  }

  @Patch(':id/status')
  @Permissions('store:scheduled_orders:update')
  async transition(@Param('id', ParseIntPipe) id: number, @Body() dto: TransitionScheduleDto) {
    const row = await this.scheduledOrders.transition(id, dto.status, dto.note);
    return this.responseService.success(row, 'Estado actualizado');
  }

  @Patch(':id/reschedule')
  @Permissions('store:scheduled_orders:reschedule')
  async reschedule(@Param('id', ParseIntPipe) id: number, @Body() dto: RescheduleDto) {
    const row = await this.scheduledOrders.reschedule(id, dto);
    return this.responseService.success(row, 'Pedido reprogramado');
  }
}
