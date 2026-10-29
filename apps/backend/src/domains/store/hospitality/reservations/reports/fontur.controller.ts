import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { ReportColumn } from '@common/reports/report-column.types';
import { buildReportFilename, sendXlsxReport } from '@common/reports/report-response.util';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingFonturService } from './fontur.service';
import { LodgingFonturQueryDto } from './fontur.dto';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-03-31" → "31 mar 2026", as the screen shows dates. */
function civilDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Hospitality Suite (H4.4) — base of the quarterly Fontur contribution. */
@Controller('store/hospitality/reports/fontur')
@UseGuards(PermissionsGuard)
export class LodgingFonturController {
  constructor(
    private readonly fontur: LodgingFonturService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Fontur: ingresos facturados del trimestre por línea y contribución estimada' })
  @Get()
  @Permissions('store:lodging:reports:read')
  async get(@Query() query: LodgingFonturQueryDto) {
    const result = await this.fontur.get(query);
    return this.responseService.success(result);
  }

  /** Same lines, base and contribution as the screen, as XLSX. */
  @ApiOperation({ summary: 'Exportar la base de la contribución Fontur (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reports:read')
  async export(@Query() query: LodgingFonturQueryDto, @Res() res: Response): Promise<void> {
    const report = await this.fontur.get(query);
    const tz = report.timezone;
    const columns: ReportColumn[] = [
      { key: 'label', header: 'Línea', type: 'text', width: 36 },
      { key: 'documents', header: 'Facturas o cuentas', type: 'number' },
      { key: 'base', header: 'Ingresos sin IVA', type: 'currency' },
    ];
    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: `Fontur T${report.quarter} ${report.year}`,
          columns,
          rows: report.lines as unknown as Record<string, unknown>[],
          tz,
          totals: { label: 'Total', documents: report.totals.documents, base: report.totals.base },
        },
        {
          // The four figures of the screen's stats, as numbers.
          name: 'Resumen',
          columns: [
            { key: 'concept', header: 'Concepto', type: 'text', width: 36 },
            { key: 'value', header: 'Valor', type: 'number', width: 20 },
          ],
          rows: [
            {
              concept: `Periodo: T${report.quarter} ${report.year} (${civilDate(report.from)} – ${civilDate(report.to)})`,
              value: null,
            },
            { concept: 'Ingresos sin IVA', value: report.totals.base },
            { concept: 'Tarifa (por mil)', value: report.rate_per_mil },
            { concept: 'Contribución estimada', value: report.totals.contribution },
            { concept: 'Facturas o cuentas', value: report.totals.documents },
            { concept: 'Cuentas cerradas sin factura', value: report.totals.without_invoice },
          ],
          tz,
        },
      ],
    });
    sendXlsxReport(res, buffer, buildReportFilename(`fontur_${report.year}_t${report.quarter}`, { tz }));
  }
}
