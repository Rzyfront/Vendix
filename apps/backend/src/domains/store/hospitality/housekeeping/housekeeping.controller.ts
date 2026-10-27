import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { HousekeepingService } from './housekeeping.service';
import { ChangeHousekeepingStatusDto } from './change-housekeeping-status.dto';

/** Hospitality Suite (H5.1) — room status board for housekeeping. */
@Controller('store/hospitality/housekeeping')
@UseGuards(PermissionsGuard)
export class HousekeepingController {
  constructor(
    private readonly housekeepingService: HousekeepingService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Tablero de estado de las habitaciones' })
  @Get()
  @Permissions('store:lodging:housekeeping:read')
  async board() {
    const result = await this.housekeepingService.board();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Cambiar el estado de limpieza de una habitación' })
  @Patch('units/:id/status')
  @Permissions('store:lodging:housekeeping:operate')
  async changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeHousekeepingStatusDto,
  ) {
    const result = await this.housekeepingService.changeStatus(id, dto.from, dto.status);
    return this.responseService.updated(result, 'Estado de la habitación actualizado');
  }
}
