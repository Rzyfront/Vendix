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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '../../common/interfaces/authenticated-request.interface';
import { ResponseService } from '../../common/responses/response.service';

@Controller('orders')
@UseGuards(PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('orders:read')
  async findAll(@Query() query: OrderQueryDto) {
    try {
      const result = await this.ordersService.findAll(query);
      return this.responseService.success(
        result,
        'Órdenes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post()
  @Permissions('orders:create')
  async create(
    @Body() createOrderDto: CreateOrderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.ordersService.create(createOrderDto, req.user);
      return this.responseService.created(result, 'Orden creada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.ordersService.findOne(id);
      return this.responseService.success(
        result,
        'Orden obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('orders:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    try {
      const result = await this.ordersService.update(id, updateOrderDto);
      return this.responseService.updated(
        result,
        'Orden actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('orders:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.ordersService.remove(id);
      return this.responseService.deleted('Orden eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
