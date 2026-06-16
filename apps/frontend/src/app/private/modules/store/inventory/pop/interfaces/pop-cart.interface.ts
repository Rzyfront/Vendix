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
  tax_rate: number;
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
  addedAt: Date;
}

/**
 * Financial summary for purchase order cart
 */
export interface PopCartSummary {
  subtotal: number;
  tax_amount: number;
  shipping_cost: number;
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
