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
import { LodgingCancellationsService } from './cancellations.service';
import { LodgingCancellationsQueryDto } from './cancellations.dto';
import { LODGING_CHANNEL_LABELS } from './reservation-channel';

const TYPE_LABELS = { cancelled: 'Cancelación', no_show: 'No-show' } as const;

/** Hospitality Suite (H7.4) — no-shows and cancellations by channel with their penalties. */
@Controller('store/hospitality/reports/cancellations')
@UseGuards(PermissionsGuard)
export class LodgingCancellationsController {
  constructor(
    private readonly cancellations: LodgingCancellationsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'No-shows y cancelaciones por canal con sus penalidades' })
  @Get()
  @Permissions('store:lodging:reports:read')
  async get(@Query() query: LodgingCancellationsQueryDto) {
    const result = await this.cancellations.get(query);
    return this.responseService.success(result);
  }

  /** Same dataset and totals as the screen, as XLSX. */
  @ApiOperation({ summary: 'Exportar no-shows y cancelaciones (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reports:read')
  async export(@Query() query: LodgingCancellationsQueryDto, @Res() res: Response): Promise<void> {
    const report = await this.cancellations.get(query);
    const tz = report.timezone;
    const columns: ReportColumn[] = [
      { key: 'reservation_number', header: 'Reserva', type: 'text' },
      { key: 'type', header: 'Tipo', type: 'text' },
      { key: 'channel', header: 'Canal', type: 'text' },
      { key: 'guest_name', header: 'Huésped', type: 'text', width: 28 },
      { key: 'occurred_at', header: 'Fecha', type: 'date', tz },
      { key: 'arrival_date', header: 'Llegada', type: 'date-only' },
      { key: 'departure_date', header: 'Salida', type: 'date-only' },
      { key: 'nights', header: 'Noches', type: 'number' },
      { key: 'total_amount', header: 'Valor de la estadía', type: 'currency' },
      { key: 'penalty_amount', header: 'Penalidad', type: 'currency' },
      { key: 'penalty_detail', header: 'Detalle de la penalidad', type: 'text', width: 30 },
      { key: 'reason', header: 'Motivo', type: 'text', width: 30 },
    ];
    const rows = report.rows.map((row) => ({
      ...row,
      type: TYPE_LABELS[row.type],
      channel: LODGING_CHANNEL_LABELS[row.channel],
      arrival_date: dateOnlyToDb(row.arrival_date),
      departure_date: dateOnlyToDb(row.departure_date),
    }));
    const { totals } = report;
    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: 'No-shows y cancelaciones',
          columns,
          rows,
          tz,
          totals: {
            reservation_number: 'Total',
            type: `${totals.cancellations} cancelaciones · ${totals.no_shows} no-shows`,
            total_amount: totals.lost_amount,
            penalty_amount: totals.penalty_amount,
          },
        },
      ],
    });
    sendXlsxReport(res, buffer, buildReportFilename('no_shows_cancelaciones', { tz }));
  }
}
