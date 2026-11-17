import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import {
  sendXlsxReport,
  buildReportFilename,
} from '@common/reports/report-response.util';
import type { ReportColumn } from '@common/reports/report-column.types';
import { RequestContextService } from '@common/context/request-context.service';
import {
  resolveStoreTimezone,
  DEFAULT_STORE_TIMEZONE,
} from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { SupportDocumentsReportService } from './services/support-documents-report.service';
import { SupportDocumentsReportQueryDto } from './dto/support-documents-report-query.dto';

/** Etiquetas en español de `invoice_status_enum` para el XLSX. */
export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  validated: 'Validado',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Descartado',
  voided: 'Anulado',
};

export const SUPPORT_TYPE_LABELS: Record<string, string> = {
  support_document: 'Documento soporte',
  support_adjustment_note: 'Nota de ajuste',
};

/**
 * Reporte de documentos soporte y notas de ajuste. Las rutas estáticas
 * (`summary`, `export`) se declaran ANTES del listado. Solo lectura: mismo
 * permiso que el resto de reportes, sin subscription gate.
 */
@Controller('store/analytics/support-documents')
@UseGuards(PermissionsGuard)
export class SupportDocumentsReportController {
  constructor(
    private readonly report_service: SupportDocumentsReportService,
    private readonly response_service: ResponseService,
    private readonly prisma: StorePrismaService,
  ) {}

  private async resolveReportTz(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return DEFAULT_STORE_TIMEZONE;
    return resolveStoreTimezone(this.prisma, storeId);
  }

  @Get('summary')
  @Permissions('store:analytics:read')
  async getSummary(@Query() query: SupportDocumentsReportQueryDto) {
    const result = await this.report_service.getSummary(query);
    return this.response_service.success(result);
  }

  @Get('export')
  @Permissions('store:analytics:read')
  async exportSupportDocuments(
    @Query() query: SupportDocumentsReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    // Lista y totales salen de la misma consulta base del servicio.
    const [rows, summary] = await Promise.all([
      this.report_service.getForExport(query),
      this.report_service.getSummary(query),
    ]);
    const tz = await this.resolveReportTz();

    const amountColumns: ReportColumn[] = [
      { key: 'subtotal_amount', header: 'Subtotal', type: 'currency' },
      { key: 'tax_amount', header: 'Impuestos', type: 'currency' },
      { key: 'withholding_amount', header: 'Retenciones', type: 'currency' },
      { key: 'total_amount', header: 'Total', type: 'currency' },
    ];

    const detailColumns: ReportColumn[] = [
      { key: 'issue_date', header: 'Fecha emisión', type: 'date-only' },
      { key: 'type_label', header: 'Tipo', type: 'text', width: 30 },
      { key: 'invoice_number', header: 'Número', type: 'text' },
      { key: 'supplier_name', header: 'Proveedor', type: 'text', width: 32 },
      { key: 'supplier_tax_id', header: 'NIT / Documento', type: 'text' },
      { key: 'status_label', header: 'Estado', type: 'text' },
      { key: 'related_invoice_number', header: 'Documento original', type: 'text' },
      { key: 'cuds', header: 'CUDS', type: 'text', width: 40 },
      ...amountColumns,
      { key: 'accepted_at', header: 'Aceptado DIAN', type: 'date', tz },
      { key: 'counts_label', header: 'En totales', type: 'text' },
    ];

    const detailRows = rows.map((r) => ({
      issue_date: r.issue_date,
      type_label: SUPPORT_TYPE_LABELS[r.invoice_type] ?? r.invoice_type,
      invoice_number: r.invoice_number ?? '',
      supplier_name: r.supplier_name,
      supplier_tax_id: r.supplier_tax_id ?? '',
      status_label: SUPPORT_STATUS_LABELS[r.status] ?? r.status,
      related_invoice_number: r.related_invoice_number ?? '',
      cuds: r.cuds ?? '',
      subtotal_amount: r.subtotal_amount,
      tax_amount: r.tax_amount,
      withholding_amount: r.withholding_amount,
      total_amount: r.total_amount,
      accepted_at: r.accepted_at,
      counts_label: r.counts_in_totals ? 'Sí' : 'No (anulado o descartado)',
    }));

    const summaryColumns: ReportColumn[] = [
      { key: 'concept', header: 'Concepto', type: 'text', width: 44 },
      { key: 'count', header: 'Cantidad', type: 'number' },
      ...amountColumns,
    ];

    const summaryRows = [
      { concept: 'Documentos soporte', ...summary.support },
      { concept: 'Notas de ajuste (restan)', ...summary.adjustment },
      {
        concept: 'Anulados o descartados (fuera de totales)',
        count: summary.excluded_count,
      },
    ];

    const netLabel = 'TOTAL NETO (soporte − ajustes, sin anulados)';

    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: 'Documentos soporte',
          columns: detailColumns,
          rows: detailRows,
          totals: { type_label: netLabel, ...summary.net },
          tz,
        },
        {
          name: 'Resumen',
          columns: summaryColumns,
          rows: summaryRows,
          totals: {
            concept: netLabel,
            count: summary.document_count,
            ...summary.net,
          },
          tz,
        },
      ],
    });
    sendXlsxReport(
      res,
      buffer,
      buildReportFilename('documentos_soporte', { tz }),
    );
  }

  @Get()
  @Permissions('store:analytics:read')
  async getSupportDocuments(@Query() query: SupportDocumentsReportQueryDto) {
    const { data, total, page, limit } = await this.report_service.getList(query);
    return this.response_service.paginated(data, total, page, limit);
  }
}
