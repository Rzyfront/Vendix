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
import { DispatchNotesService } from './dispatch-notes.service';
import { DispatchNoteFlowService } from './dispatch-note-flow/dispatch-note-flow.service';
import {
  CreateDispatchNoteDto,
  UpdateDispatchNoteDto,
  DispatchNoteQueryDto,
  CreateFromSalesOrderDto,
  VoidDispatchNoteDto,
  DeliverDispatchNoteDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/dispatch-notes')
@UseGuards(PermissionsGuard)
export class DispatchNotesController {
  constructor(
    private readonly dispatchNotesService: DispatchNotesService,
    private readonly dispatchNoteFlowService: DispatchNoteFlowService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:dispatch-notes:read')
  async findAll(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.findAll(query);
    return this.responseService.success(
      result,
      'Remisiones obtenidas exitosamente',
    );
  }

  @Post()
  @Permissions('store:dispatch-notes:create')
  async create(@Body() dto: CreateDispatchNoteDto) {
    const result = await this.dispatchNotesService.create(dto);
    return this.responseService.created(
      result,
      'Remisión creada exitosamente',
    );
  }

  @Get('stats')
  @Permissions('store:dispatch-notes:read')
  async getStats() {
    const result = await this.dispatchNotesService.getStats();
    return this.responseService.success(
      result,
      'Estadísticas de remisiones obtenidas',
    );
  }

  @Get('by-sales-order/:salesOrderId')
  @Permissions('store:dispatch-notes:read')
  async getBySalesOrder(
    @Param('salesOrderId', ParseIntPipe) sales_order_id: number,
  ) {
    const result =
      await this.dispatchNotesService.getBySalesOrder(sales_order_id);
    return this.responseService.success(
      result,
      'Remisiones por orden de venta obtenidas exitosamente',
    );
  }

  @Post('from-sales-order/:salesOrderId')
  @Permissions('store:dispatch-notes:create')
  async createFromSalesOrder(
    @Param('salesOrderId', ParseIntPipe) sales_order_id: number,
    @Body() dto: CreateFromSalesOrderDto,
  ) {
    const result = await this.dispatchNotesService.createFromSalesOrder(
      sales_order_id,
      dto,
    );
    return this.responseService.created(
      result,
      'Remisión creada desde orden de venta exitosamente',
    );
  }

  @Get('reports/pending')
  @UseGuards(PermissionsGuard)
  @Permissions('store:dispatch_notes:read')
  async getPendingInvoicing(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.getPendingInvoicing(query);
    return this.responseService.success(
      result,
      'Reporte de remisiones pendientes de facturación obtenido',
    );
  }

  @Get('reports/by-customer')
  @UseGuards(PermissionsGuard)
  @Permissions('store:dispatch_notes:read')
  async getByCustomerReport(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.getByCustomerReport(query);
    return this.responseService.success(
      result,
      'Reporte de remisiones por cliente obtenido',
    );
  }

  @Get('reports/profitability')
  @UseGuards(PermissionsGuard)
  @Permissions('store:dispatch_notes:read')
  async getProfitabilityReport(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.getProfitabilityReport(query);
    return this.responseService.success(
      result,
      'Reporte de rentabilidad obtenido',
    );
  }

  @Get(':id')
  @Permissions('store:dispatch-notes:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchNotesService.findOne(id);
    return this.responseService.success(
      result,
      'Remisión obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:dispatch-notes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDispatchNoteDto,
  ) {
    const result = await this.dispatchNotesService.update(id, dto);
    return this.responseService.updated(
      result,
      'Remisión actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:dispatch-notes:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.dispatchNotesService.remove(id);
    return this.responseService.deleted('Remisión eliminada exitosamente');
  }

  @Post(':id/confirm')
  @Permissions('store:dispatch-notes:update')
  async confirm(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchNoteFlowService.confirm(id);
    return this.responseService.success(
      result,
      'Remisión confirmada exitosamente',
    );
  }

  @Post(':id/deliver')
  @Permissions('store:dispatch-notes:update')
  async deliver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverDispatchNoteDto,
  ) {
    const result = await this.dispatchNoteFlowService.deliver(id, dto);
    return this.responseService.success(
      result,
      'Remisión entregada exitosamente',
    );
  }

  @Post(':id/void')
  @Permissions('store:dispatch-notes:update')
  async voidNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidDispatchNoteDto,
  ) {
    const result = await this.dispatchNoteFlowService.void(id, dto);
    return this.responseService.success(
      result,
      'Remisión anulada exitosamente',
    );
  }

  @Post(':id/invoice')
  @Permissions('store:dispatch-notes:update')
  async invoice(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchNoteFlowService.invoice(id);
    return this.responseService.success(
      result,
      'Remisión facturada exitosamente',
    );
  }
}
