/**
 * POP (Point of Purchase) Cart Models
 * Based on POS cart patterns but adapted for purchase orders
 */

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
  units_per_package?: number;
  package_consumes_multiple_stock?: boolean;
  base_price?: number;
  profit_margin?: number;
  brand_id?: number | string;
  category_ids?: number[] | string;
  is_on_sale?: boolean;
  sale_price?: number;
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
