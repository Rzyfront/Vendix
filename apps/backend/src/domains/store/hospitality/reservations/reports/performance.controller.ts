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
import { LodgingPerformanceRow, LodgingPerformanceService } from './performance.service';
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

  /** Same dataset and totals as the screen, as XLSX: one sheet by day, one by month. */
  @ApiOperation({ summary: 'Exportar indicadores (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reports:read')
  async export(@Query() query: LodgingPerformanceQueryDto, @Res() res: Response): Promise<void> {
    const report = await this.performance.get(query);
    const tz = report.timezone;
    const figures: ReportColumn[] = [
      { key: 'nights_available', header: 'Noches disponibles', type: 'number' },
      { key: 'nights_sold', header: 'Noches vendidas', type: 'number' },
      { key: 'occupancy', header: 'Ocupación', type: 'percent' },
      { key: 'room_revenue', header: 'Ingreso de alojamiento', type: 'currency' },
      { key: 'adr', header: 'Tarifa media por noche (ADR)', type: 'currency', width: 18 },
      { key: 'revpar', header: 'Ingreso por habitación disponible (RevPAR)', type: 'currency', width: 22 },
    ];
    // Percent cells take a fraction; a KPI without base stays empty, never 0.
    const kpis = (row: LodgingPerformanceRow) => ({
      ...row,
      occupancy: row.occupancy_pct === null ? null : row.occupancy_pct / 100,
    });
    const totals = kpis(report.totals);
    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: 'Por día',
          columns: [
            { key: 'period', header: 'Día', type: 'date-only' },
            { key: 'source', header: 'Cierre', type: 'text' },
            ...figures,
          ],
          rows: report.days.map((day) => ({
            ...kpis(day),
            period: dateOnlyToDb(day.period),
            source: day.closed ? 'Cerrado' : 'En vivo',
          })),
          tz,
          // The day column is a date cell: the label goes in the text column.
          totals: { ...totals, period: null, source: 'Total' },
        },
        {
          name: 'Por mes',
          columns: [{ key: 'period', header: 'Mes', type: 'text' }, ...figures],
          rows: report.months.map(kpis),
          tz,
          totals: { ...totals, period: 'Total' },
        },
      ],
    });
    sendXlsxReport(res, buffer, buildReportFilename('indicadores', { tz }));
  }
}
