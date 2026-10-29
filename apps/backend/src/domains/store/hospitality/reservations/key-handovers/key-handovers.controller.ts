import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingKeyHandoversService } from './key-handovers.service';
import { DeliverKeyDto } from './key-handover.dto';

/** Hospitality Suite (H8.4, D12) — key / access card handovers of a reservation. */
@Controller('store/hospitality/reservations/:reservationId/keys')
@UseGuards(PermissionsGuard)
export class LodgingKeyHandoversController {
  constructor(
    private readonly keyHandoversService: LodgingKeyHandoversService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Llaves entregadas y devueltas de una reserva' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async findAll(@Param('reservationId', ParseIntPipe) reservationId: number) {
    const result = await this.keyHandoversService.findAll(reservationId);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Registrar la entrega de una llave o tarjeta a un huésped' })
  @Post()
  @Permissions('store:lodging:front_desk:operate')
  async deliver(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Body() dto: DeliverKeyDto,
  ) {
    const result = await this.keyHandoversService.deliver(reservationId, dto);
    return this.responseService.created(result, 'Entrega de llave registrada');
  }

  @ApiOperation({ summary: 'Registrar la devolución de una llave o tarjeta' })
  @Post(':keyId/return')
  @Permissions('store:lodging:front_desk:operate')
  async returnKey(
    @Param('reservationId', ParseIntPipe) reservationId: number,
    @Param('keyId', ParseIntPipe) keyId: number,
  ) {
    const result = await this.keyHandoversService.returnKey(reservationId, keyId);
    return this.responseService.success(result, 'Devolución de llave registrada');
  }
}
