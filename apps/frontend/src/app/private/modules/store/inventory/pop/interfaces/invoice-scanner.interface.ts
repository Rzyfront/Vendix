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
   * Fase 4: pistas de unidad de medida emitidas por el perfil
   * `invoice_ocr_ingredient`. El perfil retail (`invoice_ocr`) no las
   * emite, por eso son opcionales. `uom_hint` es un código de unidad
   * (p.ej. "L", "ml", "kg", "g", "unit") que el scanner usa para
   * preseleccionar la unidad de compra cuando `orderType==='ingredient'`.
   */
  presentation?: string | null;
  pack_size?: number | null;
  uom_hint?: string | null;
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
  subtotal: number;
  tax_amount: number;
  total: number;
  confidence: number;
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
