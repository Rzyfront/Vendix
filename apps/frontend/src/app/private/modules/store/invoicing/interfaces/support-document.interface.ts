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

/**
 * Documento soporte con la relación `supplier` que `GET /store/invoicing/:id`
 * incluye (`INVOICE_INCLUDE`). El snapshot (`customer_name`/`customer_tax_id`)
 * es lo que viajó a la DIAN; la ficha del proveedor es la de hoy.
 */
export type SupportDocumentDetail = SupportDocumentRow & {
  supplier?: {
    id: number;
    name: string;
    tax_id?: string | null;
  } | null;
};

/**
 * Respuesta de `GET /store/invoicing/:id/dian-status` (QUI-683): la consulta
 * EN VIVO a la DIAN por la llave fiscal guardada (CUDS en los documentos
 * soporte). Es de solo lectura: no cambia el estado local del documento.
 *
 * `unavailable` = la DIAN no respondió o la respuesta no se pudo leer; no es
 * un rechazo y la pantalla no debe pintarlo como tal.
 */
export interface SupportDocumentDianStatus {
  invoice_id: number;
  invoice_number: string;
  invoice_type: string;
  document_key: string;
  document_key_label: 'CUDS' | 'CUFE' | 'CUDE';
  local_status: string;
  dian_status: 'accepted' | 'rejected' | 'pending' | 'unavailable';
  dian_status_code: string | null;
  message: string | null;
  rules: Array<{ code: string; text: string; severity: string }>;
  checked_at: string;
}

/**
 * Documento soporte aceptado que se va a corregir con una nota de ajuste: el
 * detalle se lo pasa al form de creación para abrirlo prellenado (QUI-683).
 */
export interface SupportDocumentAdjustmentSource {
  id: number;
  invoice_number: string;
  supplier_id: number | null;
}

// ── Documento soporte desde una orden de compra (QUI-684) ───────────────────

/** Resumen de la OC que devuelven los endpoints de soporte por OC. */
export interface PoSummary {
  id: number;
  order_number: string | null;
  status: string;
  supplier_id: number | null;
  total_amount: number;
  /** Informativo: la OC ya trae una factura de compra adjunta. No bloquea. */
  has_supplier_invoice: boolean;
  supplier_invoice_number: string | null;
  supplier_invoice_date: string | null;
  invoice_attachments_count: number;
}

/** Documento soporte ligado a la OC (más reciente primero, incluye historial anulado). */
export interface PoSupportDocument {
  id: number;
  invoice_type: string;
  invoice_number: string;
  cufe: string | null;
  status: string;
  dian_status: string | null;
  transmission_status: string | null;
  issue_date: string;
  total_amount: number;
  accepted_at: string | null;
}

/** `GET /store/invoicing/purchase-orders/:id/support-documents`. */
export interface PurchaseOrderSupportContext {
  enabled: boolean;
  purchase_order: PoSummary;
  active_document_id: number | null;
  documents: PoSupportDocument[];
}

/** Dato que le falta a la OC para emitir; `label` ya viene en español. */
export interface SupportMissingField {
  code: string;
  field: string;
  label: string;
  /** `review` se corrige en el modal; `supplier` en el proveedor; `purchase_order` bloquea. */
  target: 'supplier' | 'review' | 'purchase_order';
}

export interface PurchaseOrderSupportDraftItem {
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  tax_amount: number;
  product_id?: number;
  product_variant_id?: number;
}

/** `GET /store/invoicing/purchase-orders/:id/support-document-draft`. */
export interface PurchaseOrderSupportDraft {
  purchase_order: PoSummary;
  active_document: {
    id: number;
    invoice_number: string;
    status: string;
  } | null;
  supplier: {
    id: number;
    name: string;
    document_type: string | null;
    tax_id: string | null;
    verification_digit: string | null;
    address_line1: string | null;
    city: string | null;
    municipality_code: string | null;
  };
  draft: {
    supplier_id: number;
    issue_date: string;
    due_date: string | null;
    payment_form: '1' | '2' | null;
    notes: string;
    withholding_amount: number;
    items: PurchaseOrderSupportDraftItem[];
  };
  missing: SupportMissingField[];
  can_emit: boolean;
}

/** Cuerpo de `POST /store/invoicing/purchase-orders/:id/support-document`. */
export interface CreatePurchaseOrderSupportDocumentDto {
  issue_date: string;
  due_date?: string;
  payment_form: '1' | '2';
  payment_means_code?: string;
  notes?: string;
  withholding_amount?: number;
  items: SupportDocumentItemDto[];
  client_request_id?: string;
  emit_immediately?: boolean;
}

/** Resultado de la emisión inmediata (`emission` del 201). */
export interface SupportDocumentEmissionOutcome {
  attempted: boolean;
  success: boolean;
  status: string | null;
  error_code: string | null;
  message: string | null;
}
