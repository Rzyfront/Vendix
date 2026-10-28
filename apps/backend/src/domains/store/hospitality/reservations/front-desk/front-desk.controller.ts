import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingFrontDeskService } from './lodging-front-desk.service';

/** Hospitality Suite (H3.3) — front desk board of the store business day. */
@Controller('store/hospitality/front-desk')
@UseGuards(PermissionsGuard)
export class LodgingFrontDeskController {
  constructor(
    private readonly lodgingFrontDeskService: LodgingFrontDeskService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Tablero de recepción: llegadas, salidas y en casa de hoy' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async board() {
    const result = await this.lodgingFrontDeskService.board();
    return this.responseService.success(result);
  }
}
