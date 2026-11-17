import { DatePreset } from '../../../../../shared/interfaces/date-range-filter.interface';

/** Tipos fiscales que cubre el reporte (`invoices.invoice_type`). */
export type SupportReportDocumentType =
  | 'support_document'
  | 'support_adjustment_note';

/** Estados de `invoice_status_enum` que el reporte permite filtrar. */
export type SupportReportStatus =
  | 'draft'
  | 'validated'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'voided';

export type SupportDocumentsSortBy =
  | 'issue_date'
  | 'total_amount'
  | 'invoice_number'
  | 'status';

/** Fila de `GET /store/analytics/support-documents`. */
export interface SupportDocumentReportRow {
  id: number;
  /** Fecha de negocio (date-only, medianoche UTC del día de emisión). */
  issue_date: string;
  invoice_type: SupportReportDocumentType;
  invoice_number: string | null;
  status: SupportReportStatus;
  dian_status: string;
  supplier_id: number | null;
  supplier_name: string;
  supplier_tax_id: string | null;
  cuds: string | null;
  related_invoice_number: string | null;
  subtotal_amount: number;
  tax_amount: number;
  withholding_amount: number;
  total_amount: number;
  currency: string | null;
  /** Instante de aceptación DIAN (se muestra en la zona de la tienda). */
  accepted_at: string | null;
  /** `false` para anulados y cancelados: se listan pero no suman. */
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

/** `GET /store/analytics/support-documents/summary`. */
export interface SupportDocumentsSummary {
  document_count: number;
  excluded_count: number;
  support: SupportDocumentsTypeTotals;
  adjustment: SupportDocumentsTypeTotals;
  /** Soporte − ajustes (la nota de ajuste resta). */
  net: SupportDocumentsAmounts;
}

export interface SupportDocumentsListResponse {
  success: boolean;
  data: SupportDocumentReportRow[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SupportDocumentsReportQuery {
  date_preset?: DatePreset;
  date_from?: string;
  date_to?: string;
  status?: SupportReportStatus[];
  invoice_type?: SupportReportDocumentType[];
  supplier_id?: number;
  page?: number;
  limit?: number;
  sort_by?: SupportDocumentsSortBy;
  sort_order?: 'asc' | 'desc';
}
