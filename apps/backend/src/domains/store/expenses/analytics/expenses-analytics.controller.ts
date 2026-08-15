import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { AnalyticsQueryDto } from '../../analytics/dto/analytics-query.dto';
import {
  buildReportBuffer,
} from '@common/reports/report-builder';
import {
  buildReportFilename,
  sendXlsxReport,
} from '@common/reports/report-response.util';
import {
  ReportColumn,
  ReportSheet,
} from '@common/reports/report-column.types';
import { formatCellDate } from '@common/reports/report-builder';
import { ExpensesAnalyticsService } from './expenses-analytics.service';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/**
 * QUI-544: endpoints de analytics para gastos. Viven en el módulo de
 * expenses porque son un sub-dominio del flujo de gastos (no en
 * store/analytics porque ese módulo no conoce las particularidades
 * de expenses_categories / expenses_state_enum).
 *
 * Permiso: `store:analytics:read` (mismo que el resto de analytics).
 */
@Controller('store/analytics/expenses')
@UseGuards(PermissionsGuard)
export class ExpensesAnalyticsController {
  constructor(
    private readonly expenses_analytics_service: ExpensesAnalyticsService,
    private readonly prisma: StorePrismaService,
  ) {}

  private async resolveReportTz(): Promise<string> {
    // Reutilizamos el patrón de analytics.controller.ts: tomar la TZ de
    // la tienda vía resolveStoreTimezone.
    const { RequestContextService } = await import('@common/context/request-context.service');
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) return 'America/Bogota';
    return resolveStoreTimezone(this.prisma, storeId);
  }

  /**
   * Resumen agregado del período: totales por estado, count, promedio.
   */
  @Get('summary')
  @Permissions('store:analytics:read')
  async exportExpensesSummary(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.expenses_analytics_service.getExpensesSummaryForExport(query);

    const columns: ReportColumn[] = [
      { key: 'period_start', header: 'Desde', type: 'date' },
      { key: 'period_end', header: 'Hasta', type: 'date' },
      { key: 'total_expenses', header: 'Total Gastos', type: 'currency' },
      { key: 'total_recognized', header: 'Monto Reconocido', type: 'currency' },
      { key: 'total_pending', header: 'Pendientes', type: 'currency' },
      { key: 'total_count', header: 'Total Movimientos', type: 'number' },
      { key: 'recognized_count', header: 'Cantidad Reconocida', type: 'number' },
      { key: 'pending_count', header: 'Pendientes', type: 'number' },
      { key: 'average_expense', header: 'Promedio', type: 'currency' },
    ];

    await this.emitReport(res, 'resumen_gastos', tz, columns, rows);
  }

  /**
   * Desglose por categoría de gasto con total, count y % participación.
   */
  @Get('by-category')
  @Permissions('store:analytics:read')
  async exportExpensesByCategory(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.expenses_analytics_service.getExpensesByCategoryForExport(query);

    const columns: ReportColumn[] = [
      { key: 'category_name', header: 'Categoría', type: 'text' },
      { key: 'expense_count', header: 'Gastos', type: 'number' },
      { key: 'total_amount', header: 'Total', type: 'currency' },
      { key: 'average_expense', header: 'Promedio', type: 'currency' },
      { key: 'percentage', header: '% Participación', type: 'percent' },
    ];

    await this.emitReport(res, 'gastos_por_categoria', tz, columns, rows);
  }

  /**
   * Detalle crudo de gastos (un row por expense) para análisis granular.
   */
  @Get('detail')
  @Permissions('store:analytics:read')
  async exportExpensesDetail(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.expenses_analytics_service.getExpensesDetailForExport(query);

    const columns: ReportColumn[] = [
      { key: 'id', header: 'ID', type: 'number' },
      { key: 'expense_date', header: 'Fecha', type: 'date' },
      { key: 'category_name', header: 'Categoría', type: 'text' },
      { key: 'description', header: 'Descripción', type: 'text' },
      { key: 'amount', header: 'Monto', type: 'currency' },
      { key: 'currency', header: 'Moneda', type: 'text' },
      { key: 'state', header: 'Estado', type: 'text' },
      { key: 'is_recognized', header: 'Reconocido', type: 'text' },
      { key: 'created_by', header: 'Creado por', type: 'text' },
      { key: 'approved_by', header: 'Aprobado por', type: 'text' },
      { key: 'receipt_url', header: 'Recibo', type: 'text' },
      { key: 'notes', header: 'Notas', type: 'text' },
    ];

    await this.emitReport(res, 'detalle_gastos', tz, columns, rows);
  }

  private async emitReport(
    res: Response,
    base: string,
    tz: string,
    columns: ReportColumn[],
    rows: any[],
    query?: AnalyticsQueryDto,
  ): Promise<void> {
    const sheet: ReportSheet = {
      name: base,
      columns,
      rows,
    };
    const buffer = await buildReportBuffer({ sheets: [sheet] });
    const filename = buildReportFilename(base, {
      tz,
      dateFrom: query?.date_from ? new Date(query.date_from) : undefined,
      dateTo: query?.date_to ? new Date(query.date_to) : undefined,
    });
    sendXlsxReport(res, buffer, filename);
  }
}
