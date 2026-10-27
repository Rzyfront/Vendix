import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingPerformanceService } from './performance.service';
import { LodgingPerformanceQueryDto } from './performance.dto';

/** Hospitality Suite (H7.2) — occupancy, ADR and RevPAR by day and month. */
@Controller('store/hospitality/reports/performance')
@UseGuards(PermissionsGuard)
export class LodgingPerformanceController {
  constructor(
    private readonly performance: LodgingPerformanceService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Ocupación, ADR y RevPAR por día y por mes' })
  @Get()
  @Permissions('store:lodging:reports:read')
  async get(@Query() query: LodgingPerformanceQueryDto) {
    const result = await this.performance.get(query);
    return this.responseService.success(result);
  }
}
