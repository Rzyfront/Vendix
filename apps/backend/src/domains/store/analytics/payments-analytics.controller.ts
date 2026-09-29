import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { PaymentsAnalyticsService } from './services/payments-analytics.service';
import { PaymentsAnalyticsQueryDto } from './dto/payments-analytics-query.dto';
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

/** Etiquetas en español de `payments_state_enum` para el XLSX. */
const PAYMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  succeeded: 'Exitoso',
  failed: 'Fallido',
  authorized: 'Autorizado',
  captured: 'Capturado',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolso parcial',
  cancelled: 'Cancelado',
};

/**
 * Reporte y analítica de pagos. Las rutas estáticas (`summary`, `trends`,
 * `export`) se declaran ANTES del listado. Solo lectura: sin subscription gate.
 */
@Controller('store/analytics/payments')
@UseGuards(PermissionsGuard)
export class PaymentsAnalyticsController {
  constructor(
    private readonly payments_analytics_service: PaymentsAnalyticsService,
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
  async getSummary(@Query() query: PaymentsAnalyticsQueryDto) {
    const result = await this.payments_analytics_service.getSummary(query);
    return this.response_service.success(result);
  }

  @Get('trends')
  @Permissions('store:analytics:read')
  async getTrends(@Query() query: PaymentsAnalyticsQueryDto) {
    const result = await this.payments_analytics_service.getTrends(query);
    return this.response_service.success(result);
  }

  @Get('export')
  @Permissions('store:analytics:read')
  async exportPayments(
    @Query() query: PaymentsAnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.payments_analytics_service.getPaymentsForExport(query);

    const columns: ReportColumn[] = [
      { key: 'effective_date', header: 'Fecha pago', type: 'date', tz },
      { key: 'order_number', header: '# Orden', type: 'text' },
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'customer_document', header: 'Documento', type: 'text' },
      { key: 'method_name', header: 'Método', type: 'text' },
      { key: 'state_label', header: 'Estado', type: 'text' },
      { key: 'amount', header: 'Monto', type: 'currency' },
      { key: 'refunded_amount', header: 'Reembolsado', type: 'currency' },
      { key: 'net_amount', header: 'Neto', type: 'currency' },
      { key: 'gateway_reference', header: 'Referencia', type: 'text' },
      { key: 'transaction_id', header: 'Transacción', type: 'text' },
      { key: 'register_name', header: 'Caja', type: 'text' },
      { key: 'bank_account_name', header: 'Cuenta bancaria', type: 'text' },
      { key: 'receipt_label', header: 'Comprobante', type: 'text' },
    ];

    const flat = rows.map((r) => ({
      effective_date: new Date(r.effective_date),
      order_number: r.order.order_number,
      customer_name: r.customer?.name ?? '',
      customer_document: r.customer?.document ?? '',
      method_name: r.payment_method?.display_name ?? '',
      state_label: PAYMENT_STATE_LABELS[r.state] ?? r.state,
      amount: r.amount,
      refunded_amount: r.refunded_amount,
      net_amount: r.net_amount,
      gateway_reference: r.gateway_reference ?? '',
      transaction_id: r.transaction_id ?? '',
      register_name: r.cash_register?.register_name ?? '',
      bank_account_name: r.bank_account?.name ?? '',
      receipt_label: r.has_receipt ? 'Sí' : 'No',
    }));

    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: 'Pagos',
          columns,
          rows: flat as unknown as Record<string, unknown>[],
          tz,
        },
      ],
    });
    sendXlsxReport(res, buffer, buildReportFilename('pagos', { tz }));
  }

  @Get()
  @Permissions('store:analytics:read')
  async getPayments(@Query() query: PaymentsAnalyticsQueryDto) {
    const { data, total, page, limit } =
      await this.payments_analytics_service.getPayments(query);
    return this.response_service.paginated(data, total, page, limit);
  }
}
