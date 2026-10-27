import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingPickupService } from './pickup.service';
import { LodgingPickupQueryDto } from './pickup.dto';

/** Hospitality Suite (H7.3) — pickup of the last 7 and 30 days and projected occupancy. */
@Controller('store/hospitality/reports/pickup')
@UseGuards(PermissionsGuard)
export class LodgingPickupController {
  constructor(
    private readonly pickup: LodgingPickupService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Pickup (últimos 7 y 30 días) y ocupación proyectada por fecha de estadía' })
  @Get()
  @Permissions('store:lodging:reports:read')
  async get(@Query() query: LodgingPickupQueryDto) {
    const result = await this.pickup.get(query);
    return this.responseService.success(result);
  }
}
