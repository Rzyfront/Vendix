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
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, OrderQueryDto } from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { order_state_enum } from '@prisma/client';

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @RequirePermissions('orders.create')
  async create(@Body() createOrderDto: CreateOrderDto, @CurrentUser() user: any) {
    return this.ordersService.create(createOrderDto);
  }

  @Get()
  @RequirePermissions('orders.read')
  async findAll(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOne(id);
  }

  @Get('number/:orderNumber')
  @RequirePermissions('orders.read')
  async findByOrderNumber(@Param('orderNumber') orderNumber: string) {
    return this.ordersService.findByOrderNumber(orderNumber);
  }

  @Get('customer/:customerId')
  @RequirePermissions('orders.read')
  async findByCustomer(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findByCustomer(customerId, query);
  }

  @Get('store/:storeId')
  @RequirePermissions('orders.read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.findByStore(storeId, query);
  }

  @Patch(':id')
  @RequirePermissions('orders.update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderDto: UpdateOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.ordersService.update(id, updateOrderDto);
  }

  @Patch(':id/status')
  @RequirePermissions('orders.update')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
  @Body() body: { status: order_state_enum },
    @CurrentUser() user: any,
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }

  @Patch(':id/cancel')
  @RequirePermissions('orders.cancel')
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: any,
  ) {
    return this.ordersService.cancel(id, body.reason);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.ordersService.remove(id);
  }
}
