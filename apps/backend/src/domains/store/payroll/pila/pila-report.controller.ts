import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PilaReportService } from './pila-report.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { QueryPilaReportDto } from './dto/query-pila-report.dto';
import { QueryPilaSubmissionsDto } from './dto/query-pila-submissions.dto';

/**
 * Reportes PILA:
 * - `report` / `generate` / `export` (CSV): reporte de apoyo para carga manual.
 * - `flat-file`: ARCHIVO PLANO oficial Res. 2388/2016 (registro tipo 1 + tipo 2
 *   por cotizante), listo para pago por operador (SOI / Aportes en Línea).
 */
@Controller('store/payroll/pila')
export class PilaReportController {
  constructor(
    private readonly pila_report_service: PilaReportService,
    private readonly response_service: ResponseService,
  ) {}

  /**
   * Vista en pantalla del período (sin efectos secundarios). El tracking en
   * `pila_submissions` sólo ocurre en acciones explícitas del usuario que
   * producen un artefacto (ver `generate` y `export`), para no ensuciar el
   * historial con cada cambio de año/mes en el selector.
   */
  @Get('report')
  @Permissions('store:payroll:runs:read')
  async getReport(@Query() query: QueryPilaReportDto) {
    const result = await this.pila_report_service.getContributionsForPeriod(
      query.year,
      query.month,
    );
    return this.response_service.success(result);
  }

  /**
   * Genera (registra intención de) la planilla del período sin descargar
   * archivo. Marca `status='generated'` en `pila_submissions`.
   */
  @Get('generate')
  @Permissions('store:payroll:runs:read')
  async generate(@Query() query: QueryPilaReportDto) {
    const result = await this.pila_report_service.generateAndTrack(
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

  /**
   * Descarga el ARCHIVO PLANO oficial PILA (Res. 2388/2016) del período.
   * Registro tipo 1 (encabezado) + un registro tipo 2 por cotizante, en
   * formato de ancho fijo. Content-Type text/plain, extensión .txt.
   * Registra la exportación en `pila_submissions`.
   */
  @Get('flat-file')
  @Permissions('store:payroll:runs:read')
  async exportFlatFile(
    @Query() query: QueryPilaReportDto,
    @Res() res: Response,
  ) {
    const { filename, content } =
      await this.pila_report_service.generateFlatFile(query.year, query.month);

    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(content);
  }

  @Get('submissions')
  @Permissions('store:payroll:runs:read')
  async getSubmissionHistory(@Query() query: QueryPilaSubmissionsDto) {
    const result = await this.pila_report_service.getSubmissionHistory(query);
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }
}
