import { Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingIcalExportService } from './ical-export.service';

/** Hospitality Suite (H6.1) — Canales → iCal: export URL per room. */
@Controller('store/hospitality/channels/ical')
@UseGuards(PermissionsGuard)
export class LodgingIcalExportController {
  constructor(
    private readonly icalExport: LodgingIcalExportService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Habitaciones con su enlace iCal de exportación' })
  @Get('units')
  @Permissions('store:lodging:channels:manage')
  async list() {
    return this.responseService.success(await this.icalExport.list());
  }

  @ApiOperation({ summary: 'Crear o regenerar el enlace iCal de una habitación' })
  @Post('units/:id/token')
  @Permissions('store:lodging:channels:manage')
  async rotate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.icalExport.rotate(id);
    return this.responseService.updated(result, 'Enlace iCal generado');
  }

  @ApiOperation({ summary: 'Revocar el enlace iCal de una habitación' })
  @Delete('units/:id/token')
  @Permissions('store:lodging:channels:manage')
  async revoke(@Param('id', ParseIntPipe) id: number) {
    const result = await this.icalExport.revoke(id);
    return this.responseService.updated(result, 'Enlace iCal revocado');
  }
}
