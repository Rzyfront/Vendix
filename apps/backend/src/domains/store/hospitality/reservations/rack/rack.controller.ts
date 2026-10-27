import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { RackQueryDto } from '../dto';
import { LodgingRackService } from './lodging-rack.service';

/** Hospitality Suite (H1.3) — occupancy rack (read only). */
@Controller('store/hospitality/rack')
@UseGuards(PermissionsGuard)
export class LodgingRackController {
  constructor(
    private readonly lodgingRackService: LodgingRackService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Rack de ocupación: habitaciones por noches' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async getRack(@Query() query: RackQueryDto) {
    const result = await this.lodgingRackService.getRack(query.from, query.to);
    return this.responseService.success(result);
  }
}
