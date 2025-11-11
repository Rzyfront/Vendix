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
import { ReturnOrdersService } from './return-orders.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { UpdateReturnOrderDto } from './dto/update-return-order.dto';
import { ReturnOrderQueryDto } from './dto/return-order-query.dto';

@Controller('orders/return-orders')
export class ReturnOrdersController {
  constructor(private readonly returnOrdersService: ReturnOrdersService) {}

  @Post()
  create(@Body() createReturnOrderDto: CreateReturnOrderDto) {
    return this.returnOrdersService.create(createReturnOrderDto);
  }

  @Get()
  findAll(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findAll(query);
  }

  @Get('draft')
  findDrafts(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByStatus('draft', query);
  }

  @Get('processed')
  findProcessed(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByStatus('processed', query);
  }

  @Get('purchase-returns')
  findPurchaseReturns(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByType('refund', query);
  }

  @Get('sales-returns')
  findSalesReturns(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByType('replacement', query);
  }

  @Get('partner/:partnerId')
  findByPartner(
    @Param('partnerId') partnerId: string,
    @Query() query: ReturnOrderQueryDto,
  ) {
    return this.returnOrdersService.findByPartner(+partnerId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.returnOrdersService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateReturnOrderDto: UpdateReturnOrderDto,
  ) {
    return this.returnOrdersService.update(+id, updateReturnOrderDto);
  }

  @Patch(':id/process')
  process(
    @Param('id') id: string,
    @Body()
    processData: {
      items: Array<{ id: number; action: string; location_id?: number }>;
    },
  ) {
    return this.returnOrdersService.process(+id, processData.items);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.returnOrdersService.cancel(+id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.returnOrdersService.remove(+id);
  }
}
