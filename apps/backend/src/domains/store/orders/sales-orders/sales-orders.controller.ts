import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderQueryDto } from './dto/sales-order-query.dto';

@Controller('store/orders/sales-orders')
@UseGuards(PermissionsGuard)
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  @Permissions('store:orders:sales_orders:create')
  create(@Body() createSalesOrderDto: CreateSalesOrderDto) {
    return this.salesOrdersService.create(createSalesOrderDto);
  }

  @Get()
  @Permissions('store:orders:sales_orders:read')
  findAll(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findAll(query);
  }

  @Get('draft')
  @Permissions('store:orders:sales_orders:read')
  findDrafts(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findByStatus('draft', query);
  }

  @Get('confirmed')
  @Permissions('store:orders:sales_orders:read')
  findConfirmed(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findByStatus('confirmed', query);
  }

  @Get('shipped')
  @Permissions('store:orders:sales_orders:read')
  findShipped(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findByStatus('shipped', query);
  }

  @Get('customer/:customerId')
  @Permissions('store:orders:sales_orders:read')
  findByCustomer(
    @Param('customerId') customerId: string,
    @Query() query: SalesOrderQueryDto,
  ) {
    return this.salesOrdersService.findByCustomer(+customerId, query);
  }

  @Get(':id')
  @Permissions('store:orders:sales_orders:read')
  findOne(@Param('id') id: string) {
    return this.salesOrdersService.findOne(+id);
  }

  @Patch(':id')
  @Permissions('store:orders:sales_orders:update')
  update(
    @Param('id') id: string,
    @Body() updateSalesOrderDto: UpdateSalesOrderDto,
  ) {
    return this.salesOrdersService.update(+id, updateSalesOrderDto);
  }

  @Patch(':id/confirm')
  @Permissions('store:orders:sales_orders:confirm')
  confirm(@Param('id') id: string) {
    return this.salesOrdersService.confirm(+id);
  }

  @Patch(':id/ship')
  @Permissions('store:orders:sales_orders:ship')
  ship(
    @Param('id') id: string,
    @Body()
    shipData: { items: Array<{ id: number; quantity_shipped: number }> },
  ) {
    return this.salesOrdersService.ship(+id, shipData.items);
  }

  @Patch(':id/invoice')
  @Permissions('store:orders:sales_orders:invoice')
  invoice(@Param('id') id: string) {
    return this.salesOrdersService.invoice(+id);
  }

  @Patch(':id/cancel')
  @Permissions('store:orders:sales_orders:cancel')
  cancel(@Param('id') id: string) {
    return this.salesOrdersService.cancel(+id);
  }

  @Delete(':id')
  @Permissions('store:orders:sales_orders:delete')
  remove(@Param('id') id: string) {
    return this.salesOrdersService.remove(+id);
  }
}
