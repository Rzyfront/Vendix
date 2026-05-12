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
} from '@nestjs/common';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { StockTransfersService } from './stock-transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';

// Base permissions (:create, :update, :read, :delete) are enforced per-method
// with @Permissions. The cross-store policy `store:stock-transfers:cross-store`
// is enforced CONDITIONALLY inside `StockTransfersService.validateTransferScope()`
// — only when from.store_id !== to.store_id AND inventory_mode === 'organizational'.
// Applying cross-store at the class level would block legitimate same-store transfers.

@Controller('store/stock-transfers')
@UseGuards(PermissionsGuard)
export class StockTransfersController {
  constructor(private readonly stockTransfersService: StockTransfersService) {}

  @Post()
  @Permissions('store:stock-transfers:create')
  create(@Body() createTransferDto: CreateTransferDto) {
    return this.stockTransfersService.create(createTransferDto);
  }

  @Post('complete')
  @Permissions('store:stock-transfers:create', 'store:stock-transfers:update')
  createAndComplete(@Body() createTransferDto: CreateTransferDto) {
    return this.stockTransfersService.createAndComplete(createTransferDto);
  }

  @Get('stats')
  @Permissions('store:stock-transfers:read')
  getStats() {
    return this.stockTransfersService.getStats();
  }

  @Get()
  @Permissions('store:stock-transfers:read')
  findAll(@Query() query: TransferQueryDto) {
    return this.stockTransfersService.findAll(query);
  }

  @Get('draft')
  @Permissions('store:stock-transfers:read')
  findDrafts(@Query() query: TransferQueryDto) {
    return this.stockTransfersService.findByStatus('draft', query);
  }

  @Get('in-transit')
  @Permissions('store:stock-transfers:read')
  findInTransit(@Query() query: TransferQueryDto) {
    return this.stockTransfersService.findByStatus('in_transit', query);
  }

  @Get('from-location/:locationId')
  @Permissions('store:stock-transfers:read')
  findByFromLocation(
    @Param('locationId') locationId: string,
    @Query() query: TransferQueryDto,
  ) {
    return this.stockTransfersService.findByFromLocation(+locationId, query);
  }

  @Get('to-location/:locationId')
  @Permissions('store:stock-transfers:read')
  findByToLocation(
    @Param('locationId') locationId: string,
    @Query() query: TransferQueryDto,
  ) {
    return this.stockTransfersService.findByToLocation(+locationId, query);
  }

  @Get('search-products')
  @Permissions('store:stock-transfers:read')
  async searchTransferableProducts(
    @Query('search') search: string,
    @Query('from_location_id') fromLocationId: string,
    @Query('to_location_id') toLocationId: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.stockTransfersService.searchTransferableProducts(
      search,
      +fromLocationId,
      +toLocationId,
      limit ? +limit : 10,
    );
    return { success: true, data: result };
  }

  @Get(':id')
  @Permissions('store:stock-transfers:read')
  findOne(@Param('id') id: string) {
    return this.stockTransfersService.findOne(+id);
  }

  @Patch(':id')
  @Permissions('store:stock-transfers:update')
  update(
    @Param('id') id: string,
    @Body() updateTransferDto: UpdateTransferDto,
  ) {
    return this.stockTransfersService.update(+id, updateTransferDto);
  }

  @Patch(':id/approve')
  @Permissions('store:stock-transfers:update')
  approve(@Param('id') id: string) {
    return this.stockTransfersService.approve(+id);
  }

  @Patch(':id/complete')
  @Permissions('store:stock-transfers:update')
  complete(
    @Param('id') id: string,
    @Body()
    completeData: { items: Array<{ id: number; quantity_received: number }> },
  ) {
    return this.stockTransfersService.complete(+id, completeData.items);
  }

  @Patch(':id/cancel')
  @Permissions('store:stock-transfers:update')
  cancel(@Param('id') id: string) {
    return this.stockTransfersService.cancel(+id);
  }

  @Delete(':id')
  @Permissions('store:stock-transfers:delete')
  remove(@Param('id') id: string) {
    return this.stockTransfersService.remove(+id);
  }
}
