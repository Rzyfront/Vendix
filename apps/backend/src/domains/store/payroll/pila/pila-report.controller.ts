import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PilaReportService } from './pila-report.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { QueryPilaReportDto } from './dto/query-pila-report.dto';

/**
 * Reporte PILA de apoyo (carga manual en operador PILA).
 * El archivo plano oficial Res. 2388/2016 está fuera de alcance.
 */
@Controller('store/payroll/pila')
export class PilaReportController {
  constructor(
    private readonly pila_report_service: PilaReportService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('report')
  @Permissions('store:payroll:runs:read')
  async getReport(@Query() query: QueryPilaReportDto) {
    const result = await this.pila_report_service.getContributionsForPeriod(
      query.year,
      query.month,
    );
    return this.response_service.success(result);
  }

  @Get('export')
  @Permissions('store:payroll:runs:read')
  async exportCsv(@Query() query: QueryPilaReportDto, @Res() res: Response) {
    const { filename, content } = await this.pila_report_service.exportCsv(
      query.year,
      query.month,
    );

    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(content);
  }
}
