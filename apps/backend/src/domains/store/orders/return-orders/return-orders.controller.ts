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
import { ReturnOrdersService } from './return-orders.service';
import { CreateReturnOrderDto } from './dto/create-return-order.dto';
import { UpdateReturnOrderDto } from './dto/update-return-order.dto';
import { ReturnOrderQueryDto } from './dto/return-order-query.dto';

@Controller('store/orders/return-orders')
@UseGuards(PermissionsGuard)
export class ReturnOrdersController {
  constructor(private readonly returnOrdersService: ReturnOrdersService) {}

  @Post()
  @Permissions('store:orders:return_orders:create')
  create(@Body() createReturnOrderDto: CreateReturnOrderDto) {
    return this.returnOrdersService.create(createReturnOrderDto);
  }

  @Get()
  @Permissions('store:orders:return_orders:read')
  findAll(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findAll(query);
  }

  @Get('draft')
  @Permissions('store:orders:return_orders:read')
  findDrafts(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByStatus('draft', query);
  }

  @Get('processed')
  @Permissions('store:orders:return_orders:read')
  findProcessed(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByStatus('processed', query);
  }

  @Get('purchase-returns')
  @Permissions('store:orders:return_orders:read')
  findPurchaseReturns(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByType('refund', query);
  }

  @Get('sales-returns')
  @Permissions('store:orders:return_orders:read')
  findSalesReturns(@Query() query: ReturnOrderQueryDto) {
    return this.returnOrdersService.findByType('replacement', query);
  }

  @Get('partner/:partnerId')
  @Permissions('store:orders:return_orders:read')
  findByPartner(
    @Param('partnerId') partnerId: string,
    @Query() query: ReturnOrderQueryDto,
  ) {
    return this.returnOrdersService.findByPartner(+partnerId, query);
  }

  @Get(':id')
  @Permissions('store:orders:return_orders:read')
  findOne(@Param('id') id: string) {
    return this.returnOrdersService.findOne(+id);
  }

  @Patch(':id')
  @Permissions('store:orders:return_orders:update')
  update(
    @Param('id') id: string,
    @Body() updateReturnOrderDto: UpdateReturnOrderDto,
  ) {
    return this.returnOrdersService.update(+id, updateReturnOrderDto);
  }

  @Patch(':id/process')
  @Permissions('store:orders:return_orders:process')
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
  @Permissions('store:orders:return_orders:cancel')
  cancel(@Param('id') id: string) {
    return this.returnOrdersService.cancel(+id);
  }

  @Delete(':id')
  @Permissions('store:orders:return_orders:delete')
  remove(@Param('id') id: string) {
    return this.returnOrdersService.remove(+id);
  }
}
