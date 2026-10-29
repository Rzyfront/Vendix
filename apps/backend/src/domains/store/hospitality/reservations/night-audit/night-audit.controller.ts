import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingNightAuditService } from './night-audit.service';
import { CloseNightAuditDto, NightAuditQueryDto, ReopenNightAuditDto } from './night-audit.dto';
import { formatShortDate } from '../stay-dates';

/** Hospitality Suite (H7.1) — night audit: close and reopen the business day. */
@Controller('store/hospitality/night-audit')
@UseGuards(PermissionsGuard)
export class LodgingNightAuditController {
  constructor(
    private readonly nightAudit: LodgingNightAuditService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Resumen del día de negocio: noches, no-shows, llegadas pendientes y descuadre' })
  @Get()
  @Permissions('store:lodging:night_audit:close')
  async get(@Query() query: NightAuditQueryDto) {
    const result = await this.nightAudit.get(query.date);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Cerrar el día: carga las noches, marca no-shows y congela la fecha' })
  @Post('close')
  @Permissions('store:lodging:night_audit:close')
  async close(@Body() dto: CloseNightAuditDto) {
    const result = await this.nightAudit.close(dto.date, dto.mark_no_shows ?? true);
    return this.responseService.success(result, `Día ${formatShortDate(result.business_date)} cerrado`);
  }

  @ApiOperation({ summary: 'Reabrir un día cerrado con motivo' })
  @Post('reopen')
  @Permissions('store:lodging:night_audit:reopen')
  async reopen(@Body() dto: ReopenNightAuditDto) {
    const result = await this.nightAudit.reopen(dto.date, dto.reason);
    return this.responseService.success(result, `Día ${formatShortDate(dto.date)} reabierto`);
  }
}
