/**
 * Tipos e interfaces del módulo "Documentos soporte" (QUI-682).
 *
 * Reutiliza `Invoice` e `InvoiceStatus` del módulo base — un documento soporte
 * es una `Invoice` con `invoice_type ∈ {support_document,
 * support_adjustment_note, purchase_invoice}` (los 3 que `isSupportDocumentType`
 * reconoce). Se modela el payload y la query, no el shape de fila.
 */

import type {
  Invoice,
  InvoiceStatus,
} from './invoice.interface';

/** Tipos de documento soportados por este tab. */
export type SupportDocumentType =
  | 'support_document'
  | 'support_adjustment_note';

/** Estado de un documento soporte (mismo enum que `Invoice.status`). */
export type SupportDocumentStatus = InvoiceStatus;

/**
 * Payload de creación de un documento soporte.
 *
 * El backend ya acepta `purchase_invoice` y `support_document` como sinónimos
 * en `CreateInvoiceDto.invoice_type` (uno se traduce al otro en
 * `toFiscalDocumentType`), pero la UI nueva siempre envía `support_document`
 * para que el listado filtre sin sorpresas.
 */
export interface CreateSupportDocumentDto {
  invoice_type: SupportDocumentType;
  /** El backend exige `supplier_id` para `isSupportDocumentType` (ver `loadSupportDocumentSupplier`). */
  supplier_id: number;
  /** ISO date — `Issue_date` del documento soporte. */
  issue_date: string;
  /** Opcional — fecha de pago al proveedor. */
  due_date?: string;
  /** Respaldo DIAN — fila `invoice_resolutions` con `document_type='support_document'`. */
  resolution_id?: number;
  /** Notas visibles en el PDF/impresión. */
  notes?: string;
  /** Moneda. Default 'COP' en el backend. */
  currency?: string;
  /** Retenciones aplicadas a la factura (mapeo a `withholding_amount`). */
  withholding_amount?: number;
  /**
   * Sólo para `support_adjustment_note` — `related_invoice_id` del documento
   * soporte original aceptado por la DIAN (ver `findAcceptedSupportDocumentOriginal`).
   */
  related_invoice_id?: number;
  /** Ítems del documento soporte — descripción, cantidad, precio, IVA. */
  items: SupportDocumentItemDto[];
  /** Impuestos desglosados por ítem (renglón `invoice_taxes`). */
  taxes?: SupportDocumentTaxDto[];
}

export interface SupportDocumentItemDto {
  product_id?: number;
  product_variant_id?: number;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  tax_amount?: number;
}

/** Renglón de impuesto en `invoice_taxes` (alineado con `CreateInvoiceTaxDto`). */
export interface SupportDocumentTaxDto {
  tax_rate_id?: number;
  tax_name: string;
  /** Porcentaje (ej: 19 para 19%). El backend espera porcentaje, no fracción. */
  tax_rate: number;
  /** Base gravable del impuesto. */
  taxable_amount: number;
  /** Valor del impuesto. */
  tax_amount: number;
  /** Clasificación fiscal: iva / inc / ica / retefuente / reteiva / etc. */
  tax_type?: 'iva' | 'inc' | 'ica' | 'retefuente' | 'reteiva' | 'reteica' | 'otros';
}

/**
 * Filtros del listado de documentos soporte.
 *
 * Reutiliza los campos base de `QueryInvoiceDto` y añade `cuds` (lookup por
 * CUDS = `invoices.cufe` en backend) y `supplier_id` para "Documentos soporte
 * por proveedor".
 */
export interface SupportDocumentQuery {
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  status?: SupportDocumentStatus;
  /** Limitado a `SupportDocumentType` para la pestaña dedicada. */
  invoice_type?: SupportDocumentType | '';
  date_from?: string;
  date_to?: string;
  supplier_id?: number;
  /** Búsqueda por CUDS (mapea a `invoices.cufe` en backend). */
  cuds?: string;
}

/** Helper para que la lista sepa qué filas mostrar — un sub-tipo de `Invoice`. */
export type SupportDocumentRow = Invoice;