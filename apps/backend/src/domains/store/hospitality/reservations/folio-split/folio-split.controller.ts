import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingFolioSplitService } from './folio-split.service';
import {
  CancelFolioSplitDto,
  ConfirmFolioSplitDto,
  FolioSplitDto,
  FolioSplitPayDto,
} from './folio-split.dto';

/** Hospitality Suite (H3.8) — split folio: one account per payer, each with its payment and invoice. */
@Controller('store/hospitality/reservations/:id/folio/split')
@UseGuards(PermissionsGuard)
export class LodgingFolioSplitController {
  constructor(
    private readonly lodgingFolioSplitService: LodgingFolioSplitService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'División activa del folio (cuentas, pagos y facturas)' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingFolioSplitService.get(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Vista previa de la división del folio por ítems' })
  @Post('preview')
  @Permissions('store:lodging:folio:close')
  async preview(@Param('id', ParseIntPipe) id: number, @Body() dto: FolioSplitDto) {
    const result = await this.lodgingFolioSplitService.preview(id, dto);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Dividir el folio por ítems' })
  @Post()
  @Permissions('store:lodging:folio:close')
  async confirm(@Param('id', ParseIntPipe) id: number, @Body() dto: ConfirmFolioSplitDto) {
    const result = await this.lodgingFolioSplitService.confirm(id, dto);
    return this.responseService.success(result, 'Folio dividido');
  }

  @ApiOperation({ summary: 'Quitar la división antes de cobrar' })
  @Post('cancel')
  @Permissions('store:lodging:folio:close')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelFolioSplitDto) {
    const result = await this.lodgingFolioSplitService.cancel(id, dto);
    return this.responseService.success(result, 'División quitada');
  }

  @ApiOperation({ summary: 'Cobrar una cuenta del folio dividido' })
  @Post('accounts/:accountId/pay')
  @Permissions('store:lodging:folio:close')
  async pay(
    @Param('id', ParseIntPipe) id: number,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: FolioSplitPayDto,
  ) {
    const result = await this.lodgingFolioSplitService.pay(id, accountId, dto);
    return this.responseService.success(result, 'Pago registrado');
  }
}
