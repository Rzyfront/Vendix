import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { ReportColumn } from '@common/reports/report-column.types';
import { buildReportFilename, sendXlsxReport } from '@common/reports/report-response.util';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { dateOnlyToDb } from '../stay-dates';
import { LodgingPickupRow, LodgingPickupService } from './pickup.service';
import { LodgingPickupQueryDto } from './pickup.dto';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

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

  /** Same dataset and totals as the screen, as XLSX. */
  @ApiOperation({ summary: 'Exportar ritmo de reservas y pronóstico (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reports:read')
  async export(@Query() query: LodgingPickupQueryDto, @Res() res: Response): Promise<void> {
    const report = await this.pickup.get(query);
    const tz = report.timezone;
    const columns: ReportColumn[] = [
      { key: 'stay_date', header: 'Fecha de estadía', type: 'date-only' },
      { key: 'weekday', header: 'Día', type: 'text' },
      { key: 'rooms', header: 'Habitaciones', type: 'number' },
      { key: 'on_books', header: 'Noches reservadas', type: 'number' },
      { key: 'pickup_7', header: 'Reservas nuevas 7 días', type: 'number' },
      { key: 'pickup_30', header: 'Reservas nuevas 30 días', type: 'number' },
      { key: 'occupancy', header: 'Ocupación proyectada', type: 'percent' },
    ];
    // Percent cells take a fraction; a date without rooms stays empty, never 0.
    const occupancy = (row: LodgingPickupRow) =>
      row.projected_occupancy_pct === null ? null : row.projected_occupancy_pct / 100;
    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: 'Ritmo de reservas',
          columns,
          rows: report.days.map((day) => ({
            ...day,
            stay_date: dateOnlyToDb(day.stay_date),
            weekday: WEEKDAYS[dateOnlyToDb(day.stay_date).getUTCDay()],
            occupancy: occupancy(day),
          })),
          tz,
          // The date column is a date cell: the label goes in the text column.
          totals: { ...report.totals, weekday: 'Total', occupancy: occupancy(report.totals) },
        },
      ],
    });
    sendXlsxReport(res, buffer, buildReportFilename('ritmo_de_reservas', { tz }));
  }
}
