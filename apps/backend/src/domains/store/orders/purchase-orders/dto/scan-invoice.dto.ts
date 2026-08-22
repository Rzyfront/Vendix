import {
  IsOptional,
  IsNumber,
  IsString,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// --- Interfaces for OCR response (no validation needed, these come from AI) ---

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
   * F3 IVA lifecycle: after `normalizeOcrResponse`, `unit_price` is ALWAYS
   * the NET (pre-IVA) unit price. When the invoice was inclusive
   * (`prices_include_tax === true`) the scanner-emitted gross was flattened
   * to net using the canonical formula (net = gross / (1 + tax_rate)); the
   * original printed gross is preserved in `unit_price_gross`. When the
   * invoice was exclusive, net === gross so both fields carry the same value.
   */
  unit_price: number;
  total: number;
  sku_if_visible?: string;
  /**
   * F3 IVA lifecycle: per-line IVA/consumption rate emitted by the scanner
   * as a DECIMAL FRACTION (0, 0.05, 0.19), NOT a percentage. Optional because
   * legacy scans / pre-F3 prompts do not emit it. Used to (a) flatten to net
   * and (b) suggest a tax_category by rate match in `matchProducts`.
   */
  tax_rate?: number | null;
  /**
   * F3 IVA lifecycle: the ORIGINAL printed unit price as extracted from the
   * invoice (gross when the invoice was inclusive, net when exclusive).
   * `unit_price` above is normalized to net; this keeps the raw value so the
   * UI can show "bruto → neto". Optional for pre-F3 scans.
   */
  unit_price_gross?: number | null;
  /**
   * Fase 4: presentation / pack_size / uom_hint come from the
   * `invoice_ocr_ingredient` profile. Optional because the retail
   * profile (`invoice_ocr`) does not emit them. The POP modal
   * (Phase 3) pre-fills the UoM selectors with these hints but the
   * user always confirms manually.
   */
  presentation?: string | null;
  pack_size?: number | null;
  uom_hint?: string | null;
  /**
   * QUI-661 Fase 4 — descuento COMERCIAL de la línea, en dinero, tal como lo
   * imprime la factura ("Dcto", "Desc.", "-10%").
   *
   * Es comercial y no financiero: un descuento por pronto pago NO va acá,
   * porque no rebaja el precio del bien — es una condición de pago que va a
   * cuenta de resultado. Meterlo aquí rebajaría el costo capitalizado del
   * inventario por algo que no es una rebaja de precio, y ninguna validación
   * posterior lo atraparía porque el número es plausible. El prompt lo separa
   * explícitamente y el de pronto pago viaja en `early_payment_discount`.
   *
   * Opcional: los escaneos anteriores a esta fase no lo emiten.
   */
  discount_amount?: number | null;
  /**
   * QUI-661 hotfix — descuento comercial de la línea en PORCENTAJE (0-100),
   * tal como lo imprime la factura ("-20%", "Dcto 20%"). Es PROCEDENCIA: el
   * monto en `discount_amount` es la fuente de verdad y gana en `deriveLineTax`.
   * Se conserva sin recalcular desde el monto porque es la cifra que el
   * operador coteja de un vistazo contra el papel. Un porcentaje es invariante
   * a la base (bruto o neto), por eso es el dato más robusto que la IA emite.
   */
  discount_percentage?: number | null;
}

export interface InvoiceScanResult {
  supplier: ExtractedSupplier;
  invoice_number: string;
  invoice_date: string;
  payment_terms?: string;
  /**
   * F3 IVA lifecycle: invoice-GLOBAL flag emitted by the scanner — do the
   * printed unit prices / line totals already INCLUDE IVA? Drives the
   * net-flattening in `normalizeOcrResponse`. Optional/defaults to `false`
   * (tax added on top) for pre-F3 scans, mirroring the canonical
   * `effective_include = ... ?? false` contract.
   */
  prices_include_tax?: boolean;
  line_items: ExtractedLineItem[];
  subtotal: number;
  tax_amount: number;
  /**
   * QUI-661 Fase 4 — descuento COMERCIAL de pie de factura (sobre el total).
   * El backend lo prorratea por línea antes de derivar el IVA. Opcional:
   * los escaneos anteriores a esta fase no lo emiten.
   */
  discount_amount?: number | null;
  /**
   * QUI-661 Fase 4 — descuento por PRONTO PAGO detectado en la factura
   * ("2% si paga antes de 10 días"). Se extrae para MOSTRARLO, no para
   * aplicarlo: es un descuento financiero, va a cuenta de resultado y se
   * decide en el momento del pago (QUI-647), no al valorar el inventario.
   * Nunca entra al cálculo de la orden.
   */
  early_payment_discount?: number | null;
  total: number;
  confidence: number;
  /**
   * Non-blocking notices raised while normalizing the AI reply — currently
   * zero-decimal amount repairs and a line-totals vs. grand-total mismatch.
   * The frontend round-trips these into `/match`, where they are merged into
   * `InvoiceMatchResult.warnings` so the review step shows them before the
   * user confirms.
   */
  scan_warnings?: string[];
}

// --- Interfaces for match response ---

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

/**
 * CP-PURCHASE-TRANSPARENCY — referencia a un producto ARCHIVADO que el
 * emparejador reconoció y descartó a propósito.
 *
 * Viaja estructurada, no dentro de la cadena del aviso, porque la interfaz
 * tiene que poder pintar el nombre y el SKU pegados al renglón sin partir
 * texto: un motivo que obliga a parsear una frase no sirve.
 */
export interface ArchivedProductRef {
  id: number;
  name: string;
  sku: string | null;
}

/**
 * CP-PURCHASE-TRANSPARENCY — por qué esta línea quedó como quedó, en el
 * eje del EMPAREJAMIENTO.
 *
 * | valor                     | qué pasó                                                        |
 * | ------------------------- | --------------------------------------------------------------- |
 * | `archived_candidate`      | El único producto reconocido está archivado; la línea NO se emparejó. |
 * | `archived_sku_reassigned` | El SKU impreso es de un archivado, pero se propuso otro producto activo. |
 * | `no_catalog_match`        | Ningún producto del catálogo coincidió.                          |
 * | `lookup_failed`           | La búsqueda falló (error transitorio); la línea llegó sin candidatos. |
 *
 * Ausente cuando el emparejamiento fue limpio y no hay nada que explicar.
 */
export type MatchedLineReason =
  | 'archived_candidate'
  | 'archived_sku_reassigned'
  | 'no_catalog_match'
  | 'lookup_failed';

/**
 * CP-PURCHASE-TRANSPARENCY I.b — por qué la CANTIDAD de la línea no es la
 * que imprime la factura.
 *
 * | valor                               | qué pasó                                                          |
 * | ----------------------------------- | ------------------------------------------------------------------ |
 * | `converted_to_stock_units`          | Se convirtió con el factor de envase; el total de la línea no cambió. |
 * | `rounded_unmatched_line`            | Se redondeó: la línea aún no tiene producto, no hay factor que aplicar. |
 * | `rounded_no_packaging_factor`       | Se redondeó: el producto no declara factor de envase.               |
 * | `rounded_factor_applied_at_receipt` | Se redondeó: el factor se aplica al RECIBIR, convertir acá duplicaría. |
 * | `rounded_conversion_not_exact`      | Se redondeó: convertir con el factor tampoco daba un entero.        |
 */
export type QuantityAdjustmentReason =
  | 'converted_to_stock_units'
  | 'rounded_unmatched_line'
  | 'rounded_no_packaging_factor'
  | 'rounded_factor_applied_at_receipt'
  | 'rounded_conversion_not_exact';

/**
 * CP-PURCHASE-TRANSPARENCY I.b — el ajuste de cantidad, completo y tipado.
 *
 * `purchase_order_items.quantity_ordered` es `Int`, así que una factura que
 * dice «2,5 cajas» no se puede guardar tal cual. El escáner decide qué entero
 * entra al carrito y esta estructura cuenta la decisión con TODAS las cifras
 * que la pantalla necesita — original, aplicada, factor, precios — para que el
 * operador vea el antes y el después sin abrir la factura otra vez.
 */
export interface QuantityAdjustment {
  reason: QuantityAdjustmentReason;
  /** Cantidad tal como la imprime la factura (puede ser fraccionaria). */
  original_quantity: number;
  /** Entero que quedó en la línea. Nunca menor que 1 (`@Min(1)` en el DTO). */
  applied_quantity: number;
  /** Costo unitario antes del ajuste. */
  original_unit_price: number;
  /**
   * Costo unitario después. Igual al original salvo en la conversión, donde
   * se divide por el factor para que el total de la línea no se mueva. Al
   * REDONDEAR nunca se toca: es lo que alimenta el CPP/FIFO.
   */
  applied_unit_price: number;
  /** `products.purchase_to_stock_factor`, cuando el producto lo declara. */
  packaging_factor?: number;
  /**
   * Resultado EXACTO de multiplicar por el factor, presente sólo cuando ese
   * resultado tampoco era entero (`rounded_conversion_not_exact`). Permite
   * que la pantalla muestre "12,5" y explique por qué no sirvió.
   */
  converted_quantity?: number;
  /** Etiquetas de unidad para la copia en pantalla ("unidad", "caja"). */
  stock_unit?: string | null;
  purchase_unit?: string | null;
}

export interface MatchedLineItem extends ExtractedLineItem {
  match_status: 'matched' | 'partial' | 'new';
  selected_product_id?: number;
  candidates: ProductCandidate[];
  /**
   * F3 IVA lifecycle: tax_category resolved by matching the line's
   * `tax_rate` (fraction) against the commerce's tax_categories' tax_rates.
   * `null` when there is no rate match OR when the commerce is NOT VAT
   * responsible (O-49): a non-responsible tenant capitalizes IVA into cost
   * and must not carry a deductible tax category. The user can still assign
   * one manually in the POP modal.
   */
  suggested_tax_category_id?: number | null;
  /**
   * F3 IVA lifecycle: the NET (pre-IVA) unit cost for this line — equal to
   * the normalized `unit_price`. Surfaced explicitly so the POP modal can
   * pre-fill the cost field with the net value without re-deriving it.
   */
  unit_cost_net?: number | null;
  /**
   * CP-PURCHASE-TRANSPARENCY — por qué esta línea quedó así en el eje del
   * EMPAREJAMIENTO. Aditivo y opcional: una línea que hoy funciona no cambia.
   *
   * Existe además de `InvoiceMatchResult.warnings` porque un aviso de cabecera
   * que dice «el producto X está archivado», con veinte renglones debajo,
   * obliga al operador a buscar cuál es X. El motivo tiene que estar donde
   * está la consecuencia. `warnings` se conserva para lo que NO cuelga de una
   * línea concreta (estado fiscal, proveedor, tope de líneas).
   */
  match_reason?: MatchedLineReason;
  /**
   * El producto archivado detrás de `archived_candidate` /
   * `archived_sku_reassigned`. Presente sólo con esos dos motivos.
   */
  archived_candidate?: ArchivedProductRef;
  /**
   * CP-PURCHASE-TRANSPARENCY I.b — el ajuste de cantidad, cuando lo hubo.
   *
   * Campo APARTE de `match_reason`, y no otro valor de esa misma unión, porque
   * los dos ejes COEXISTEN: una línea puede quedar sin emparejar por archivado
   * Y traer una cantidad fraccionaria que hubo que redondear. Con un solo
   * campo, el segundo motivo pisaría al primero y la pantalla perdería
   * justamente la mitad de la explicación.
   */
  quantity_adjustment?: QuantityAdjustment;
}

export interface InvoiceMatchResult {
  supplier_match: SupplierMatch;
  items: MatchedLineItem[];
  warnings: string[];
}

// --- DTOs for confirmation (validated, these come from the user) ---

export class ConfirmScannedInvoiceItemDto {
  @IsOptional()
  @IsNumber()
  product_id?: number;

  @IsOptional()
  @IsString()
  product_name?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unit_cost: number;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * QUI-661 Fase 4 — descuento comercial de la línea, en dinero. Viaja del
   * modal de confirmación al backend, que lo persiste y lo resta de la base
   * ANTES de derivar el IVA.
   */
  @IsOptional()
  @IsNumber()
  discount_amount?: number;
}

export class ConfirmScannedInvoiceDto {
  @IsOptional()
  @IsNumber()
  supplier_id?: number;

  @IsNumber()
  location_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmScannedInvoiceItemDto)
  items: ConfirmScannedInvoiceItemDto[];

  @IsOptional()
  @IsString()
  invoice_number?: string;

  @IsOptional()
  @IsString()
  invoice_date?: string;

  @IsOptional()
  @IsNumber()
  tax_amount?: number;

  @IsOptional()
  @IsNumber()
  discount_amount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  save_attachment?: boolean;
}
