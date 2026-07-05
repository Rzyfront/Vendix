/**
 * POP (Point of Purchase) Cart Models
 * Based on POS cart patterns but adapted for purchase orders
 */

import { WithholdingLine } from '../../../withholding-tax/interfaces/withholding.interface';

// ============================================================================
// Base Entity Interfaces (defined first to avoid forward reference issues)
// ============================================================================

/**
 * Product interface (simplified for POP)
 */
export interface PopProduct {
  id: number;
  name: string;
  code?: string;
  price?: number;
  cost?: number;
  cost_price?: number;
  stock?: number;
  stock_quantity?: number;
  min_stock_level?: number | null;
  reorder_point?: number | null;
  low_stock_threshold?: number | null;
  track_inventory?: boolean;
  image_url?: string;
  category_id?: number;
  is_active?: boolean;
  is_on_sale?: boolean;
  sale_price?: number;
  pricing_type?: 'unit' | 'weight';
  product_variants?: PopProductVariant[];
  requires_batch_tracking?: boolean;
}

/**
 * Product variant for POP selection
 */
export interface PopProductVariant {
  id: number;
  name?: string;
  sku: string;
  cost_price?: number;
  stock_quantity?: number;
  low_stock_threshold?: number | null;
  attributes?: Record<string, any>;
}

/**
 * Supplier interface for header selection
 */
export interface PopSupplier {
  id: number;
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  tax_id?: string;
  is_active?: boolean;
}

/**
 * Location/Warehouse interface for header selection
 */
export interface PopLocation {
  id: number;
  name: string;
  code?: string;
  type?: string;
  is_active?: boolean;
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Shipping method options
 */
export type ShippingMethod =
  | 'supplier_transport'
  | 'freight'
  | 'pickup'
  | 'other';

/**
 * Payment term presets
 */
export type PaymentTermPreset =
  | 'immediate'
  | 'net_15'
  | 'net_30'
  | 'net_60'
  | 'net_90'
  | 'custom';

// ============================================================================
// POP-Specific Interfaces
// ============================================================================

/**
 * Lot/Batch information for purchase order items
 */
export interface LotInfo {
  batch_number?: string;
  manufacturing_date?: Date;
  expiration_date?: Date;
}

/**
 * Pre-bulk product data (temporary products not in catalog)
 */
export interface PreBulkData {
  name: string;
  code?: string;
  description?: string;
  product_type?: string;
  track_inventory?: boolean;
  pricing_type?: string;
  tax_category_ids?: number[];
  state?: string;
  weight?: number;
  available_for_ecommerce?: boolean;
  is_featured?: boolean;
  allow_pos_price_override?: boolean;
  has_multiple_price_tiers?: boolean;
  // Packaging (units-per-package) is no longer a product field — it lives on
  // the price tier / per-product tier override. Removed from POP prebulk data.
  base_price?: number;
  profit_margin?: number;
  brand_id?: number | string;
  category_ids?: number[] | string;
  is_on_sale?: boolean;
  sale_price?: number;
  /**
   * Fase 3 (insumos desde compra): marca el producto nuevo como insumo.
   * Cuando es true, el backend lo crea con `is_ingredient=true` y la orden
   * se infiere como `order_type='ingredient'`. Por defecto false (retail).
   */
  is_ingredient?: boolean;
  /**
   * Exclusividad suave con `is_ingredient`: cuando se marca como insumo,
   * deja de ser vendible (`is_sellable=false`). Retail por defecto true.
   */
  is_sellable?: boolean;
  /**
   * UoM FKs capturadas en el modal prebulk cuando el producto es insumo.
   * Null para productos retail. El backend las usa al recibir para derivar
   * el `purchase_to_stock_factor` (Modelo B).
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * F1 (contenido por envase): cuántas unidades de STOCK trae cada unidad de
   * COMPRA cuando la compra es un envase (dimensión `count`) y el stock es
   * masa/volumen — el catálogo NO puede derivar el factor porque las
   * dimensiones difieren, así que el usuario lo teclea (entero ≥1). Viaja
   * dentro de `prebulk_data` (sobrevive la copia del carrito) y `pop.component`
   * lo mapea al item de la orden como `purchase_to_stock_factor`. Undefined en
   * retail o cuando ambas unidades comparten dimensión (el backend deriva).
   */
  contentPerPackage?: number;
}

/**
 * Cart item for purchase order
 */
export interface PopCartItem {
  id: string;
  product: PopProduct;
  variant?: PopProductVariant | null;
  quantity: number;
  unit_cost: number;
  discount: number;
  /**
   * IVA cycle (F1): tax rate captured MANUALLY for this line, as a
   * percentage (e.g. 19 for standard Colombian IVA, 0 for exempt).
   */
  tax_rate: number;
  /**
   * IVA cycle (F1): tax classification for this line. Defaults to 'iva'.
   * Passed through to the backend as-is (backend is the source of truth).
   */
  tax_type?: string;
  /**
   * IVA cycle (F1): per-line override of the header `prices_include_tax`
   * mode (mixed invoices). When set, it inverts/overrides the header mode
   * for THIS line only: `effective_include = prices_include_tax ?? header`.
   * `undefined` means the line inherits the header mode.
   */
  prices_include_tax?: boolean;
  /**
   * Net (pre-tax) line subtotal = `unit_price_net * quantity` derived from
   * the effective include mode. IVA cycle (F1) redefines `subtotal` to be
   * NET so the summary shows Subtotal(neto) / IVA / Total.
   */
  subtotal: number;
  tax_amount: number;
  total: number;
  // Optional lot information
  lot_info?: LotInfo;
  notes?: string;
  // Pre-bulk flag (temporary product not in catalog)
  is_prebulk?: boolean;
  prebulk_data?: PreBulkData;
  /**
   * Fase 3: UoM FKs the backend uses during reception to derive
   * `purchase_to_stock_factor` (Modelo B). Required when the parent PO
   * has `order_type='ingredient'`; the cart shows a live capacity preview
   * (e.g. "1 L = 1000 ml") to make the user's intent explicit.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * F1 (contenido por envase): factor manual envase→stock (entero ≥1) para el
   * caso count→masa/volumen. Espejo del campo homónimo en `prebulk_data`; se
   * mapea al `purchase_to_stock_factor` del item de la orden. Undefined cuando
   * el backend puede derivar el factor por UoM (misma dimensión) o en retail.
   */
  contentPerPackage?: number;
  addedAt: Date;
}

/**
 * Financial summary for purchase order cart
 */
export interface PopCartSummary {
  /**
   * IVA cycle (F1): NET (pre-tax) subtotal = Σ(unit_price_net * quantity).
   * Derived from the effective include mode per line.
   */
  subtotal: number;
  /** IVA cycle (F1): total tax (IVA) = Σ line_tax. */
  tax_amount: number;
  shipping_cost: number;
  /** Gross total = subtotal (net) + tax_amount (IVA) + shipping. */
  total: number;
  itemCount: number;
  totalItems: number;
  /**
   * Net withholding the tenant PRACTICES on the supplier (role='practiced').
   * Reduces the net amount to pay the supplier. Sourced exclusively from the
   * backend preview endpoint — never computed client-side. 0 when there is no
   * supplier or no applicable withholding.
   */
  withholding_amount?: number;
  /** Resolved withholding lines for display/breakdown (preview, informative). */
  withholding_lines?: WithholdingLine[];
}

/**
 * Complete cart state
 */
export interface PopCartState {
  orderId?: number; // ID of the order being edited
  items: PopCartItem[];
  summary: PopCartSummary;
  /**
   * IVA cycle (F1): dominant invoice mode. `true` when the captured prices
   * already INCLUDE tax (extract IVA out of the price); `false` when tax is
   * ADDED on top of the net price. Per-line `prices_include_tax` overrides
   * this for mixed invoices.
   */
  prices_include_tax: boolean;
  /**
   * IVA cycle — maestro "¿Esta compra tiene IVA?". `false` (default) ⇒ cero
   * IVA en toda la orden: cada línea ignora su `tax_rate`, el neto = precio y
   * el resumen no muestra IVA. `true` ⇒ se aplica el IVA por línea (tasa 19%
   * por defecto) con su modo efectivo (`prices_include_tax` por línea ??
   * header). El escáner de facturas lo enciende al detectar IVA.
   */
  has_vat: boolean;
  supplierId: number | null;
  locationId: number | null;
  orderDate: Date;
  expectedDate?: Date;
  shippingMethod?: string;
  shippingCost: number;
  paymentTerms?: string;
  notes?: string;
  internalNotes?: string;
  status: 'draft' | 'submitted' | 'approved';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Request to add item to cart
 */
export interface AddToPopCartRequest {
  product: PopProduct;
  variant?: PopProductVariant | null;
  quantity: number;
  unit_cost: number;
  lot_info?: LotInfo;
  notes?: string;
  is_prebulk?: boolean;
  prebulk_data?: PreBulkData;
  /**
   * Fase 4: UoM FKs preseleccionadas (p.ej. por el scanner de facturas
   * desde `uom_hint`). Se propagan al `PopCartItem` para que el backend
   * derive el `purchase_to_stock_factor` al recibir. Null en retail.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * F1 (contenido por envase): factor manual envase→stock (entero ≥1) para el
   * caso count→masa/volumen. El carrito lo transporta preferentemente dentro
   * de `prebulk_data`; este campo top-level queda listo para propagación futura.
   */
  contentPerPackage?: number;
  /**
   * IVA cycle (F3 wiring): override de IVA por línea proveniente del escáner
   * de facturas. `tax_rate` es PORCENTAJE (19), no fracción — el escáner emite
   * fracción y `pop.component.ts` la convierte ×100 antes de llegar aquí.
   * Cuando el escáner detectó tasa, la línea entra en modo adicional
   * (`prices_include_tax=false`) porque `normalizeOcrResponse` ya aplastó el
   * `unit_cost` a neto. Ausentes ⇒ el carrito usa sus defaults (hereda header).
   */
  tax_rate?: number;
  tax_type?: string;
  prices_include_tax?: boolean;
}

/**
 * Request to update cart item
 */
export interface UpdatePopCartItemRequest {
  itemId: string;
  quantity?: number;
  unit_cost?: number;
  lot_info?: LotInfo;
  notes?: string;
  variant?: PopProductVariant | null;
  pricing_type?: 'unit' | 'weight';
}

/**
 * Cart validation error
 */
export interface PopCartValidationError {
  field: string;
  message: string;
}

// ============================================================================
// Unified Product Modal Result (Fase 5 — modal unificado)
// ============================================================================

/**
 * Configure-mode result. Centralized here (moved from
 * `pop-product-config-modal.component.ts`) so the discriminated union
 * below can reference it without circular imports. The modal component
 * re-exports it for backward compatibility.
 */
export interface PopProductConfigResult {
  variant?: PopProductVariant | null;
  variants?: PopProductVariant[];
  lot_info?: LotInfo;
  quantity: number;
  unit_cost: number;
  pricing_type?: 'unit' | 'weight';
  /**
   * Fase 3: UoM FKs propagated to the cart line. The modal only fills
   * these when the product is a pure ingredient and the store supports
   * the capacity (Phase 0 resolver). When null/undefined, the cart
   * leaves them null and the PO will be treated as `retail`.
   */
  purchase_uom_id?: number | null;
  stock_uom_id?: number | null;
  /**
   * F1 (contenido por envase): factor manual envase→stock (entero ≥1) capturado
   * por `pop-uom-capture` en el caso count→masa/volumen. `pop.component` lo
   * propaga al carrito y lo mapea al `purchase_to_stock_factor` del item de la
   * orden. Undefined cuando el backend deriva el factor por UoM o en retail.
   */
  contentPerPackage?: number;
}

/**
 * Discriminated union emitted by the unified product modal
 * (`PopProductConfigModalComponent` in `mode: 'create' | 'configure'`).
 *
 * The shape is a 1:1 mapping to the payloads the cart already accepts:
 * - `create`     → `addToCart({ is_prebulk: true, prebulk_data, quantity, unit_cost, notes })`
 * - `configure`  → `addToCart` / `updateCartItem` with `variant`, `variants`, `lot_info`,
 *                  `pricing_type`, `unit_cost`, and optional UoM FKs.
 *
 * The discriminated `mode` lets the orchestrator (`pop.component.ts`) route
 * the result to the existing cart calls without changes to
 * `cartToPurchaseOrderRequest`.
 */
export type PopProductModalResult =
  | {
      mode: 'create';
      prebulkData: PreBulkData;
      quantity: number;
      unit_cost: number;
      notes?: string;
    }
  | (PopProductConfigResult & { mode: 'configure' });
