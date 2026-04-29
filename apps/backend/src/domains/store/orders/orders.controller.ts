import {
  Controller,
  Get,
  Post,
  Put,
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
import {
  CreateOrderDto,
  UpdateOrderDto,
  OrderQueryDto,
  UpdateOrderItemsDto,
} from './dto';
import { AssignShippingMethodDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { OrderEtaService } from './services/order-eta.service';
import { SettingsService } from '../settings/settings.service';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { EcommercePrismaService } from 'src/prisma/services/ecommerce-prisma.service';
import { ApiOperation, ApiQuery } from '@nestjs/swagger';

@Controller('store/orders')
@UseGuards(PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly responseService: ResponseService,
    private readonly orderEtaService: OrderEtaService,
    private readonly settingsService: SettingsService,
    private readonly prisma: StorePrismaService,
    private readonly ecommercePrisma: EcommercePrismaService,
  ) {}

  @Get()
  @Permissions('store:orders:read')
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
  @Permissions('store:orders:create')
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

  @Get('stats')
  @Permissions('store:orders:read')
  async getStats() {
    try {
      const result = await this.ordersService.getStats();
      return this.responseService.success(
        result,
        'Estadísticas de órdenes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener estadísticas de órdenes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('preview-eta')
  @Permissions('store:orders:read')
  @ApiOperation({ summary: 'Preview estimated preparation and delivery time' })
  @ApiQuery({ name: 'cart_id', required: false, type: String })
  @ApiQuery({ name: 'shipping_method_id', required: false, type: String })
  async previewEta(
    @Query('cart_id') cartId?: string,
    @Query('shipping_method_id') shippingMethodId?: string,
  ) {
    try {
      let items: { preparation_time_minutes: number | null }[] = [];
      let transitMinutes = 0;

      if (cartId) {
        const cartItems = await this.ecommercePrisma.cart_items.findMany({
          where: { cart_id: +cartId },
          include: {
            product: { select: { preparation_time_minutes: true } },
          },
        });
        items = cartItems.map((ci: any) => ({
          preparation_time_minutes:
            ci.product?.preparation_time_minutes ?? null,
        }));
      }

      if (shippingMethodId) {
        const method = await this.prisma.shipping_methods.findUnique({
          where: { id: +shippingMethodId },
          select: { transit_time_minutes: true },
        });
        transitMinutes = method?.transit_time_minutes ?? 0;
      }

      const settings = await this.settingsService.getSettings();

      const eta = this.orderEtaService.computeEta(
        items,
        transitMinutes,
        (settings as any)?.operations,
        new Date(),
      );

      return this.responseService.success(eta, 'ETA preview calculated');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error computing ETA preview',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:orders:read')
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

  @Get(':id/timeline')
  @Permissions('store:orders:read')
  async getTimeline(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.ordersService.getTimeline(id);
      return this.responseService.success(
        result,
        'Línea de tiempo de la orden obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la línea de tiempo de la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:orders:update')
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

  @Put(':id/items')
  @UseGuards(RolesGuard)
  @Roles('owner', 'admin', 'OWNER', 'ADMIN')
  @Permissions('store:orders:update')
  async updateOrderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderItemsDto,
  ) {
    try {
      const result = await this.ordersService.updateOrderItems(id, dto);
      return this.responseService.updated(
        result,
        'Items de la orden actualizados exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar los items de la orden',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/shipping')
  @Permissions('store:orders:update')
  async assignShipping(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignShippingMethodDto,
  ) {
    try {
      const result = await this.ordersService.assignShipping(id, dto);
      return this.responseService.updated(
        result,
        'Método de envío asignado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al asignar método de envío',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:orders:delete')
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
