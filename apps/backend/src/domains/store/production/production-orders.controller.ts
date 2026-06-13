import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ProductionOrdersService } from './production-orders.service';
import {
  CreateProductionOrderDto,
  UpdateProductionOrderDto,
  CompleteProductionOrderDto,
  ProductionOrderQueryDto,
} from './dto';

/**
 * Production Orders (Restaurant Suite — Fase C)
 *
 * Sub-recipe batch production flow:
 *   POST   /                       create draft
 *   GET    /                       list (paginated)
 *   GET    /stats                  dashboard counts
 *   GET    /:id                    detail (with recipe + items)
 *   PATCH  /:id                    edit notes (only when not final)
 *   POST   /:id/start              draft → in_progress
 *   POST   /:id/complete           in_progress/draft → completed (atomic FIFO)
 *   POST   /:id/cancel             draft/in_progress → cancelled
 */
@Controller('store/production-orders')
@UseGuards(PermissionsGuard)
export class ProductionOrdersController {
  constructor(
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:production_orders:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateProductionOrderDto) {
    try {
      const result = await this.productionOrdersService.create(dto);
      return this.responseService.created(
        result,
        'Orden de producción creada en estado draft',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al crear la orden de producción',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Get()
  @Permissions('store:production_orders:read')
  async findAll(@Query() query: ProductionOrderQueryDto) {
    try {
      const { data, total } = await this.productionOrdersService.findAll(query);
      return this.responseService.paginated(
        data,
        total,
        query.page ?? 1,
        query.limit ?? 25,
        'Órdenes de producción obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de producción',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('store:production_orders:read')
  async stats() {
    try {
      const result = await this.productionOrdersService.getStats();
      return this.responseService.success(
        result,
        'Estadísticas de producción obtenidas',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener estadísticas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:production_orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.productionOrdersService.findOne(id);
      return this.responseService.success(
        result,
        'Orden de producción obtenida',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al obtener la orden',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:production_orders:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductionOrderDto,
  ) {
    try {
      const result = await this.productionOrdersService.update(id, dto);
      return this.responseService.updated(
        result,
        'Orden de producción actualizada',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al actualizar la orden',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/start')
  @Permissions('store:production_orders:update')
  async start(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.productionOrdersService.start(id);
      return this.responseService.success(
        result,
        'Orden de producción en progreso',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al iniciar la orden',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/complete')
  @Permissions('store:production_orders:update')
  async complete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteProductionOrderDto,
  ) {
    try {
      const result = await this.productionOrdersService.complete(id, dto);
      return this.responseService.success(
        result,
        'Producción completada: stock generado y consumos registrados',
      );
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al completar la producción',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }

  @Post(':id/cancel')
  @Permissions('store:production_orders:update')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.productionOrdersService.cancel(id);
      return this.responseService.success(result, 'Orden de producción cancelada');
    } catch (error: any) {
      return this.responseService.error(
        error.message || 'Error al cancelar la orden',
        error.response?.message || error.message,
        error.status || 400,
        error.error_code,
      );
    }
  }
}
