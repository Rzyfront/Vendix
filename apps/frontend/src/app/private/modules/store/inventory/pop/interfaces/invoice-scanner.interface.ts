/**
 * Invoice Scanner Interfaces
 * Mirror of backend DTOs for OCR invoice scanning
 */

// ============================================================================
// Scan Result (from OCR)
// ============================================================================

export interface ExtractedSupplier {
  name: string;
  tax_id?: string;
  address?: string;
  phone?: string;
}

/**
 * QUI-855 — un impuesto de una línea, tal como lo emite el backend del scan.
 * `tax_rate` es PORCENTAJE (19 = 19 %), a diferencia del `tax_rate` legacy de
 * la línea, que es FRACCIÓN (0.19).
 */
export interface ScanLineTax {
  tax_type: 'iva' | 'inc' | 'icui' | 'ibua';
  tax_rate: number | null;
  calc_mode: 'percent' | 'fixed_per_unit';
  fixed_amount_per_unit: number | null;
  amount_override: number | null;
  /** Undefined ⇒ hereda el modo de la línea (sólo lo deja así el editor del modal). */
  is_inclusive?: boolean;
  /** Los fija el editor del modal (el backend no los emite). */
  base_mode?: 'net' | 'net_plus_prior';
  add_to_cost?: boolean;
}

/** Adjunto del escaneo: la factura ya subida a S3 por el backend. */
export interface ScanAttachmentInfo {
  key: string;
  file_name: string;
  file_type: string;
  file_size: number;
}

export interface ExtractedLineItem {
  description: string;
  quantity: number;
  /**
   * F3 IVA lifecycle: tras la normalización del backend, `unit_price` SIEMPRE
   * es el precio unitario NETO (pre-IVA). Si la factura era IVA-incluido
   * (`prices_include_tax === true`) el bruto emitido por el scanner se aplastó
   * a neto con la fórmula canónica (neto = bruto / (1 + tax_rate)); el bruto
   * original queda en `unit_price_gross`. En facturas con IVA por fuera,
   * neto === bruto.
   */
  unit_price: number;
  total: number;
  sku_if_visible?: string;
  /**
   * F3 IVA lifecycle: tasa de IVA/consumo por línea emitida por el scanner
   * como FRACCIÓN decimal (0, 0.05, 0.19), NO porcentaje. Opcional porque los
   * escaneos legacy / prompts pre-F3 no la emiten.
   */
  tax_rate?: number | null;
  /**
   * F3 IVA lifecycle: precio unitario ORIGINAL impreso en la factura (bruto si
   * era inclusiva, neto si era exclusiva). `unit_price` queda normalizado a
   * neto; este campo conserva el valor crudo para mostrar "bruto → neto".
   */
  unit_price_gross?: number | null;
  /**
   * QUI-661 Fase 4 — descuento COMERCIAL de la línea, ya aplanado a NETO por el
   * backend con la misma regla que `unit_price`. El de PRONTO PAGO no viene
   * acá: es financiero y viaja aparte, sólo para mostrarlo.
   */
  discount_amount?: number | null;
  /**
   * QUI-661 hotfix — descuento comercial de la línea en PORCENTAJE (0-100), tal
   * como lo imprime la factura ("-20%", "Dcto 20%"). Es PROCEDENCIA: el monto en
   * `discount_amount` es la fuente de verdad y gana en `deriveLineTax`. Un
   * porcentaje es invariante a la base (bruto o neto), así que es la cifra que el
   * operador coteja de un vistazo contra el papel y la que puede teclear sin
   * preguntarse si el número que ve incluye IVA.
   */
  discount_percentage?: number | null;
  /**
   * QUI-855 — N impuestos de la línea (camino multi-impuesto). Cuando trae
   * elementos la línea se trabaja en BRUTO (`unit_price_gross` +
   * `discount_amount_printed`) y el kernel deriva el neto; `unit_price`,
   * `tax_rate` y `discount_amount` son el camino legacy (aplanado sólo por IVA).
   */
  taxes?: ScanLineTax[] | null;
  /** QUI-855 — descuento impreso en la factura (BRUTO, sin aplanar por IVA). */
  discount_amount_printed?: number | null;
  /**
   * QUI-855 — modo de precios de ESTA línea cuando difiere del de la factura.
   * Lo fija el modal al pasar una línea legacy (neta) al camino multi-impuesto;
   * el backend nunca lo emite. Undefined ⇒ hereda `prices_include_tax` del scan.
   */
  prices_include_tax?: boolean;
  /**
   * Fase 4: pistas de unidad de medida emitidas por el perfil
   * `invoice_ocr_ingredient`. El perfil retail (`invoice_ocr`) no las
   * emite, por eso son opcionales. `uom_hint` es un código de unidad
   * (p.ej. "L", "ml", "kg", "g", "unit") que el scanner usa para
   * preseleccionar la unidad de compra cuando `orderType==='ingredient'`.
   */
  presentation?: string | null;
  pack_size?: number | null;
  uom_hint?: string | null;
  /** Escaneo v2 — unidad en que la factura IMPRIMIO el descuento de la linea. */
  discount_kind?: 'percent' | 'amount';
  /** Escaneo v2 — tratamiento del IVA de la linea. */
  tax_treatment?: 'gravado' | 'exento' | 'excluido';
  /** Escaneo v2 — linea bonificada (precio 0, sin descuento). */
  is_bonus?: boolean;
  /** Escaneo v2 — total de la linea tal como lo imprimio la factura. */
  printed_line_total?: number;
  /** Escaneo v2 — cuadre determinista de la linea contra el total impreso. */
  reconcile?: { expected: number; printed: number; ok: boolean };
}

export interface InvoiceScanResult {
  supplier: ExtractedSupplier;
  invoice_number: string;
  invoice_date: string;
  payment_terms?: string;
  /**
   * F3 IVA lifecycle: flag GLOBAL de la factura — ¿los precios impresos ya
   * INCLUYEN IVA? Dirige el aplastado a neto en el backend. Opcional / por
   * defecto `false` (IVA por fuera) en escaneos pre-F3.
   */
  prices_include_tax?: boolean;
  line_items: ExtractedLineItem[];
  /**
   * QUI-855 — la factura subida por el scan. Se adjunta a la OC al crearla.
   */
  scan_attachment?: ScanAttachmentInfo | null;
  subtotal: number;
  tax_amount: number;
  /**
   * QUI-661 Fase 4 — descuento COMERCIAL de pie de factura, ya aplanado a neto
   * por el backend. `pop.component` lo pasa al carrito, que lo manda como
   * descuento general; el backend lo prorratea por línea antes del IVA.
   */
  discount_amount?: number | null;
  /**
   * QUI-855 — el mismo descuento SIN aplanar (tal como se imprimió). Se usa
   * cuando las líneas entran al carrito en bruto (camino multi-impuesto).
   */
  discount_amount_printed?: number | null;
  /**
   * QUI-661 Fase 4 — descuento por PRONTO PAGO detectado en la factura. Se
   * muestra, NO se aplica: es financiero, va a cuenta de resultado y se decide
   * al registrar el pago (QUI-647). Nunca entra al costo del inventario.
   */
  early_payment_discount?: number | null;
  total: number;
  confidence: number;
  /** Escaneo v2 — % comercial de cabecera y la unidad en que se imprimio. */
  header_discount_percentage?: number;
  header_discount_kind?: 'percent' | 'amount';
  schema_version?: 1 | 2;
}

// ============================================================================
// Match Result (product matching)
// ============================================================================

export interface SupplierMatch {
  matched_id?: number;
  name: string;
  tax_id?: string;
  confidence: number;
  is_new: boolean;
}

export interface ProductCandidate {
  id: number;
  name: string;
  sku: string;
  cost_price?: number;
  confidence: number;
}

export interface MatchedLineItem extends ExtractedLineItem {
  match_status: 'matched' | 'partial' | 'new';
  selected_product_id?: number;
  candidates: ProductCandidate[];
  /**
   * F3 IVA lifecycle: tax_category sugerida por match de tasa. `null` cuando
   * no hay coincidencia de tasa O cuando el comercio NO es responsable de IVA
   * (O-49). El usuario puede asignarla manualmente en el modal POP.
   */
  suggested_tax_category_id?: number | null;
  /**
   * F3 IVA lifecycle: costo unitario NETO (pre-IVA) de la línea = `unit_price`
   * ya normalizado. El modal POP lo usa para pre-llenar el costo con el neto.
   */
  unit_cost_net?: number | null;
  /**
   * Fase 4: UoM FKs resueltas por el scanner a partir de `uom_hint`
   * (solo en flujo `ingredient`). `purchase_uom_id` se resuelve por
   * match case-insensitive de código contra el catálogo; `stock_uom_id`
   * es la unidad BASE de la misma dimensión. Sugerencia editable: el
   * usuario las confirma/ajusta en el modal de config del POP. Null
   * cuando no hay hint o no hay match en el catálogo.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * D.1 — por qué la línea quedó como quedó. Va PEGADO al renglón: un aviso
   * «el producto X está archivado» flotando arriba con veinte líneas debajo
   * obliga al operador a buscar cuál es X.
   */
  match_reason?: MatchedLineReason;
  /**
   * El producto ARCHIVADO que el catálogo tenía. Presente sólo cuando el
   * motivo es de archivado: o se descartó a propósito (`archived_candidate`),
   * o el SKU impreso es suyo y la línea se propuso a otro producto activo
   * (`archived_sku_reassigned`).
   */
  archived_candidate?: ArchivedCandidate;
  /**
   * C.8 — la cantidad que se va a cargar NO es la que imprime la factura.
   *
   * Coexiste con `match_reason`: una línea puede estar archivada Y venir
   * convertida de empaques a unidades. Se pintan los dos.
   *
   * OJO con `total`: NO se recalcula al redondear — sigue siendo el total que
   * imprimió el papel. Pintarlo junto a la cantidad aplicada mostraría 30.000
   * al lado de 3 × 12.000.
   */
  quantity_adjustment?: QuantityAdjustment;
  /**
   * QUI-855 paso 8b — marca que deja la revalidación con IA en la línea (sólo
   * UI, vive hasta el cierre del modal):
   *  - `changed`: la revalidación cambió algún valor numérico/fiscal.
   *  - `new`: la IA la encontró en el documento y no estaba en la precarga.
   *  - `missing`: la revalidación no la encontró en el documento.
   */
  revalidation?: 'changed' | 'new' | 'missing';
}

/** Motivo tipado de `MatchedLineItem.match_reason`. */
export type MatchedLineReason =
  | 'archived_candidate'
  | 'archived_sku_reassigned'
  | 'no_catalog_match'
  | 'lookup_failed';

/** Producto archivado que el escáner encontró y no seleccionó. */
export interface ArchivedCandidate {
  id: number;
  name: string;
  sku: string;
}

/** Motivo tipado del ajuste de cantidad. */
export type QuantityAdjustmentReason =
  | 'converted_to_stock_units'
  | 'rounded_unmatched_line'
  | 'rounded_no_packaging_factor'
  | 'rounded_factor_applied_at_receipt'
  | 'rounded_conversion_not_exact';

/** El antes y el después de la cantidad y del costo unitario de la línea. */
export interface QuantityAdjustment {
  reason: QuantityAdjustmentReason;
  original_quantity: number;
  applied_quantity: number;
  original_unit_price: number;
  applied_unit_price: number;
  packaging_factor?: number;
  converted_quantity?: number;
  stock_unit?: string | null;
  purchase_unit?: string | null;
}

export interface InvoiceMatchResult {
  supplier_match: SupplierMatch;
  items: MatchedLineItem[];
  warnings: string[];
}

// ============================================================================
// Confirmation DTOs
// ============================================================================

export interface ConfirmScannedInvoiceItemDto {
  product_id?: number;
  /** QUI-661 Fase 4 — descuento comercial de la línea, revisado por el usuario. */
  discount_amount?: number;
  product_name?: string;
  sku?: string;
  quantity: number;
  unit_cost: number;
  description?: string;
}

export interface ConfirmScannedInvoiceDto {
  supplier_id?: number;
  location_id: number;
  items: ConfirmScannedInvoiceItemDto[];
  invoice_number?: string;
  invoice_date?: string;
  tax_amount?: number;
  discount_amount?: number;
  notes?: string;
  save_attachment?: boolean;
}

// ============================================================================
// Revalidación con IA (QUI-855 paso 8b) — espejo de
// `purchase-orders/interfaces/invoice-revalidate-job.interface.ts`
// ============================================================================

export type InvoiceRevalidateJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

export interface InvoiceRevalidateFinding {
  severity: 'info' | 'warning';
  message: string;
}

export interface InvoiceRevalidateRedFlag {
  message: string;
  line_index: number | null;
}

export interface InvoiceRevalidateDivergence {
  line_index: number | null;
  field: string;
  consolidated_value: unknown;
  document_value: unknown;
  revalidated_value: unknown;
  reason: string;
}

export interface InvoiceRevalidateReport {
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  findings: InvoiceRevalidateFinding[];
  red_flags: InvoiceRevalidateRedFlag[];
  divergences: InvoiceRevalidateDivergence[];
}

export interface InvoiceRevalidateResult {
  /** Misma forma que el resultado de `POST scan` (sin `scan_attachment`). */
  consolidated: Omit<InvoiceScanResult, 'scan_attachment'>;
  report: InvoiceRevalidateReport;
}

/** `GET scan/revalidate/:jobId` — SIN envelope de ResponseService. */
export interface InvoiceRevalidateJobStatus {
  status: InvoiceRevalidateJobState;
  result?: InvoiceRevalidateResult;
  error?: string;
}

export interface InvoiceRevalidateRequest {
  scan_attachment_key: string;
  order_type?: 'retail' | 'ingredient';
  consolidated: Omit<InvoiceScanResult, 'scan_attachment'>;
  note?: string;
}
