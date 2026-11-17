import { IsEnum, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { invoice_status_enum } from '@prisma/client';
import { AnalyticsQueryDto } from './analytics-query.dto';
import { normalizeMultiValue } from './payments-analytics-query.dto';

/** Tipos fiscales que cubre el reporte de documentos soporte. */
export const SUPPORT_REPORT_DOCUMENT_TYPES = [
  'support_document',
  'support_adjustment_note',
] as const;
export type SupportReportDocumentType =
  (typeof SUPPORT_REPORT_DOCUMENT_TYPES)[number];

export const SUPPORT_DOCUMENTS_SORT_FIELDS = [
  'issue_date',
  'total_amount',
  'invoice_number',
  'status',
] as const;
export type SupportDocumentsSortField =
  (typeof SUPPORT_DOCUMENTS_SORT_FIELDS)[number];

/**
 * Filtros del reporte de documentos soporte y notas de ajuste.
 *
 * El rango (`date_from`/`date_to`/`date_preset`) se resuelve sobre
 * `invoices.issue_date` en el calendario LOCAL de la tienda. `status` e
 * `invoice_type` aceptan varios valores (CSV o parámetro repetido); sin ellos
 * entran todos los estados y ambos tipos.
 */
export class SupportDocumentsReportQueryDto extends AnalyticsQueryDto {
  @IsOptional()
  @Transform(normalizeMultiValue)
  @IsEnum(invoice_status_enum, { each: true })
  status?: invoice_status_enum[];

  @IsOptional()
  @Transform(normalizeMultiValue)
  @IsIn(SUPPORT_REPORT_DOCUMENT_TYPES, { each: true })
  invoice_type?: SupportReportDocumentType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplier_id?: number;

  @IsOptional()
  @IsIn(SUPPORT_DOCUMENTS_SORT_FIELDS)
  sort_by?: SupportDocumentsSortField;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}
