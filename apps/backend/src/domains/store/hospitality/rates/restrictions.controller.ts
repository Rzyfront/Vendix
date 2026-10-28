import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { LodgingRestrictionsService } from './restrictions.service';
import { RestrictionQueryDto, SetRestrictionsDto } from './dto';

/** Hospitality Suite (H2.3) — per-night stay restrictions of the rates calendar. */
@Controller('store/hospitality/restrictions')
@UseGuards(PermissionsGuard)
export class LodgingRestrictionsController {
  constructor(
    private readonly restrictionsService: LodgingRestrictionsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Restricciones de venta de un rango de noches' })
  @Get()
  @Permissions('store:lodging:rates:read')
  async findRange(@Query() query: RestrictionQueryDto) {
    const result = await this.restrictionsService.findRange(query);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Fijar o quitar las restricciones de un rango de noches' })
  @Put()
  @Permissions('store:lodging:rates:write')
  async set(@Body() dto: SetRestrictionsDto) {
    const result = await this.restrictionsService.set(dto);
    return this.responseService.updated(result, 'Restricciones guardadas');
  }
}
