import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { ReportColumn } from '@common/reports/report-column.types';
import { buildReportFilename, sendXlsxReport } from '@common/reports/report-response.util';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingSireService } from './sire.service';
import { SireListQueryDto, SireMarkReportedDto } from './sire.dto';

/** Hospitality Suite (H4.2) — assisted SIRE (Migración Colombia) of foreign guests. */
@Controller('store/hospitality/compliance/sire')
@UseGuards(PermissionsGuard)
export class LodgingSireController {
  constructor(
    private readonly sire: LodgingSireService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'SIRE: conteos y umbral de atraso' })
  @Get('summary')
  @Permissions('store:lodging:reservations:read')
  async summary() {
    return this.responseService.success(await this.sire.summary());
  }

  @ApiOperation({ summary: 'SIRE: entradas y salidas de extranjeros por reportar' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async list(@Query() query: SireListQueryDto) {
    const { data, total, page, limit } = await this.sire.list(query);
    return this.responseService.paginated(data, total, page, limit);
  }

  /** Layout of the SIRE form, one row per movement, to type or load in the portal. */
  @ApiOperation({ summary: 'SIRE: exportar los pendientes (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reservations:read')
  async export(@Query() query: SireListQueryDto, @Res() res: Response): Promise<void> {
    const { rows, tz } = await this.sire.exportRows(query);
    const columns: ReportColumn[] = [
      { key: 'tipo_movimiento', header: 'Tipo de movimiento', type: 'text', width: 12 },
      { key: 'fecha_movimiento', header: 'Fecha del movimiento', type: 'text', width: 14 },
      { key: 'tipo_documento', header: 'Tipo de documento', type: 'text', width: 26 },
      { key: 'numero_documento', header: 'Número de documento', type: 'text', width: 18 },
      { key: 'nacionalidad', header: 'Nacionalidad', type: 'text', width: 18 },
      { key: 'primer_apellido', header: 'Primer apellido', type: 'text', width: 18 },
      { key: 'segundo_apellido', header: 'Segundo apellido', type: 'text', width: 18 },
      { key: 'nombres', header: 'Nombres', type: 'text', width: 20 },
      { key: 'fecha_nacimiento', header: 'Fecha de nacimiento', type: 'text', width: 14 },
      { key: 'procedencia', header: 'Procedencia', type: 'text', width: 20 },
      { key: 'residencia', header: 'Residencia', type: 'text', width: 20 },
      { key: 'habitacion', header: 'Habitación', type: 'text', width: 12 },
      { key: 'permiso_ingreso', header: 'Permiso de ingreso', type: 'text', width: 30 },
      { key: 'reserva', header: 'Reserva', type: 'text', width: 14 },
      { key: 'antiguedad', header: 'Horas sin reportar', type: 'text', width: 12 },
    ];
    const data = rows.map(({ item, record }) => ({
      ...(record ?? { nombres: item.guest_name }),
      reserva: item.reservation_number,
      antiguedad: item.status === 'pending' ? String(item.age_hours) : '',
    }));
    const buffer = await buildReportBuffer({ sheets: [{ name: 'SIRE', columns, rows: data, tz }] });
    sendXlsxReport(res, buffer, buildReportFilename('sire_planilla_viajeros', { tz }));
  }

  @ApiOperation({ summary: 'SIRE: ficha copiable de un movimiento' })
  @Get(':id')
  @Permissions('store:lodging:reservations:read')
  async sheet(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.sire.sheet(id));
  }

  @ApiOperation({ summary: 'SIRE: marcar como reportados en el portal' })
  @Post('mark-reported')
  @Permissions('store:lodging:front_desk:operate')
  async markReported(@Body() dto: SireMarkReportedDto) {
    const result = await this.sire.markReported(dto.ids);
    return this.responseService.success(result, 'Marcados como reportados en el SIRE');
  }
}
