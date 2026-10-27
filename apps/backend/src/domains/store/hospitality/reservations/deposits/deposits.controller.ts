import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingDepositsService } from './deposits.service';
import { CollectDepositDto, DepositLinkDto } from './deposits.dto';

/** Hospitality Suite (H3.5) — reservation deposits (customer advance, D3). */
@Controller('store/hospitality/reservations/:id/deposits')
@UseGuards(PermissionsGuard)
export class LodgingDepositsController {
  constructor(
    private readonly lodgingDepositsService: LodgingDepositsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Depósito de la reserva: requerido, recibido y movimientos' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    const result = await this.lodgingDepositsService.summary(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Cobrar el depósito en caja (efectivo, tarjeta o transferencia)' })
  @Post()
  @Permissions('store:lodging:folio:close')
  async collect(@Param('id', ParseIntPipe) id: number, @Body() dto: CollectDepositDto) {
    const result = await this.lodgingDepositsService.collect(id, dto);
    return this.responseService.success(result, 'Depósito registrado');
  }

  @ApiOperation({ summary: 'Crear un link de pago Wompi por el depósito' })
  @Post('link')
  @Permissions('store:lodging:folio:close')
  async createLink(@Param('id', ParseIntPipe) id: number, @Body() dto: DepositLinkDto) {
    const result = await this.lodgingDepositsService.createLink(id, dto);
    return this.responseService.success(result, 'Link de pago creado');
  }
}
