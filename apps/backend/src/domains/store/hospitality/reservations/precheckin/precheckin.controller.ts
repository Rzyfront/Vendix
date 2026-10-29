import { Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingPrecheckinService } from './precheckin.service';

/** Hospitality Suite (H8.1) — online check-in link the desk shares with the guest. */
@Controller('store/hospitality/reservations/:reservationId/precheckin-link')
@UseGuards(PermissionsGuard)
export class LodgingPrecheckinController {
  constructor(
    private readonly precheckinService: LodgingPrecheckinService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Enlace de pre-registro (check-in online) de la reserva' })
  @Post()
  @Permissions('store:lodging:front_desk:operate')
  async getLink(@Param('reservationId', ParseIntPipe) reservationId: number) {
    const result = await this.precheckinService.getLink(reservationId);
    return this.responseService.success(result, 'Enlace de pre-registro listo');
  }
}
