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
import {
  parseIdList,
  parseOptionalId,
  parseRequiredId,
} from './transfer-query-params';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { UpdateTransferDto } from './dto/update-transfer.dto';
import { TransferQueryDto } from './dto/transfer-query.dto';
import { CompleteTransferDto } from './dto/complete-transfer.dto';
import {
  CloseTransferWithLossDto,
  DispatchTransferDto,
  ReceiveTransferDto,
} from './dto/transfer-advanced.dto';

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

  /** P3 — transporte, conductores, métodos de envío y categorías del origen. */
  @Get('advanced-options')
  @Permissions('store:stock-transfers:read')
  async getAdvancedOptions(@Query('from_location_id') fromLocationId: string) {
    const data = await this.stockTransfersService.getAdvancedOptions(
      parseRequiredId(fromLocationId, 'from_location_id'),
    );
    return { success: true, data };
  }

  /** P3 — lotes de los productos en la bodega de origen (FEFO, D5). */
  @Get('batches')
  @Permissions('store:stock-transfers:read')
  async getTransferBatches(
    @Query('from_location_id') fromLocationId: string,
    @Query('product_ids') productIds?: string,
  ) {
    const data = await this.stockTransfersService.getTransferBatches(
      parseRequiredId(fromLocationId, 'from_location_id'),
      parseIdList(productIds),
    );
    return { success: true, data };
  }

  /** P3 — todo el stock disponible de la bodega de origen (por categoría). */
  @Get('location-stock')
  @Permissions('store:stock-transfers:read')
  async getLocationStock(
    @Query('from_location_id') fromLocationId: string,
    @Query('to_location_id') toLocationId?: string,
    @Query('category_id') categoryId?: string,
    @Query('limit') limit?: string,
    @Query('product_ids') productIds?: string,
  ) {
    const page = await this.stockTransfersService.getLocationStock(
      parseRequiredId(fromLocationId, 'from_location_id'),
      parseOptionalId(toLocationId),
      parseOptionalId(categoryId),
      limit ? +limit : undefined,
      parseIdList(productIds),
    );
    return {
      success: true,
      data: page.rows,
      meta: { has_more: page.has_more, limit: page.limit },
    };
  }

  /** P3 — escáner / pegar lista: SKU o código de barras exacto (M2). */
  @Get('lookup-code')
  @Permissions('store:stock-transfers:read')
  async lookupTransferCode(
    @Query('code') code: string,
    @Query('from_location_id') fromLocationId: string,
    @Query('to_location_id') toLocationId?: string,
  ) {
    const data = await this.stockTransfersService.lookupTransferCode(
      code ?? '',
      parseRequiredId(fromLocationId, 'from_location_id'),
      parseOptionalId(toLocationId),
    );
    return { success: true, data };
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

  /**
   * D2 — aprobar no mueve stock: reserva el origen. El permiso dedicado se
   * suma al histórico `update` (OR en el guard), así los roles que ya aprobaban
   * siguen haciéndolo y los nuevos pueden recibir solo `approve`.
   */
  @Patch(':id/approve')
  @Permissions('store:stock-transfers:approve', 'store:stock-transfers:update')
  approve(@Param('id') id: string) {
    return this.stockTransfersService.approve(+id);
  }

  /** Despacho físico: descuenta origen, registra transporte y remisión (D3/D6). */
  @Post(':id/dispatch')
  @Permissions('store:stock-transfers:update')
  dispatch(
    @Param('id') id: string,
    @Body() dto: DispatchTransferDto,
  ) {
    return this.stockTransfersService.dispatch(+id, dto ?? {});
  }

  /** Recepción repetible con conteos por línea (D4). */
  @Post(':id/receive')
  @Permissions('store:stock-transfers:update')
  receive(
    @Param('id') id: string,
    @Body() dto: ReceiveTransferDto,
  ) {
    return this.stockTransfersService.receive(+id, dto.items, dto.notes);
  }

  /**
   * D4 — cerrar el saldo pendiente como pérdida. El servicio exige que la
   * fecha límite de entrega ya haya vencido y un motivo.
   */
  @Post(':id/close-with-loss')
  @Permissions('store:stock-transfers:update')
  closeWithLoss(
    @Param('id') id: string,
    @Body() dto: CloseTransferWithLossDto,
  ) {
    return this.stockTransfersService.closeWithLoss(+id, dto.reason, dto.notes);
  }

  @Patch(':id/complete')
  @Permissions('store:stock-transfers:update')
  complete(
    @Param('id') id: string,
    @Body() completeData: CompleteTransferDto,
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
