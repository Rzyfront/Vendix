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

@Controller('orders/sales-orders')
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  create(@Body() createSalesOrderDto: CreateSalesOrderDto) {
    return this.salesOrdersService.create(createSalesOrderDto);
  }

  @Get()
  findAll(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findAll(query);
  }

  @Get('draft')
  findDrafts(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findByStatus('draft', query);
  }

  @Get('confirmed')
  findConfirmed(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findByStatus('confirmed', query);
  }

  @Get('shipped')
  findShipped(@Query() query: SalesOrderQueryDto) {
    return this.salesOrdersService.findByStatus('shipped', query);
  }

  @Get('customer/:customerId')
  findByCustomer(
    @Param('customerId') customerId: string,
    @Query() query: SalesOrderQueryDto,
  ) {
    return this.salesOrdersService.findByCustomer(+customerId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.salesOrdersService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateSalesOrderDto: UpdateSalesOrderDto,
  ) {
    return this.salesOrdersService.update(+id, updateSalesOrderDto);
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.salesOrdersService.confirm(+id);
  }

  @Patch(':id/ship')
  ship(
    @Param('id') id: string,
    @Body()
    shipData: { items: Array<{ id: number; quantity_shipped: number }> },
  ) {
    return this.salesOrdersService.ship(+id, shipData.items);
  }

  @Patch(':id/invoice')
  invoice(@Param('id') id: string) {
    return this.salesOrdersService.invoice(+id);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.salesOrdersService.cancel(+id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.salesOrdersService.remove(+id);
  }
}
