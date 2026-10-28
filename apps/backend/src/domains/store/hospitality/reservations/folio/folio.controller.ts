import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { CurrentUser } from '../../../../auth/decorators/current-user.decorator';
import { FolioUser, LodgingFolioService } from './folio.service';
import {
  AddFolioChargeDto,
  FolioChargesBlockedDto,
  FolioPaymentDto,
  FolioVatExemptionDto,
  VoidFolioChargeDto,
} from './folio.dto';

/** Hospitality Suite (H3.4) — guest folio: nights, manual charges, voids and payments. */
@Controller('store/hospitality/reservations/:id/folio')
@UseGuards(PermissionsGuard)
export class LodgingFolioController {
  constructor(
    private readonly lodgingFolioService: LodgingFolioService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Folio de la reserva: cargos, pagos y saldo' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingFolioService.getFolio(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Cargar al folio las noches ya causadas (hasta hoy)' })
  @Post('nights')
  @Permissions('store:lodging:folio:charge')
  async postNights(@Param('id', ParseIntPipe) id: number) {
    const { posted, folio } = await this.lodgingFolioService.postNights(id);
    return this.responseService.success(
      folio,
      posted > 0 ? `${posted} noche(s) cargada(s)` : 'No hay noches por cargar',
    );
  }

  @ApiOperation({ summary: 'Agregar un cargo manual (producto o servicio) al folio' })
  @Post('charges')
  @Permissions('store:lodging:folio:charge')
  async addCharge(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddFolioChargeDto,
    @CurrentUser() user: FolioUser,
  ) {
    const result = await this.lodgingFolioService.addCharge(id, dto, user);
    return this.responseService.success(result, 'Cargo agregado');
  }

  @ApiOperation({ summary: 'Anular un cargo del folio con motivo' })
  @Post('charges/:itemId/void')
  @Permissions('store:lodging:folio:charge')
  async voidCharge(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: VoidFolioChargeDto,
  ) {
    const result = await this.lodgingFolioService.voidCharge(id, itemId, dto);
    return this.responseService.success(result, 'Cargo anulado');
  }

  @ApiOperation({ summary: 'Bloquear o permitir los cargos a la habitación desde POS y mesas' })
  @Patch('charges-blocked')
  @Permissions('store:lodging:folio:close')
  async setChargesBlocked(@Param('id', ParseIntPipe) id: number, @Body() dto: FolioChargesBlockedDto) {
    const result = await this.lodgingFolioService.setChargesBlocked(id, dto.blocked);
    return this.responseService.success(result, dto.blocked ? 'Cargos bloqueados' : 'Cargos permitidos');
  }

  @ApiOperation({ summary: 'Aplicar o quitar la exención de IVA del titular no residente (H3.9)' })
  @Patch('vat-exemption')
  @Permissions('store:lodging:folio:charge')
  async setVatExemption(@Param('id', ParseIntPipe) id: number, @Body() dto: FolioVatExemptionDto) {
    const result = await this.lodgingFolioService.setVatExemption(id, dto.enabled);
    return this.responseService.success(
      result,
      dto.enabled ? 'Exención de IVA aplicada a las noches' : 'Exención de IVA quitada',
    );
  }

  @ApiOperation({ summary: 'Aplicar al folio el depósito de la reserva (anticipo)' })
  @Post('deposit')
  @Permissions('store:lodging:folio:close')
  async applyDeposit(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingFolioService.applyDeposit(id);
    return this.responseService.success(result, 'Anticipo aplicado');
  }

  @ApiOperation({ summary: 'Registrar un pago parcial del saldo del folio' })
  @Post('payments')
  @Permissions('store:lodging:folio:close')
  async registerPayment(@Param('id', ParseIntPipe) id: number, @Body() dto: FolioPaymentDto) {
    const result = await this.lodgingFolioService.registerPayment(id, dto);
    return this.responseService.success(result, 'Pago registrado');
  }
}
