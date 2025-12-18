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
import { StockTransfersService } from './stock-transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';

@Controller('store/orders/stock-transfers')
export class StockTransfersController {
  constructor(private readonly stockTransfersService: StockTransfersService) {}

  @Post()
  create(@Body() createTransferDto: CreateTransferDto) {
    return this.stockTransfersService.create(createTransferDto);
  }

  @Get()
  findAll(@Query() query: TransferQueryDto) {
    return this.stockTransfersService.findAll(query);
  }

  @Get('draft')
  findDrafts(@Query() query: TransferQueryDto) {
    return this.stockTransfersService.findByStatus('draft', query);
  }

  @Get('in-transit')
  findInTransit(@Query() query: TransferQueryDto) {
    return this.stockTransfersService.findByStatus('in_transit', query);
  }

  @Get('from-location/:locationId')
  findByFromLocation(
    @Param('locationId') locationId: string,
    @Query() query: TransferQueryDto,
  ) {
    return this.stockTransfersService.findByFromLocation(+locationId, query);
  }

  @Get('to-location/:locationId')
  findByToLocation(
    @Param('locationId') locationId: string,
    @Query() query: TransferQueryDto,
  ) {
    return this.stockTransfersService.findByToLocation(+locationId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stockTransfersService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTransferDto: UpdateTransferDto,
  ) {
    return this.stockTransfersService.update(+id, updateTransferDto);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string) {
    return this.stockTransfersService.approve(+id);
  }

  @Patch(':id/start')
  startTransfer(@Param('id') id: string) {
    return this.stockTransfersService.startTransfer(+id);
  }

  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @Body()
    completeData: { items: Array<{ id: number; quantity_received: number }> },
  ) {
    return this.stockTransfersService.complete(+id, completeData.items);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.stockTransfersService.cancel(+id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.stockTransfersService.remove(+id);
  }
}
