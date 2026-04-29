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
import { QuotationsService } from './quotations.service';
import {
  CreateQuotationDto,
  UpdateQuotationDto,
  QuotationQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/quotations')
@UseGuards(PermissionsGuard)
export class QuotationsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:quotations:read')
  async findAll(@Query() query: QuotationQueryDto) {
    const result = await this.quotationsService.findAll(query);
    return this.responseService.success(
      result,
      'Cotizaciones obtenidas exitosamente',
    );
  }

  @Post()
  @Permissions('store:quotations:create')
  async create(@Body() dto: CreateQuotationDto) {
    const result = await this.quotationsService.create(dto);
    return this.responseService.created(
      result,
      'Cotización creada exitosamente',
    );
  }

  @Get('stats')
  @Permissions('store:quotations:read')
  async getStats() {
    const result = await this.quotationsService.getStats();
    return this.responseService.success(
      result,
      'Estadísticas de cotizaciones obtenidas',
    );
  }

  @Get(':id')
  @Permissions('store:quotations:read:one')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.findOne(id);
    return this.responseService.success(
      result,
      'Cotización obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:quotations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuotationDto,
  ) {
    const result = await this.quotationsService.update(id, dto);
    return this.responseService.updated(
      result,
      'Cotización actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:quotations:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.quotationsService.remove(id);
    return this.responseService.deleted('Cotización eliminada exitosamente');
  }

  @Post(':id/send')
  @Permissions('store:quotations:update')
  async send(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.send(id);
    return this.responseService.success(
      result,
      'Cotización enviada exitosamente',
    );
  }

  @Post(':id/accept')
  @Permissions('store:quotations:update')
  async accept(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.accept(id);
    return this.responseService.success(
      result,
      'Cotización aceptada exitosamente',
    );
  }

  @Post(':id/reject')
  @Permissions('store:quotations:update')
  async reject(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.reject(id);
    return this.responseService.success(
      result,
      'Cotización rechazada exitosamente',
    );
  }

  @Post(':id/cancel')
  @Permissions('store:quotations:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.cancel(id);
    return this.responseService.success(
      result,
      'Cotización cancelada exitosamente',
    );
  }

  @Post(':id/convert')
  @Permissions('store:quotations:convert')
  async convert(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.convertToOrder(id);
    return this.responseService.success(
      result,
      'Cotización convertida a orden exitosamente',
    );
  }

  @Post(':id/duplicate')
  @Permissions('store:quotations:create')
  async duplicate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.quotationsService.duplicate(id);
    return this.responseService.created(
      result,
      'Cotización duplicada exitosamente',
    );
  }
}
