import { Injectable } from '@nestjs/common';
import { Prisma, invoice_status_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  resolveLocalDateOnlyRange,
  resolveStoreTimezone,
} from '@common/utils/store-timezone.util';
import { round2 } from '../analytics-metrics.contract';
import {
  SUPPORT_REPORT_DOCUMENT_TYPES,
  SupportDocumentsReportQueryDto,
  SupportDocumentsSortField,
  SupportReportDocumentType,
} from '../dto/support-documents-report-query.dto';

/** Tope documentado del dataset de export (skill vendix-report-xlsx, regla 4). */
export const SUPPORT_DOCUMENTS_EXPORT_LIMIT = 10000;

/**
 * Estados que NO suman en los totales: el documento anulado (`voided`) y el
 * cancelado antes de transmitir (`cancelled`) no tienen efecto fiscal. Siguen
 * apareciendo en la tabla y en el XLSX, marcados como fuera de totales.
 */
export const SUPPORT_REPORT_EXCLUDED_STATUSES: readonly invoice_status_enum[] = [
  'voided',
  'cancelled',
];

export interface SupportDocumentReportRow {
  id: number;
  /** Fecha de negocio (date-only): medianoche UTC del día local de emisión. */
  issue_date: Date;
  invoice_type: SupportReportDocumentType;
  invoice_number: string | null;
  status: invoice_status_enum;
  dian_status: string;
  supplier_id: number | null;
  supplier_name: string;
  supplier_tax_id: string | null;
  /** CUDS (`invoices.cufe`). */
  cuds: string | null;
  /** Número del documento soporte que corrige una nota de ajuste. */
  related_invoice_number: string | null;
  subtotal_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  currency: string | null;
  /** Instante en que la DIAN aceptó el documento. */
  accepted_at: Date | null;
  counts_in_totals: boolean;
}

export interface SupportDocumentsAmounts {
  subtotal_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
}

export interface SupportDocumentsTypeTotals extends SupportDocumentsAmounts {
  count: number;
}

export interface SupportDocumentsSummary {
  /** Documentos que suman (soporte + ajustes, sin anulados ni cancelados). */
  document_count: number;
  /** Anulados o cancelados: se listan pero no suman. */
  excluded_count: number;
  support: SupportDocumentsTypeTotals;
  adjustment: SupportDocumentsTypeTotals;
  /** Soporte − ajustes (la nota de ajuste resta, igual que en las declaraciones). */
  net: SupportDocumentsAmounts;
}

/** Columna de orden permitida -> campo Prisma (lista blanca). */
const SORT_FIELDS: Record<
  SupportDocumentsSortField,
  keyof Prisma.invoicesOrderByWithRelationInput
> = {
  issue_date: 'issue_date',
  total_amount: 'total_amount',
  invoice_number: 'invoice_number',
  status: 'status',
};

const REPORT_SELECT = {
  id: true,
  issue_date: true,
  invoice_type: true,
  invoice_number: true,
  status: true,
  dian_status: true,
  supplier_id: true,
  customer_name: true,
  customer_tax_id: true,
  cufe: true,
  subtotal_amount: true,
  tax_amount: true,
  withholding_amount: true,
  total_amount: true,
  currency: true,
  accepted_at: true,
  supplier: { select: { name: true, tax_id: true } },
  related_invoice: { select: { invoice_number: true } },
} satisfies Prisma.invoicesSelect;

type ReportInvoice = Prisma.invoicesGetPayload<{ select: typeof REPORT_SELECT }>;

const toNum = (v: unknown): number =>
  v === null || v === undefined ? 0 : Number(v);

const emptyTotals = (): SupportDocumentsTypeTotals => ({
  count: 0,
  subtotal_amount: 0,
  tax_amount: 0,
  withholding_amount: 0,
  total_amount: 0,
});

/**
 * Reporte de documentos soporte y notas de ajuste (solo lectura).
 *
 * Una sola consulta base (`buildWhere`) alimenta la tabla, los totales y el
 * XLSX, así que pantalla y archivo no divergen. `issue_date` es una fecha de
 * negocio guardada como medianoche (el formulario envía `YYYY-MM-DD`), por eso
 * el rango se arma con `resolveLocalDateOnlyRange` en la zona de la tienda y no
 * con el rango de instantes, que correría los documentos un día atrás.
 */
@Injectable()
export class SupportDocumentsReportService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  /**
   * WHERE común. El cliente con scope ya filtra por tienda; el `store_id`
   * explícito es defensa en profundidad y deja el aislamiento a la vista.
   */
  private async buildWhere(
    query: SupportDocumentsReportQueryDto,
  ): Promise<Prisma.invoicesWhereInput> {
    const storeId = this.getStoreId();
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const { startDate, endDate } = resolveLocalDateOnlyRange(query, tz);
    const types = query.invoice_type?.length
      ? query.invoice_type
      : [...SUPPORT_REPORT_DOCUMENT_TYPES];

    return {
      store_id: storeId,
      invoice_type: { in: types },
      issue_date: { gte: startDate, lte: endDate },
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.supplier_id ? { supplier_id: query.supplier_id } : {}),
    };
  }

  private orderBy(
    query: SupportDocumentsReportQueryDto,
  ): Prisma.invoicesOrderByWithRelationInput[] {
    const field = SORT_FIELDS[query.sort_by ?? 'issue_date'] ?? 'issue_date';
    const direction: Prisma.SortOrder = query.sort_order === 'asc' ? 'asc' : 'desc';
    return [{ [field]: direction }, { id: direction }];
  }

  async getList(query: SupportDocumentsReportQueryDto): Promise<{
    data: SupportDocumentReportRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const where = await this.buildWhere(query);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 25));

    const [rows, total] = await Promise.all([
      this.prisma.invoices.findMany({
        where,
        select: REPORT_SELECT,
        orderBy: this.orderBy(query),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invoices.count({ where }),
    ]);

    return { data: rows.map(toReportRow), total, page, limit };
  }

  /** Dataset completo para el XLSX (tope {@link SUPPORT_DOCUMENTS_EXPORT_LIMIT}). */
  async getForExport(
    query: SupportDocumentsReportQueryDto,
  ): Promise<SupportDocumentReportRow[]> {
    const where = await this.buildWhere(query);
    const rows = await this.prisma.invoices.findMany({
      where,
      select: REPORT_SELECT,
      orderBy: this.orderBy(query),
      take: SUPPORT_DOCUMENTS_EXPORT_LIMIT,
    });
    return rows.map(toReportRow);
  }

  /** Totales del rango completo (no de la página): misma fuente que el XLSX. */
  async getSummary(
    query: SupportDocumentsReportQueryDto,
  ): Promise<SupportDocumentsSummary> {
    const where = await this.buildWhere(query);
    const groups = await this.prisma.invoices.groupBy({
      by: ['invoice_type', 'status'],
      where,
      _count: { _all: true },
      _sum: {
        subtotal_amount: true,
        tax_amount: true,
        withholding_amount: true,
        total_amount: true,
      },
    });

    const support = emptyTotals();
    const adjustment = emptyTotals();
    let excluded = 0;

    for (const group of groups) {
      const count = group._count?._all ?? 0;
      if (SUPPORT_REPORT_EXCLUDED_STATUSES.includes(group.status)) {
        excluded += count;
        continue;
      }
      const target =
        group.invoice_type === 'support_adjustment_note' ? adjustment : support;
      target.count += count;
      target.subtotal_amount += toNum(group._sum?.subtotal_amount);
      target.tax_amount += toNum(group._sum?.tax_amount);
      target.withholding_amount += toNum(group._sum?.withholding_amount);
      target.total_amount += toNum(group._sum?.total_amount);
    }

    const rounded = (t: SupportDocumentsTypeTotals): SupportDocumentsTypeTotals => ({
      count: t.count,
      subtotal_amount: round2(t.subtotal_amount),
      tax_amount: round2(t.tax_amount),
      withholding_amount: round2(t.withholding_amount),
      total_amount: round2(t.total_amount),
    });

    return {
      document_count: support.count + adjustment.count,
      excluded_count: excluded,
      support: rounded(support),
      adjustment: rounded(adjustment),
      net: {
        subtotal_amount: round2(support.subtotal_amount - adjustment.subtotal_amount),
        tax_amount: round2(support.tax_amount - adjustment.tax_amount),
        withholding_amount: round2(
          support.withholding_amount - adjustment.withholding_amount,
        ),
        total_amount: round2(support.total_amount - adjustment.total_amount),
      },
    };
  }
}

function toReportRow(row: ReportInvoice): SupportDocumentReportRow {
  return {
    id: row.id,
    issue_date: row.issue_date,
    invoice_type: row.invoice_type as SupportReportDocumentType,
    invoice_number: row.invoice_number ?? null,
    status: row.status,
    dian_status: row.dian_status,
    supplier_id: row.supplier_id ?? null,
    // Snapshot fiscal del documento primero; la ficha viva solo de respaldo.
    supplier_name: row.customer_name || row.supplier?.name || '',
    supplier_tax_id: row.customer_tax_id || row.supplier?.tax_id || null,
    cuds: row.cufe ?? null,
    related_invoice_number: row.related_invoice?.invoice_number ?? null,
    subtotal_amount: round2(toNum(row.subtotal_amount)),
    tax_amount: round2(toNum(row.tax_amount)),
    withholding_amount: round2(toNum(row.withholding_amount)),
    total_amount: round2(toNum(row.total_amount)),
    currency: row.currency ?? null,
    accepted_at: row.accepted_at ?? null,
    counts_in_totals: !SUPPORT_REPORT_EXCLUDED_STATUSES.includes(row.status),
  };
}
