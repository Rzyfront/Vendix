import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ManufacturingOrdersService } from './manufacturing-orders.service';
import {
  CompleteManufacturingOrderDto,
  CreateManufacturingOrderDto,
  ManufacturingOrderQueryDto,
  UpdateManufacturingOrderDto,
} from '../dto';

/**
 * Órdenes de producción de manufactura.
 * Las acciones release/start/complete/cancel exigen `orders:update`.
 * Sin try/catch: las excepciones llegan al filtro global con su status real.
 */
@Controller('store/manufacturing/orders')
@UseGuards(PermissionsGuard)
export class ManufacturingOrdersController {
  constructor(
    private readonly ordersService: ManufacturingOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:manufacturing:orders:read')
  async findAll(@Query() query: ManufacturingOrderQueryDto) {
    const result = await this.ordersService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Órdenes de producción obtenidas exitosamente',
    );
  }

  @Post()
  @Permissions('store:manufacturing:orders:create')
  async create(@Body() dto: CreateManufacturingOrderDto) {
    const result = await this.ordersService.create(dto);
    return this.responseService.created(
      result,
      'Orden de producción creada en borrador',
    );
  }

  @Get(':id')
  @Permissions('store:manufacturing:orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.ordersService.findOne(id);
    return this.responseService.success(
      result,
      'Orden de producción obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:manufacturing:orders:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateManufacturingOrderDto,
  ) {
    const result = await this.ordersService.update(id, dto);
    return this.responseService.updated(
      result,
      'Orden de producción actualizada exitosamente',
    );
  }

  @Post(':id/release')
  @Permissions('store:manufacturing:orders:update')
  async release(@Param('id', ParseIntPipe) id: number) {
    const result = await this.ordersService.release(id);
    return this.responseService.updated(result, 'Orden de producción liberada');
  }

  @Post(':id/start')
  @Permissions('store:manufacturing:orders:update')
  async start(@Param('id', ParseIntPipe) id: number) {
    const result = await this.ordersService.start(id);
    return this.responseService.updated(result, 'Orden de producción iniciada');
  }

  @Post(':id/complete')
  @Permissions('store:manufacturing:orders:update')
  async complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteManufacturingOrderDto,
  ) {
    const result = await this.ordersService.complete(id, dto);
    return this.responseService.updated(
      result,
      'Producción registrada exitosamente',
    );
  }

  @Post(':id/cancel')
  @Permissions('store:manufacturing:orders:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const result = await this.ordersService.cancel(id);
    return this.responseService.updated(result, 'Orden de producción cancelada');
  }

  @Get(':id/shortages')
  @Permissions('store:manufacturing:orders:read')
  async shortages(@Param('id', ParseIntPipe) id: number) {
    const result = await this.ordersService.shortages(id);
    return this.responseService.success(
      result,
      'Faltantes calculados exitosamente',
    );
  }
}
