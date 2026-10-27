import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { CurrentUser } from '../../../../auth/decorators/current-user.decorator';
import { FolioUser } from '../folio/folio.service';
import { FOLIO_VERIFY_PERMISSION, LodgingCheckOutService } from './check-out.service';
import { CheckOutDto } from './check-out.dto';

/** Hospitality Suite (H3.7) — check-out with payment and the folio invoice. */
@Controller('store/hospitality/reservations/:id')
@UseGuards(PermissionsGuard)
export class LodgingCheckOutController {
  constructor(
    private readonly lodgingCheckOutService: LodgingCheckOutService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Verificar el folio antes de emitir su factura (D11)' })
  @Post('folio/verify')
  @Permissions(FOLIO_VERIFY_PERMISSION)
  async verify(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingCheckOutService.verify(id);
    return this.responseService.success(result, 'Folio verificado');
  }

  @ApiOperation({ summary: 'Check-out: cobra el saldo, cierra el folio y emite la factura electrónica' })
  @Post('check-out')
  @Permissions('store:lodging:folio:close')
  async checkOut(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CheckOutDto,
    @CurrentUser() user: FolioUser,
  ) {
    const result = await this.lodgingCheckOutService.checkOut(id, dto, user);
    return this.responseService.success(result, 'Check-out realizado');
  }

  @ApiOperation({ summary: 'PDF de la factura del folio' })
  @Get('folio/invoice/pdf')
  @Permissions('store:lodging:folio:close')
  async invoicePdf(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingCheckOutService.invoicePdf(id);
    return this.responseService.success(result);
  }
}
